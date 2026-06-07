"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOCFY_MARKER = void 0;
exports.WithDocs = WithDocs;
const common_1 = require("@nestjs/common");
const registry_1 = require("./registry");
exports.DOCFY_MARKER = 'docfy:with_docs';
/**
 * Marks a NestJS controller so that DocfyModule will load its companion
 * docs file (*.controller.docs.ts / *.controller.docs.js) at startup.
 *
 * @example
 * @WithDocs()
 * @Controller('users')
 * export class UsersController { ... }
 */
function WithDocs() {
    return (target) => {
        (0, common_1.SetMetadata)(exports.DOCFY_MARKER, true)(target);
        registry_1.DocfyRegistry.add(target);
    };
}
//# sourceMappingURL=with-docs.decorator.js.map