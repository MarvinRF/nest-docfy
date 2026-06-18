import type { OpenApiSchema, OperationPatch, SpecPatch } from './build-openapi-patch';

export interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  [key: string]: unknown;
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema: OpenApiSchema }>;
  requestBody?: { required?: boolean; content: Record<string, { schema: OpenApiSchema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema: OpenApiSchema }> }>;
  [key: string]: unknown;
}

/**
 * Unions tags case-insensitively, keeping whichever casing was already in
 * the base document's `tags` so the merge never produces what looks like
 * two different groups in a UI that groups operations by tag (e.g.
 * @nestjs/swagger's auto-generated "Auth" colliding with an `ApiTags('auth')`
 * in a docs file — same logical tag, different casing).
 */
function mergeTags(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  if (!incoming) return existing;
  const result = [...(existing ?? [])];
  const seenLower = new Set(result.map((t) => t.toLowerCase()));
  for (const tag of incoming) {
    if (!seenLower.has(tag.toLowerCase())) {
      result.push(tag);
      seenLower.add(tag.toLowerCase());
    }
  }
  return result;
}

function mergeSecurity(
  existing: Array<Record<string, string[]>> | undefined,
  incoming: Array<Record<string, string[]>> | undefined,
): Array<Record<string, string[]>> | undefined {
  if (!incoming) return existing;
  const keys = new Set((existing ?? []).map((e) => Object.keys(e).join(',')));
  const merged = [...(existing ?? [])];
  for (const entry of incoming) {
    const key = Object.keys(entry).join(',');
    if (!keys.has(key)) {
      merged.push(entry);
      keys.add(key);
    }
  }
  return merged;
}

function mergeParameters(
  existing: OpenApiOperation['parameters'],
  incoming: OpenApiOperation['parameters'],
): OpenApiOperation['parameters'] | undefined {
  if (!incoming) return existing;
  const key = (p: { name: string; in: string }) => `${p.in}:${p.name}`;
  const seen = new Set((existing ?? []).map(key));
  const merged = [...(existing ?? [])];
  for (const param of incoming) {
    if (!seen.has(key(param))) {
      merged.push(param);
      seen.add(key(param));
    }
  }
  return merged;
}

function mergeResponses(
  existing: OpenApiOperation['responses'],
  incoming: OperationPatch['responses'],
): OpenApiOperation['responses'] | undefined {
  if (!incoming) return existing;
  const merged = { ...(existing ?? {}) };
  for (const [status, value] of Object.entries(incoming)) {
    merged[status] = { ...merged[status], ...value };
  }
  return merged;
}

/**
 * Merges one operation-level patch into an existing OpenAPI operation
 * object. Scalars (summary/description/deprecated/requestBody) overwrite;
 * collections (tags/security/parameters/responses) merge additively so a
 * docs patch only ever adds information, never silently drops whatever the
 * base document (from @nestjs/swagger's own decorator/type inference) had.
 */
export function mergeOperation(existing: OpenApiOperation, patch: OperationPatch): OpenApiOperation {
  return {
    ...existing,
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.deprecated !== undefined ? { deprecated: patch.deprecated } : {}),
    ...(patch.requestBody !== undefined ? { requestBody: patch.requestBody } : {}),
    tags: mergeTags(existing.tags, patch.tags),
    security: mergeSecurity(existing.security, patch.security),
    parameters: mergeParameters(existing.parameters, patch.parameters),
    responses: mergeResponses(existing.responses, patch.responses),
  };
}

export interface MergeSpecPatchResult {
  document: OpenApiDocument;
  /** "METHOD /path" entries from the patch that had no matching operation in the base document. */
  unmatchedRoutes: string[];
}

/**
 * Merges a statically-computed SpecPatch (see build-openapi-patch.ts) into
 * an already-built OpenAPI document — the output of `SwaggerModule.createDocument()`,
 * fetched from a running app's `/api-json` or read from a generated file.
 *
 * Matches by path + HTTP method, never by class identity, which is the
 * whole point: it works regardless of whether the live app's controller
 * class is reachable from this process (see README's "Not supported:
 * webpack: true" section for why that reachability can't be assumed).
 *
 * Does not mutate the input document.
 */
export function mergeSpecPatch(document: OpenApiDocument, patch: SpecPatch): MergeSpecPatchResult {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  for (const [route, methods] of Object.entries(document.paths ?? {})) {
    paths[route] = { ...methods };
  }

  const unmatchedRoutes: string[] = [];

  for (const [route, methods] of Object.entries(patch)) {
    for (const [httpMethod, opPatch] of Object.entries(methods)) {
      const existingOperation = paths[route]?.[httpMethod];
      if (!existingOperation) {
        unmatchedRoutes.push(`${httpMethod.toUpperCase()} ${route}`);
        continue;
      }
      paths[route] = {
        ...paths[route],
        [httpMethod]: mergeOperation(existingOperation, opPatch),
      };
    }
  }

  return { document: { ...document, paths }, unmatchedRoutes };
}
