"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DocfyModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocfyModule = void 0;
const common_1 = require("@nestjs/common");
const registry_1 = require("./registry");
const resolve_docs_path_1 = require("./resolve-docs-path");
/**
 * Import once in your root AppModule — before any module that declares controllers
 * marked with @WithDocs().
 *
 * @example
 * @Module({
 *   imports: [DocfyModule.forRoot(), UsersModule],
 * })
 * export class AppModule {}
 */
let DocfyModule = DocfyModule_1 = class DocfyModule {
    static forRoot() {
        DocfyModule_1.loadAllDocs();
        return { module: DocfyModule_1 };
    }
    // Separated for unit testing
    static loadAllDocs(requireFn = require, cacheReader) {
        for (const controllerClass of registry_1.DocfyRegistry.getAll()) {
            const docsPath = (0, resolve_docs_path_1.resolveDocsPath)(controllerClass, cacheReader);
            if (!docsPath) {
                DocfyModule_1.logger.warn(`Could not locate source file for ${controllerClass.name}. ` +
                    `Make sure the class is exported from its module file.`);
                continue;
            }
            try {
                requireFn(docsPath);
                DocfyModule_1.logger.log(`Loaded docs for ${controllerClass.name} from ${docsPath}`);
            }
            catch (err) {
                const isNotFound = err instanceof Error &&
                    'code' in err &&
                    err.code === 'MODULE_NOT_FOUND';
                if (isNotFound) {
                    DocfyModule_1.logger.warn(`No docs file found for ${controllerClass.name}. ` +
                        `Expected: ${docsPath}`);
                }
                else {
                    DocfyModule_1.logger.error(`Failed to load docs file for ${controllerClass.name}: ${docsPath}`, err);
                    throw err;
                }
            }
        }
    }
};
exports.DocfyModule = DocfyModule;
DocfyModule.logger = new common_1.Logger(DocfyModule_1.name);
exports.DocfyModule = DocfyModule = DocfyModule_1 = __decorate([
    (0, common_1.Module)({})
], DocfyModule);
//# sourceMappingURL=docfy.module.js.map