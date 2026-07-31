import express from 'express';
import { buildSchemaExample, normalizeDocument, pickPrimarySuccessResponse } from 'docfy-core';
import type { DocumentModel, Endpoint } from 'docfy-core';
import type { OpenApiDocument } from './merge-spec-patch';

const EXPRESS_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'] as const;
type ExpressMethod = (typeof EXPRESS_METHODS)[number];

/** `/users/{id}` (OpenAPI) → `/users/:id` (Express route syntax). */
function toExpressPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1');
}

/** An endpoint with multiple `tags` appears once per tag group in `document.tagGroups` (by
 * design — see `normalize.ts`) — deduplicated here by `method path` so each route is
 * registered, and counted, exactly once. */
function uniqueEndpoints(document: DocumentModel): Endpoint[] {
  const byKey = new Map<string, Endpoint>();
  for (const group of document.tagGroups) {
    for (const endpoint of group.endpoints) {
      byKey.set(`${endpoint.method} ${endpoint.path}`, endpoint);
    }
  }
  return [...byKey.values()];
}

type ExpressRouteHandler = (req: express.Request, res: express.Response) => void;

function registerRoute(
  app: express.Express,
  method: ExpressMethod,
  expressPath: string,
  handler: ExpressRouteHandler,
): void {
  switch (method) {
    case 'get':
      app.get(expressPath, handler);
      return;
    case 'put':
      app.put(expressPath, handler);
      return;
    case 'post':
      app.post(expressPath, handler);
      return;
    case 'delete':
      app.delete(expressPath, handler);
      return;
    case 'patch':
      app.patch(expressPath, handler);
      return;
    case 'options':
      app.options(expressPath, handler);
      return;
    case 'head':
      app.head(expressPath, handler);
      return;
  }
}

function registerMockRoute(app: express.Express, endpoint: Endpoint): void {
  const method = endpoint.method.toLowerCase() as ExpressMethod;
  if (!EXPRESS_METHODS.includes(method)) return; // e.g. TRACE — not exposed by Express's routing API.

  registerRoute(app, method, toExpressPath(endpoint.path), (_req, res) => {
    const response = pickPrimarySuccessResponse(endpoint.responses) ?? endpoint.responses[0];
    if (!response) {
      res.status(204).end();
      return;
    }

    const status = Number.parseInt(response.status, 10) || 200;
    const example = buildSchemaExample(response.schema);
    if (!example) {
      res.status(status).end();
      return;
    }

    res
      .status(status)
      .type(response.contentType ?? 'application/json')
      .send(example.json);
  });
}

export interface MockApp {
  app: express.Express;
  endpointCount: number;
}

/**
 * Builds an Express app that answers every endpoint in the OpenAPI document with its
 * generated example response — the same deterministic, type-token example `buildSchemaExample()`
 * already produces for "Copy for AI" and the "Code" tab snippets, not fake-but-plausible data.
 * No request validation, no auth, no state (a POST never affects what a later GET returns) —
 * this exists to unblock a frontend against an API that isn't running yet, not to replace one.
 */
export async function buildMockApp(rawDocument: OpenApiDocument): Promise<MockApp> {
  const document = await normalizeDocument(rawDocument);
  const app = express();
  const endpoints = uniqueEndpoints(document);
  for (const endpoint of endpoints) registerMockRoute(app, endpoint);
  return { app, endpointCount: endpoints.length };
}
