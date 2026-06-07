"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDocsPath = resolveDocsPath;
const path = __importStar(require("path"));
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
function resolveDocsPath(controllerClass, readCache = () => require.cache) {
    const controllerFile = findFileInCache(controllerClass, readCache());
    if (!controllerFile)
        return null;
    const ext = path.extname(controllerFile); // .ts or .js
    const base = controllerFile.slice(0, -ext.length);
    if (!base.endsWith('.controller'))
        return null;
    return `${base}.docs${ext}`;
}
function findFileInCache(target, cache) {
    for (const [filename, mod] of Object.entries(cache)) {
        if (!mod?.exports)
            continue;
        for (const key of Object.keys(mod.exports)) {
            if (mod.exports[key] === target)
                return filename;
        }
    }
    return null;
}
//# sourceMappingURL=resolve-docs-path.js.map