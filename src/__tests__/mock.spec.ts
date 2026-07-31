import * as http from 'http';
import type { AddressInfo } from 'net';
import { buildMockApp } from '../cli/mock';
import type { OpenApiDocument } from '../cli/merge-spec-patch';

async function listen(
  app: Awaited<ReturnType<typeof buildMockApp>>['app'],
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function specWithPaths(paths: OpenApiDocument['paths']): OpenApiDocument {
  return {
    openapi: '3.0.0',
    info: { title: 'Mock Test API', version: '1.0.0' },
    paths,
  } as OpenApiDocument;
}

describe('buildMockApp()', () => {
  it('responds on a GET endpoint with the generated example and the declared status', async () => {
    const document = specWithPaths({
      '/users': {
        get: {
          tags: ['Users'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    });

    const { app, endpointCount } = await buildMockApp(document);
    expect(endpointCount).toBe(1);

    const { origin, close } = await listen(app);
    const res = await fetch(`${origin}/users`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body).toEqual({ name: 'string' });

    await close();
  });

  it('converts an OpenAPI {param} path into an Express :param route and resolves it', async () => {
    const document = specWithPaths({
      '/users/{id}': {
        get: {
          tags: ['Users'],
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } },
            },
          },
        },
      },
    });

    const { app } = await buildMockApp(document);
    const { origin, close } = await listen(app);
    const res = await fetch(`${origin}/users/42`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'string' });

    await close();
  });

  it('registers one route per method for the same path (GET and POST on /users)', async () => {
    const document = specWithPaths({
      '/users': {
        get: { tags: ['Users'], responses: { '200': { description: 'OK' } } },
        post: { tags: ['Users'], responses: { '201': { description: 'Created' } } },
      },
    });

    const { app, endpointCount } = await buildMockApp(document);
    expect(endpointCount).toBe(2);

    const { origin, close } = await listen(app);
    const getRes = await fetch(`${origin}/users`);
    const postRes = await fetch(`${origin}/users`, { method: 'POST' });

    expect(getRes.status).toBe(200);
    expect(postRes.status).toBe(201);

    await close();
  });

  it('responds 204 with an empty body when the endpoint declares no responses', async () => {
    const document = specWithPaths({ '/ping': { get: { tags: ['Health'], responses: {} } } });

    const { app } = await buildMockApp(document);
    const { origin, close } = await listen(app);
    const res = await fetch(`${origin}/ping`);

    expect(res.status).toBe(204);

    await close();
  });

  it('deduplicates an endpoint declared under multiple tags into a single registered route', async () => {
    const document = specWithPaths({
      '/users': { get: { tags: ['Users', 'Admin'], responses: { '200': { description: 'OK' } } } },
    });

    const { endpointCount } = await buildMockApp(document);
    expect(endpointCount).toBe(1);
  });
});
