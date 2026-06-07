"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocfyRegistry = void 0;
// Global registry of classes decorated with @WithDocs().
// Populated at class-definition time; consumed by DocfyModule.forRoot().
const registry = new Set();
exports.DocfyRegistry = {
    add(target) {
        registry.add(target);
    },
    getAll() {
        return registry;
    },
    // For testing only — resets the registry between test runs.
    _reset() {
        registry.clear();
    },
};
//# sourceMappingURL=registry.js.map