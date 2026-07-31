import { buildSchemaExample, normalizeDocument, uniqueEndpoints, validateAgainstSchema } from 'docfy-core';
import type { Endpoint, JSONSchemaLike, SchemaMismatch } from 'docfy-core';
import type { OpenApiDocument } from './merge-spec-patch';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type EndpointTestOutcome =
  | { kind: 'matched'; httpStatus: number; mismatches: SchemaMismatch[] }
  | { kind: 'undeclared-status'; httpStatus: number }
  | { kind: 'no-schema'; httpStatus: number }
  | { kind: 'unparseable-body'; httpStatus: number }
  | { kind: 'request-failed'; message: string };

export interface EndpointTestResult {
  method: string;
  path: string;
  requestUrl: string;
  outcome: EndpointTestOutcome;
}

export interface RunContractTestsOptions {
  baseUrl: string;
  headers?: Record<string, string>;
}

/** Renders a schema-derived example value down to something usable as a raw path/query
 * token — `buildSchemaExample()`'s `example` is a real value for scalars (e.g. `"string"`,
 * `42`) but an array/object for structured schemas, which can't be flattened into a single
 * URL segment; those fall back to the literal `"test"` rather than `"[object Object]"`. */
function placeholderValue(schema: JSONSchemaLike | undefined): string {
  const example = buildSchemaExample(schema)?.example;
  if (example === undefined || example === null || typeof example === 'object') return 'test';
  return String(example);
}

function buildTestUrl(baseUrl: string, endpoint: Endpoint): string {
  let requestPath = endpoint.path;
  for (const param of endpoint.parameters.filter((p) => p.in === 'path')) {
    requestPath = requestPath.replace(`{${param.name}}`, encodeURIComponent(placeholderValue(param.schema)));
  }

  const query = new URLSearchParams();
  for (const param of endpoint.parameters.filter((p) => p.in === 'query' && p.required)) {
    query.set(param.name, placeholderValue(param.schema));
  }

  const base = baseUrl.replace(/\/+$/, '');
  const queryString = query.toString();
  return `${base}${requestPath}${queryString ? `?${queryString}` : ''}`;
}

function buildTestBody(endpoint: Endpoint): { body: string | undefined; contentType: string | undefined } {
  if (!endpoint.requestBody || !METHODS_WITH_BODY.has(endpoint.method))
    return { body: undefined, contentType: undefined };
  const example = buildSchemaExample(endpoint.requestBody.schema);
  return { body: example?.json, contentType: endpoint.requestBody.contentType };
}

/**
 * Fires a real request at `options.baseUrl` for one endpoint — path/query params and the
 * request body are filled in with the same deterministic, type-token examples `buildSchemaExample()`
 * produces elsewhere (no fake-but-plausible data) — and checks the live response against the
 * spec. A response whose status code isn't declared at all, or is declared with no schema, is
 * reported but never counted as a mismatch: a fabricated ID legitimately 404ing isn't a contract
 * break, and there's nothing to structurally check against for a schema-less response.
 */
async function testEndpoint(endpoint: Endpoint, options: RunContractTestsOptions): Promise<EndpointTestResult> {
  const requestUrl = buildTestUrl(options.baseUrl, endpoint);
  const { body, contentType } = buildTestBody(endpoint);

  const headers = new Headers(options.headers);
  if (body !== undefined && contentType) headers.set('Content-Type', contentType);

  const base = { method: endpoint.method, path: endpoint.path, requestUrl };

  let response: Response;
  try {
    response = await fetch(requestUrl, { method: endpoint.method, headers, body });
  } catch (err) {
    return { ...base, outcome: { kind: 'request-failed', message: err instanceof Error ? err.message : String(err) } };
  }

  const declared = endpoint.responses.find((r) => r.status === String(response.status));
  if (!declared) return { ...base, outcome: { kind: 'undeclared-status', httpStatus: response.status } };
  if (!declared.schema) return { ...base, outcome: { kind: 'no-schema', httpStatus: response.status } };

  const bodyText = await response.text();
  let parsed: unknown;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    return { ...base, outcome: { kind: 'unparseable-body', httpStatus: response.status } };
  }

  const mismatches = validateAgainstSchema(declared.schema, parsed);
  return { ...base, outcome: { kind: 'matched', httpStatus: response.status, mismatches } };
}

/** Runs every endpoint in the document against a real, already-running server — a
 * Postman-collection-runner-equivalent with zero setup, driven straight off the OpenAPI spec.
 * Endpoints run concurrently; one endpoint's network failure never blocks the others. */
export async function runContractTests(
  rawDocument: OpenApiDocument,
  options: RunContractTestsOptions,
): Promise<EndpointTestResult[]> {
  const document = await normalizeDocument(rawDocument);
  const endpoints = uniqueEndpoints(document);
  return Promise.all(endpoints.map((endpoint) => testEndpoint(endpoint, options)));
}
