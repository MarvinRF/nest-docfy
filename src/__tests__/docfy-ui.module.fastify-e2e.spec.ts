import * as fs from 'fs';
import * as path from 'path';
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
