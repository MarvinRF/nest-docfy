import type { MediaTypeContent, OpenApiSchema, OperationPatch, SpecPatch } from './build-openapi-patch';

/**
 * `paths` is deliberately untyped (`unknown`), not `Record<string,
 * Record<string, OpenApiOperation>>` — a `Record<...>` requires the source
 * value to structurally carry an index signature, which real-world OpenAPI
 * document types (e.g. `@nestjs/swagger`'s `OpenAPIObject`/`PathsObject`/
 * `PathItemObject`, which use named optional properties like `get?`/`post?`
 * instead) don't, making them structurally incompatible with any `Record<...>`
 * shape here for no runtime-meaningful reason — `unknown` sidesteps that
 * entirely since any type is assignable to it. `mergeSpecPatch` casts it to
 * the working shape internally where it actually needs to read/write it.
 */
export interface OpenApiDocument {
  paths?: unknown;
  [key: string]: unknown;
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema: OpenApiSchema }>;
  requestBody?: { required?: boolean; content: Record<string, MediaTypeContent> };
  responses?: Record<string, { description?: string; content?: Record<string, MediaTypeContent> }>;
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

/**
 * Additive for a genuinely new parameter, but a *merge* (patch fields
 * overwrite, matching `mergeOperation`'s own scalar semantics) when one
 * already exists with the same name+location — not a no-op. `@nestjs/swagger`
 * auto-generates a bare parameter entry (`required: true`, no `enum`) from
 * reflection alone for any `@Query()`/`@Param()`-decorated handler argument,
 * even with zero `@Api*` decorators — so "already exists" is the common
 * case, not the exception, and treating it as "keep the base, discard the
 * patch" would silently swallow every `ApiQuery`/`ApiParam` enrichment a
 * docs file adds for a parameter Nest already knew about.
 */
function mergeParameters(
  existing: OpenApiOperation['parameters'],
  incoming: OpenApiOperation['parameters'],
): OpenApiOperation['parameters'] | undefined {
  if (!incoming) return existing;
  const key = (p: { name: string; in: string }) => `${p.in}:${p.name}`;
  const merged = [...(existing ?? [])];
  const indexByKey = new Map(merged.map((p, i) => [key(p), i]));
  for (const param of incoming) {
    const existingIndex = indexByKey.get(key(param));
    if (existingIndex === undefined) {
      indexByKey.set(key(param), merged.length);
      merged.push(param);
    } else {
      merged[existingIndex] = { ...merged[existingIndex], ...param };
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
  const existingPaths = (document.paths ?? {}) as Record<string, Record<string, unknown>>;
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [route, methods] of Object.entries(existingPaths)) {
    paths[route] = { ...methods };
  }

  const unmatchedRoutes: string[] = [];

  for (const [route, methods] of Object.entries(patch)) {
    for (const [httpMethod, opPatch] of Object.entries(methods)) {
      const existingOperation = paths[route]?.[httpMethod] as OpenApiOperation | undefined;
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
