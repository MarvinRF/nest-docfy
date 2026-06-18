import * as path from 'path';
import { parseCallSite, resolveOriginalPath } from './resolve-source-from-stack';

type CacheSnapshot = Record<string, { exports: Record<string, unknown> } | undefined>;

/**
 * Given a controller class, finds its own source file in require.cache and derives
 * the companion docs file path by replacing the suffix:
 *   users.controller.js  →  users.controller.docs.js
 *   users.controller.ts  →  users.controller.docs.ts  (ts-node)
 *
 * Returns null if:
 * - the controller's file cannot be located in the module cache
 * - the file does not follow the *.controller.* naming convention
 * - the class is only found via a barrel re-export (index.ts) rather than its own file
 *
 * @param readCache Injected for testing; defaults to () => require.cache.
 * @param callSiteStack The `Error().stack` captured by `@WithDocs()` at the
 * controller's own decoration site. Used as a fallback when the controller's
 * file has no require.cache entry — which is always true when the app is
 * bundled (NestJS CLI's `webpack: true` build mode, the documented default
 * for monorepos): bundlers inline every module into one file and never
 * populate require.cache per original source file, so the cache-based
 * lookup below can never find anything to return. In that case we resolve
 * the bundle position from the stack trace back to the original file via
 * that bundle's source map (emitted by default by the webpack build).
 */
export function resolveDocsPath(
  controllerClass: Function,
  readCache: () => CacheSnapshot = () => require.cache as unknown as CacheSnapshot,
  callSiteStack?: string,
): string | null {
  const controllerFile =
    findFileInCache(controllerClass, readCache()) ?? resolveFromCallSite(callSiteStack);
  if (!controllerFile) return null;

  const ext = path.extname(controllerFile); // .ts or .js
  const base = controllerFile.slice(0, -ext.length);

  // Require the .controller suffix so we don't match barrel index files or services
  if (!base.endsWith('.controller')) return null;

  return `${base}.docs${ext}`;
}

function resolveFromCallSite(callSiteStack: string | undefined): string | null {
  const loc = parseCallSite(callSiteStack);
  if (!loc) return null;
  return resolveOriginalPath(loc);
}

/**
 * Searches require.cache for the file that directly owns the class.
 *
 * Prefers files whose basename contains the class name in kebab/snake/camel form,
 * so that a barrel re-export (index.ts) is ranked below the actual source file.
 * Both are valid cache entries — we want the most specific one.
 */
function findFileInCache(target: Function, cache: CacheSnapshot): string | null {
  const candidates: string[] = [];

  for (const [filename, mod] of Object.entries(cache)) {
    if (!mod?.exports) continue;
    for (const key of Object.keys(mod.exports)) {
      // Some third-party modules (e.g. express's `request.js`) export an
      // object with enumerable getters that throw outside their expected
      // context (`req.query` reads `this.app`, undefined here). Reading
      // those would crash this require.cache scan, so any getter that
      // throws is treated as a non-match instead of propagating.
      let value: unknown;
      try {
        value = mod.exports[key];
      } catch {
        continue;
      }
      if (value === target) {
        candidates.push(filename);
        break;
      }
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple files export the same class (barrel re-exports).
  // Prefer the file whose name matches the .controller. convention,
  // since barrel files (index.ts / index.js) never match that pattern.
  const directFile = candidates.find((f) => {
    const base = path.basename(f, path.extname(f));
    return base.endsWith('.controller') || base.includes('.controller.');
  });

  return directFile ?? candidates[0];
}
