import * as http from 'http';
import { EventEmitter } from 'events';
import type { AddressInfo } from 'net';
import { buildAllowedOrigins, handleProxyRequest, PROXY_ERROR_HEADER, readJsonBody } from '../proxy-handler';

function makeMockResponse() {
  const res = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    header(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    send(body: string) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe('buildAllowedOrigins()', () => {
  it('builds origins from absolute server URLs', () => {
    const origins = buildAllowedOrigins([{ url: 'https://api.example.com/v1' }], undefined);
    expect(origins).toEqual(new Set(['https://api.example.com']));
  });

  it('drops relative/malformed server URLs', () => {
    const origins = buildAllowedOrigins([{ url: '/' }, { url: 'not a url' }], undefined);
    expect(origins.size).toBe(0);
  });

  it('merges in additionalProxyOrigins', () => {
    const origins = buildAllowedOrigins([{ url: 'https://api.example.com' }], ['https://staging.example.com']);
    expect(origins).toEqual(new Set(['https://api.example.com', 'https://staging.example.com']));
  });
});

describe('readJsonBody()', () => {
  it('returns req.body directly when already parsed (Fastify, or Express with body-parser applied)', async () => {
    const req = Object.assign(new EventEmitter(), { body: { method: 'GET', url: 'https://x' } });
    await expect(readJsonBody(req)).resolves.toEqual({ method: 'GET', url: 'https://x' });
  });

  it('falls back to reading and parsing the raw stream when req.body is undefined', async () => {
    const req = new EventEmitter();
    const promise = readJsonBody(req);
    req.emit('data', Buffer.from('{"method":"GET",'));
    req.emit('data', Buffer.from('"url":"https://x"}'));
    req.emit('end');
    await expect(promise).resolves.toEqual({ method: 'GET', url: 'https://x' });
  });

  it('resolves to undefined for an empty or malformed raw body instead of throwing', async () => {
    const req = new EventEmitter();
    const promise = readJsonBody(req);
    req.emit('end');
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('handleProxyRequest()', () => {
  it('rejects a missing/malformed body with 400 bad_request', async () => {
    const res = makeMockResponse();
    await handleProxyRequest(undefined, new Set(), res);
    expect(res.statusCode).toBe(400);
    expect(res.headers[PROXY_ERROR_HEADER]).toBe('bad_request');
  });

  it('rejects a body missing method/url with 400 bad_request', async () => {
    const res = makeMockResponse();
    await handleProxyRequest({ method: 'GET' }, new Set(), res);
    expect(res.statusCode).toBe(400);
    expect(res.headers[PROXY_ERROR_HEADER]).toBe('bad_request');
  });

  it('rejects an unsupported method with 400 bad_request', async () => {
    const res = makeMockResponse();
    await handleProxyRequest(
      { method: 'TRACE', url: 'https://api.example.com/x' },
      new Set(['https://api.example.com']),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.headers[PROXY_ERROR_HEADER]).toBe('bad_request');
  });

  it('rejects an invalid URL with 400 invalid_url', async () => {
    const res = makeMockResponse();
    await handleProxyRequest({ method: 'GET', url: 'not a url' }, new Set(), res);
    expect(res.statusCode).toBe(400);
    expect(res.headers[PROXY_ERROR_HEADER]).toBe('invalid_url');
  });

  it('rejects a non-http(s) protocol with 400 invalid_url', async () => {
    const res = makeMockResponse();
    await handleProxyRequest({ method: 'GET', url: 'file:///etc/passwd' }, new Set(), res);
    expect(res.statusCode).toBe(400);
    expect(res.headers[PROXY_ERROR_HEADER]).toBe('invalid_url');
  });

  it('rejects an origin not in the allowlist with 403 origin_not_allowed', async () => {
    const res = makeMockResponse();
    await handleProxyRequest(
      { method: 'GET', url: 'https://internal.local/admin' },
      new Set(['https://api.example.com']),
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(res.headers[PROXY_ERROR_HEADER]).toBe('origin_not_allowed');
  });

  describe('against a real local HTTP server', () => {
    let server: http.Server;
    let origin: string;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === '/echo') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            res.statusCode = 201;
            res.setHeader('X-Echo-Header', req.headers['x-custom-header'] ?? 'none');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ received: body, method: req.method }));
          });
          return;
        }
        if (req.url === '/error-status') {
          res.statusCode = 404;
          res.end('not found upstream');
          return;
        }
        res.statusCode = 200;
        res.end('ok');
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      origin = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('forwards an allowed request and passes through the real status/headers/body', async () => {
      const res = makeMockResponse();
      await handleProxyRequest(
        { method: 'POST', url: `${origin}/echo`, headers: { 'X-Custom-Header': 'hello' }, body: '{"a":1}' },
        new Set([origin]),
        res,
      );

      expect(res.statusCode).toBe(201);
      expect(res.headers['x-echo-header']).toBe('hello');
      expect(JSON.parse(res.body!)).toEqual({ received: '{"a":1}', method: 'POST' });
      expect(res.headers[PROXY_ERROR_HEADER]).toBeUndefined();
    });

    it('passes through a real error status from the target without treating it as a proxy error', async () => {
      const res = makeMockResponse();
      await handleProxyRequest({ method: 'GET', url: `${origin}/error-status` }, new Set([origin]), res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('not found upstream');
      expect(res.headers[PROXY_ERROR_HEADER]).toBeUndefined();
    });

    it('reports a network error as 502 when the target is unreachable', async () => {
      const deadOrigin = 'http://127.0.0.1:1';
      const res = makeMockResponse();
      await handleProxyRequest({ method: 'GET', url: `${deadOrigin}/x` }, new Set([deadOrigin]), res);

      expect(res.statusCode).toBe(502);
      expect(res.headers[PROXY_ERROR_HEADER]).toBe('network_error');
    });
  });
});
