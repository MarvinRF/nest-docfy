import * as path from 'path';

type CacheSnapshot = Record<string, { exports: Record<string, unknown> } | undefined>;

/**
 * Given a controller class, finds its source file in require.cache and derives
 * the companion docs file path by replacing the suffix:
 *   users.controller.js  →  users.controller.docs.js
 *   users.controller.ts  →  users.controller.docs.ts  (ts-node)
 *
 * Returns null if the controller's file cannot be located in the module cache
 * or if the file does not follow the *.controller.* naming convention.
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

  if (!base.endsWith('.controller')) return null;

  return `${base}.docs${ext}`;
}

function findFileInCache(target: Function, cache: CacheSnapshot): string | null {
  for (const [filename, mod] of Object.entries(cache)) {
    if (!mod?.exports) continue;
    for (const key of Object.keys(mod.exports)) {
      if (mod.exports[key] === target) return filename;
    }
  }
  return null;
}
