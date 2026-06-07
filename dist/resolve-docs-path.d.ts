type CacheSnapshot = Record<string, {
    exports: Record<string, unknown>;
} | undefined>;
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
export declare function resolveDocsPath(controllerClass: Function, readCache?: () => CacheSnapshot): string | null;
export {};
