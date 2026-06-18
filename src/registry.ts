// Global registry of classes decorated with @WithDocs().
// Populated at class-definition time; consumed by DocfyModule.forRoot().
const registry = new Set<Function>();

// Raw `Error().stack` captured at the exact line `@WithDocs()` was applied,
// keyed by class. Used as a fallback to locate the controller's source file
// when require.cache has no entry for it (e.g. the app is bundled — see
// resolve-source-from-stack.ts for why that happens and how this is used).
const callSites = new WeakMap<Function, string>();

export const DocfyRegistry = {
  add(target: Function, callSiteStack?: string): void {
    registry.add(target);
    if (callSiteStack) callSites.set(target, callSiteStack);
  },

  getAll(): ReadonlySet<Function> {
    return registry;
  },

  getCallSite(target: Function): string | undefined {
    return callSites.get(target);
  },

  // For testing only — resets the registry between test runs.
  _reset(): void {
    registry.clear();
  },
};
