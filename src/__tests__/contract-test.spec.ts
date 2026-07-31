import * as http from 'http';
import type { AddressInfo } from 'net';
import { runContractTests } from '../cli/contract-test';
import type { OpenApiDocument } from '../cli/merge-spec-patch';

function specWithPaths(paths: OpenApiDocument['paths']): OpenApiDocument {
  return { openapi: '3.0.0', info: { title: 'Contract Test API', version: '1.0.0' }, paths } as OpenApiDocument;
}

async function withServer(handler: http.RequestListener, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const userSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: { id: { type: 'string' }, name: { type: 'string' } },
};

describe('runContractTests()', () => {
  it('reports "matched" with no mismatches when the live body matches the declared schema', async () => {
    const document = specWithPaths({
      '/users/{id}': {
        get: {
          tags: ['Users'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: userSchema } } } },
        },
      },
    });

    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: '1', name: 'Ana' }));
      },
      async (baseUrl) => {
        const [result] = await runContractTests(document, { baseUrl });
        expect(result.outcome).toEqual({ kind: 'matched', httpStatus: 200, mismatches: [] });
        expect(result.requestUrl).toBe(`${baseUrl}/users/string`);
      },
    );
  });

  it('reports schema mismatches for a live body that violates the declared schema', async () => {
    const document = specWithPaths({
      '/users/{id}': {
        get: {
          tags: ['Users'],
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: userSchema } } } },
        },
      },
    });

    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: '1' })); // missing required "name"
      },
      async (baseUrl) => {
        const [result] = await runContractTests(document, { baseUrl });
        expect(result.outcome).toEqual({
          kind: 'matched',
          httpStatus: 200,
          mismatches: [{ path: 'body.name', message: 'required property missing' }],
        });
      },
    );
  });

  it('reports "undeclared-status" (not a failure) when the live status is not in the spec', async () => {
    const document = specWithPaths({
      '/users': { get: { tags: ['Users'], responses: { '200': { description: 'OK' } } } },
    });

    await withServer(
      (_req, res) => {
        res.statusCode = 404;
        res.end('not found');
      },
      async (baseUrl) => {
        const [result] = await runContractTests(document, { baseUrl });
        expect(result.outcome).toEqual({ kind: 'undeclared-status', httpStatus: 404 });
      },
    );
  });

  it('reports "no-schema" when the matched status has no declared schema', async () => {
    const document = specWithPaths({
      '/users': { delete: { tags: ['Users'], responses: { '204': { description: 'No Content' } } } },
    });

    await withServer(
      (_req, res) => {
        res.statusCode = 204;
        res.end();
      },
      async (baseUrl) => {
        const [result] = await runContractTests(document, { baseUrl });
        expect(result.outcome).toEqual({ kind: 'no-schema', httpStatus: 204 });
      },
    );
  });

  it('reports "unparseable-body" when the declared status has a schema but the body is not JSON', async () => {
    const document = specWithPaths({
      '/users': {
        get: {
          tags: ['Users'],
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: userSchema } } } },
        },
      },
    });

    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.end('not json');
      },
      async (baseUrl) => {
        const [result] = await runContractTests(document, { baseUrl });
        expect(result.outcome).toEqual({ kind: 'unparseable-body', httpStatus: 200 });
      },
    );
  });

  it('reports "request-failed" for one endpoint without blocking the others', async () => {
    const document = specWithPaths({
      '/users': { get: { tags: ['Users'], responses: { '200': { description: 'OK' } } } },
    });

    const results = await runContractTests(document, { baseUrl: 'http://127.0.0.1:1' });
    expect(results[0].outcome.kind).toBe('request-failed');
  });

  it('sends custom headers (e.g. auth) with every request', async () => {
    const document = specWithPaths({
      '/users': { get: { tags: ['Users'], responses: { '200': { description: 'OK' } } } },
    });

    await withServer(
      (req, res) => {
        res.statusCode = req.headers.authorization === 'Bearer test-token' ? 200 : 401;
        res.end();
      },
      async (baseUrl) => {
        const [result] = await runContractTests(document, {
          baseUrl,
          headers: { Authorization: 'Bearer test-token' },
        });
        expect(result.outcome).toEqual({ kind: 'no-schema', httpStatus: 200 });
      },
    );
  });

  it('substitutes a required query param with a generated placeholder value', async () => {
    const document = specWithPaths({
      '/users': {
        get: {
          tags: ['Users'],
          parameters: [{ name: 'page', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    });

    let capturedUrl = '';
    await withServer(
      (req, res) => {
        capturedUrl = req.url ?? '';
        res.statusCode = 200;
        res.end();
      },
      async (baseUrl) => {
        await runContractTests(document, { baseUrl });
        expect(capturedUrl).toBe('/users?page=integer');
      },
    );
  });

  it('sends the generated request body on a POST endpoint', async () => {
    const document = specWithPaths({
      '/users': {
        post: {
          tags: ['Users'],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
    });

    let capturedBody = '';
    await withServer(
      (req, res) => {
        let chunks = '';
        req.on('data', (c) => (chunks += c));
        req.on('end', () => {
          capturedBody = chunks;
          res.statusCode = 201;
          res.end();
        });
      },
      async (baseUrl) => {
        await runContractTests(document, { baseUrl });
        expect(JSON.parse(capturedBody)).toEqual({ name: 'string' });
      },
    );
  });
});
