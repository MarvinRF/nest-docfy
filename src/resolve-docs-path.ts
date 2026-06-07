import * as path from 'path';

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
 */
export function resolveDocsPath(
  controllerClass: Function,
  readCache: () => CacheSnapshot = () => require.cache as unknown as CacheSnapshot,
): string | null {
  const controllerFile = findFileInCache(controllerClass, readCache());
  if (!controllerFile) return null;

  const ext = path.extname(controllerFile); // .ts or .js
  const base = controllerFile.slice(0, -ext.length);

  // Require the .controller suffix so we don't match barrel index files or services
  if (!base.endsWith('.controller')) return null;

  return `${base}.docs${ext}`;
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
      if (mod.exports[key] === target) {
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
