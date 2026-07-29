import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocfyUiModule } from '../docfy-ui.module';

@Module({})
class EmptyModule {}

describe('DocfyUiModule.setup() on a real Fastify app', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(EmptyModule, new FastifyAdapter(), {
      logger: false,
    });
    DocfyUiModule.setup('/docs', app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the patched index.html at the bare mount path', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<base href="/docs/" />');
    expect(res.payload).toContain('window.__DOCFY_BASE_PATH__ = "/docs/"');
  });

  it('falls back to the patched index.html for a deep client-side route on hard reload', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/users/findAllUsers' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('window.__DOCFY_BASE_PATH__ = "/docs/"');
  });

  it('serves a real static asset file with 200 and byte-identical content', async () => {
    const uiDir = path.dirname(require.resolve('docfy-ui/dist/index.html'));
    const assetName = fs
      .readdirSync(uiDir)
      .find((name) => name !== 'index.html' && fs.statSync(path.join(uiDir, name)).isFile())!;
    const onDiskContent = fs.readFileSync(path.join(uiDir, assetName));

    const res = await app.inject({ method: 'GET', url: `/docs/${assetName}` });

    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.rawPayload, onDiskContent)).toBe(0);
  });

  it('returns 404 for a request outside the mount path, unaffected by the scoped fallback', async () => {
    const res = await app.inject({ method: 'GET', url: '/not-docs' });

    expect(res.statusCode).toBe(404);
  });
});

describe('DocfyUiModule.setup() "Try it out" proxy on a real Fastify app', () => {
  let app: NestFastifyApplication;
  let targetServer: http.Server;
  let targetOrigin: string;

  beforeAll(async () => {
    targetServer = http.createServer((req, res) => {
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });
    await new Promise<void>((resolve) => targetServer.listen(0, resolve));
    targetOrigin = `http://127.0.0.1:${(targetServer.address() as AddressInfo).port}`;

    app = await NestFactory.create<NestFastifyApplication>(EmptyModule, new FastifyAdapter(), { logger: false });
    DocfyUiModule.setup('/docs', app, { openApiDocument: { servers: [{ url: targetOrigin }] } });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  });

  it('injects window.__DOCFY_PROXY_PATH__ into the served index.html', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.payload).toContain('window.__DOCFY_PROXY_PATH__ = "/docs/__docfy_proxy";');
  });

  it('forwards an allowed request end-to-end and passes through the real response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/docs/__docfy_proxy',
      payload: { method: 'GET', url: `${targetOrigin}/users/1` },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload)).toEqual({ method: 'GET', url: '/users/1' });
  });

  it('rejects a disallowed origin with 403 and X-Docfy-Proxy-Error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/docs/__docfy_proxy',
      payload: { method: 'GET', url: 'https://not-allowed.example.com/x' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers['x-docfy-proxy-error']).toBe('origin_not_allowed');
  });
});
