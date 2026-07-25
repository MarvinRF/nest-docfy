import type { Project } from 'ts-morph';
import { deriveDocsFilePath } from './scan-controllers';
import { extractDocsConfig } from './extract-docs-config';
import { buildOpenApiPatch, SpecPatch, OperationPatch } from './build-openapi-patch';
import { mergeSpecPatch, mergeOperation, OpenApiDocument, OpenApiOperation } from './merge-spec-patch';
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

export interface SpecPatchComputation {
  patch: SpecPatch;
  controllersWithoutDocs: string[];
  unparseableDocsFiles: string[];
}

/**
 * Merges two SpecPatch maps, deep-merging at the operation level (not a
 * shallow per-method overwrite) — two different controllers can
 * legitimately produce a patch for the exact same path + method (e.g. a
 * gateway and the microservice it proxies to, both documenting the same
 * logical route under their own controller). A shallow overwrite would let
 * whichever controller is scanned second silently wipe out fields the
 * first one set, rather than only adding to them. Reuses mergeOperation —
 * the same additive-collections/overwrite-scalars semantics already used
 * when merging a patch into the base document.
 */
function mergePatches(a: SpecPatch, b: SpecPatch): SpecPatch {
  const result: SpecPatch = { ...a };
  for (const [route, methods] of Object.entries(b)) {
    const merged: Record<string, OperationPatch> = { ...result[route] };
    for (const [httpMethod, opPatch] of Object.entries(methods)) {
      const existing = merged[httpMethod];
      merged[httpMethod] = existing
        ? (mergeOperation(existing as OpenApiOperation, opPatch) as OperationPatch)
        : opPatch;
    }
    result[route] = merged;
  }
  return result;
}

/**
 * Computes the SpecPatch for every controller's companion docs file — all
 * via static analysis (ts-morph), no runtime require() of any docs file, no
 * decorator application, no dependency on a live class reference matching
 * the one the running app actually uses, and no base OpenAPI document
 * needed. Shared by `computePatchedDocument` (the `patch-spec` CLI command,
 * which merges into an already-built document) and the CLI plugin
 * (`src/plugin/`, which has no base document available at compile time and
 * instead serializes this patch to a file for `applyDocfyMetadata()` to
 * merge at runtime).
 *
 * `readDocsFile` is injected so this function stays pure/testable — real
 * callers supply `fs.readFileSync`.
 *
 * `projectsByControllerPath` is optional and, when given (see
 * `ScanResult.projectsByControllerPath`), lets each docs file be parsed
 * inside the same real, disk-backed project that scanned its controller —
 * necessary for a decorator argument that references a symbol imported from
 * another file (e.g. `enum: Role`) to resolve at all. Without it, docs files
 * are parsed in isolation and any such cross-file reference silently
 * resolves to nothing.
 */
export function computeSpecPatch(
  controllers: ControllerInfo[],
  format: 'ts' | 'js',
  readDocsFile: (absolutePath: string) => string | null,
  projectsByControllerPath?: Map<string, Project>,
): SpecPatchComputation {
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

    const project = projectsByControllerPath?.get(ctrl.filePath);
    const config = extractDocsConfig(content, project ? { project, absolutePath: docsPath } : undefined);
    if (!config) {
      unparseableDocsFiles.push(docsPath);
      continue;
    }

    patch = mergePatches(patch, buildOpenApiPatch(ctrl, config));
  }

  return { patch, controllersWithoutDocs, unparseableDocsFiles };
}

/**
 * Computes the fully-patched OpenAPI document from an already-built base
 * document plus every controller's companion docs file.
 *
 * This is the alternative to DocfyModule's runtime pipeline for apps where
 * that pipeline structurally cannot work (NestJS CLI's `webpack: true`
 * build mode — see the README's "Not supported" section). Run this as a
 * build step instead: generate the OpenAPI document however you already
 * do (SwaggerModule.createDocument + write to a file, or fetch a running
 * app's /api-json), then patch it with this.
 */
export function computePatchedDocument(
  document: OpenApiDocument,
  controllers: ControllerInfo[],
  format: 'ts' | 'js',
  readDocsFile: (absolutePath: string) => string | null,
  projectsByControllerPath?: Map<string, Project>,
): PatchSpecResult {
  const { patch, controllersWithoutDocs, unparseableDocsFiles } = computeSpecPatch(
    controllers,
    format,
    readDocsFile,
    projectsByControllerPath,
  );

  const { document: patchedDocument, unmatchedRoutes } = mergeSpecPatch(document, patch);
  const patchedOperationCount = Object.values(patch).reduce((count, methods) => count + Object.keys(methods).length, 0);

  return {
    document: patchedDocument,
    patchedOperationCount,
    unmatchedRoutes,
    controllersWithoutDocs,
    unparseableDocsFiles,
  };
}
