import { deriveDocsFilePath } from './scan-controllers';
import { extractDocsConfig } from './extract-docs-config';
import { buildOpenApiPatch, SpecPatch } from './build-openapi-patch';
import { mergeSpecPatch, OpenApiDocument } from './merge-spec-patch';
import type { ControllerInfo } from './extract-methods';

export interface PatchSpecResult {
  document: OpenApiDocument;
  /** How many "METHOD /path" operations were touched by at least one docs file. */
  patchedOperationCount: number;
  /** Patch entries that named a route+method absent from the base document. */
  unmatchedRoutes: string[];
  /** Controllers scanned that have no companion docs file at all — informational, not an error. */
  controllersWithoutDocs: string[];
  /** Docs files that exist but couldn't be parsed (no docs(...) call found, or a syntax error). */
  unparseableDocsFiles: string[];
}

function mergePatches(a: SpecPatch, b: SpecPatch): SpecPatch {
  const result: SpecPatch = { ...a };
  for (const [route, methods] of Object.entries(b)) {
    result[route] = { ...result[route], ...methods };
  }
  return result;
}

/**
 * Computes the fully-patched OpenAPI document from an already-built base
 * document plus every controller's companion docs file — all via static
 * analysis (ts-morph), no runtime require() of any docs file, no decorator
 * application, no dependency on a live class reference matching the one
 * the running app actually uses.
 *
 * This is the alternative to DocfyModule's runtime pipeline for apps where
 * that pipeline structurally cannot work (NestJS CLI's `webpack: true`
 * build mode — see the README's "Not supported" section). Run this as a
 * build step instead: generate the OpenAPI document however you already
 * do (SwaggerModule.createDocument + write to a file, or fetch a running
 * app's /api-json), then patch it with this.
 *
 * `readDocsFile` is injected so this function stays pure/testable —
 * the real CLI command supplies `fs.readFileSync`.
 */
export function computePatchedDocument(
  document: OpenApiDocument,
  controllers: ControllerInfo[],
  format: 'ts' | 'js',
  readDocsFile: (absolutePath: string) => string | null,
): PatchSpecResult {
  let patch: SpecPatch = {};
  const controllersWithoutDocs: string[] = [];
  const unparseableDocsFiles: string[] = [];

  for (const ctrl of controllers) {
    if (!ctrl.hasDocsFile) {
      controllersWithoutDocs.push(ctrl.className);
      continue;
    }

    const docsPath = deriveDocsFilePath(ctrl.filePath, format);
    const content = readDocsFile(docsPath);
    if (content === null) {
      unparseableDocsFiles.push(docsPath);
      continue;
    }

    const config = extractDocsConfig(content);
    if (!config) {
      unparseableDocsFiles.push(docsPath);
      continue;
    }

    patch = mergePatches(patch, buildOpenApiPatch(ctrl, config));
  }

  const { document: patchedDocument, unmatchedRoutes } = mergeSpecPatch(document, patch);
  const patchedOperationCount = Object.values(patch).reduce(
    (count, methods) => count + Object.keys(methods).length,
    0,
  );

  return {
    document: patchedDocument,
    patchedOperationCount,
    unmatchedRoutes,
    controllersWithoutDocs,
    unparseableDocsFiles,
  };
}
