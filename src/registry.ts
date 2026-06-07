// Global registry of classes decorated with @WithDocs().
// Populated at class-definition time; consumed by DocfyModule.forRoot().
const registry = new Set<Function>();

export const DocfyRegistry = {
  add(target: Function): void {
    registry.add(target);
  },

  getAll(): ReadonlySet<Function> {
    return registry;
  },

  // For testing only — resets the registry between test runs.
  _reset(): void {
    registry.clear();
  },
};
