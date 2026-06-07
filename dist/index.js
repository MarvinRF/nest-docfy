"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocfyModule = exports.docs = exports.DOCFY_MARKER = exports.WithDocs = void 0;
var with_docs_decorator_1 = require("./with-docs.decorator");
Object.defineProperty(exports, "WithDocs", { enumerable: true, get: function () { return with_docs_decorator_1.WithDocs; } });
Object.defineProperty(exports, "DOCFY_MARKER", { enumerable: true, get: function () { return with_docs_decorator_1.DOCFY_MARKER; } });
var docs_1 = require("./docs");
Object.defineProperty(exports, "docs", { enumerable: true, get: function () { return docs_1.docs; } });
var docfy_module_1 = require("./docfy.module");
Object.defineProperty(exports, "DocfyModule", { enumerable: true, get: function () { return docfy_module_1.DocfyModule; } });
//# sourceMappingURL=index.js.map