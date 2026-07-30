import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLlmsFullTxt, buildLlmsTxt, normalizeDocument } from 'docfy-core';
import type { DocumentModel } from 'docfy-core';
import { DocfyUiModule, DocfyUiSetupTarget } from '../docfy-ui.module';

jest.mock('docfy-core', () => ({
  normalizeDocument: jest.fn(),
  buildLlmsTxt: jest.fn(),
  buildLlmsFullTxt: jest.fn(),
}));

const mockNormalizeDocument = normalizeDocument as jest.MockedFunction<typeof normalizeDocument>;
const mockBuildLlmsTxt = buildLlmsTxt as jest.MockedFunction<typeof buildLlmsTxt>;
const mockBuildLlmsFullTxt = buildLlmsFullTxt as jest.MockedFunction<typeof buildLlmsFullTxt>;

type ScopedCall = { method: 'register' | 'setNotFoundHandler'; args: unknown[] };
type ScopedRegistration = { opts: { prefix: string }; scopedCalls: ScopedCall[] };

function makeRecordingApp(type: 'express' | 'fastify' = 'express') {
  const calls: Array<{ args: unknown[] }> = [];
  const scopedRegistrations: ScopedRegistration[] = [];

  const fakeInstance = {
    register: (plugin: (scoped: unknown, opts: unknown, done: () => void) => void, opts: { prefix: string }) => {
      const scopedCalls: ScopedCall[] = [];
      const scoped = {
        register: (...a: unknown[]) => scopedCalls.push({ method: 'register', args: a }),
        setNotFoundHandler: (...a: unknown[]) => scopedCalls.push({ method: 'setNotFoundHandler', args: a }),
      };
      plugin(scoped, opts, () => {});
      scopedRegistrations.push({ opts, scopedCalls });
    },
  };

  const httpAdapter = {
    getType: () => type,
    get: (...args: unknown[]) => calls.push({ args }),
    post: (...args: unknown[]) => calls.push({ args }),
    getInstance: () => fakeInstance,
  };

  const app: DocfyUiSetupTarget = {
    use: (...args: unknown[]) => calls.push({ args }),
    getHttpAdapter: () => httpAdapter,
  };

  return { app, calls, scopedRegistrations };
}

function makeMockResponse() {
  const res = {
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    statusCode: undefined as number | undefined,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    end(chunk?: string) {
      res.body = chunk;
      return res;
    },
    send(chunk?: string) {
      res.body = chunk;
      return res;
    },
    type(contentType: string) {
      res.headers['Content-Type'] = contentType;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    header(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  };
  return res;
}

const PATCHED_INDEX_HTML = fs.readFileSync(require.resolve('docfy-ui/dist/index.html'), 'utf8');

describe('DocfyUiModule.setup() — Express', () => {
  it('registers static-asset middleware and an index.html fallback at mountPath', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app);

    const mountPathCalls = calls.filter((c) => c.args[0] === '/docs');
    expect(mountPathCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("the index.html fallback handler serves docfy-ui's actual published index.html", () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app);

    const fallback = calls.filter((c) => c.args[0] === '/docs').at(-1)!;
    const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;

    const res = makeMockResponse();
    handler(undefined, res);

    expect(res.headers['Content-Type']).toBe('text/html');
    expect(res.body).toContain('<base href="/docs/" />');
    expect(res.body).toContain('window.__DOCFY_BASE_PATH__ = "/docs/"');
    expect(res.body).toBe(
      PATCHED_INDEX_HTML.replace(
        '<head>',
        `<head>\n    <base href="/docs/" />\n    <script>window.__DOCFY_BASE_PATH__ = "/docs/";</script>`,
      ),
    );
  });

  it('does not register a /api-json handler when staticSpecPath is omitted', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app);

    expect(calls.some((c) => c.args[0] === '/api-json')).toBe(false);
  });

  it("registers a /api-json handler serving the given file's contents when staticSpecPath is set", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-ui-module-test-'));
    const specPath = path.join(tmpDir, 'openapi.json');
    fs.writeFileSync(specPath, '{"openapi":"3.0.0"}');

    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app, { staticSpecPath: specPath });

    const specCall = calls.find((c) => c.args[0] === '/api-json');
    expect(specCall).toBeDefined();

    const handler = specCall!.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
    const res = makeMockResponse();
    handler(undefined, res);

    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.body).toBe('{"openapi":"3.0.0"}');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers the /api-json handler before the UI mount-path middleware, so it takes precedence', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-ui-module-test-'));
    const specPath = path.join(tmpDir, 'openapi.json');
    fs.writeFileSync(specPath, '{}');

    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app, { staticSpecPath: specPath });

    const specIndex = calls.findIndex((c) => c.args[0] === '/api-json');
    const firstMountIndex = calls.findIndex((c) => c.args[0] === '/docs');
    expect(specIndex).toBeGreaterThanOrEqual(0);
    expect(specIndex).toBeLessThan(firstMountIndex);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws if staticSpecPath does not point to an existing file', () => {
    const { app } = makeRecordingApp();
    expect(() => DocfyUiModule.setup('/docs', app, { staticSpecPath: '/nonexistent/openapi.json' })).toThrow();
  });

  it('does not inject window.__DOCFY_SPECS__ when specs is omitted', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app);

    const fallback = calls.filter((c) => c.args[0] === '/docs').at(-1)!;
    const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
    const res = makeMockResponse();
    handler(undefined, res);

    expect(res.body).not.toContain('__DOCFY_SPECS__');
  });

  it('injects window.__DOCFY_SPECS__ as JSON when specs is provided', () => {
    const { app, calls } = makeRecordingApp();
    const specs = [
      { name: 'users-service', url: '/users-service/api-json' },
      { name: 'orders-service', url: 'https://orders.internal/api-json' },
    ];
    DocfyUiModule.setup('/docs', app, { specs });

    const fallback = calls.filter((c) => c.args[0] === '/docs').at(-1)!;
    const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
    const res = makeMockResponse();
    handler(undefined, res);

    expect(res.body).toContain(`window.__DOCFY_SPECS__ = ${JSON.stringify(specs)};`);
  });

  it('does not register a proxy route or inject window.__DOCFY_PROXY_PATH__ when neither proxy option is given', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app);

    expect(calls.some((c) => c.args[0] === '/docs/__docfy_proxy')).toBe(false);

    const fallback = calls.filter((c) => c.args[0] === '/docs').at(-1)!;
    const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
    const res = makeMockResponse();
    handler(undefined, res);
    expect(res.body).not.toContain('__DOCFY_PROXY_PATH__');
  });

  it('registers a POST proxy route scoped under mountPath and injects window.__DOCFY_PROXY_PATH__ when openApiDocument is given', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app, { openApiDocument: { servers: [{ url: 'https://api.example.com' }] } });

    const proxyCall = calls.find((c) => c.args[0] === '/docs/__docfy_proxy');
    expect(proxyCall).toBeDefined();

    const fallback = calls.filter((c) => c.args[0] === '/docs').at(-1)!;
    const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
    const res = makeMockResponse();
    handler(undefined, res);
    expect(res.body).toContain('window.__DOCFY_PROXY_PATH__ = "/docs/__docfy_proxy";');
  });

  it('also registers the proxy route when only additionalProxyOrigins is given (no openApiDocument)', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app, { additionalProxyOrigins: ['https://api.example.com'] });

    expect(calls.some((c) => c.args[0] === '/docs/__docfy_proxy')).toBe(true);
  });

  it('the registered proxy handler rejects a disallowed origin with a 403 and X-Docfy-Proxy-Error header', async () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app, { openApiDocument: { servers: [{ url: 'https://api.example.com' }] } });

    const proxyCall = calls.find((c) => c.args[0] === '/docs/__docfy_proxy')!;
    const handler = proxyCall.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => unknown;
    const res = makeMockResponse();
    await handler({ body: { method: 'GET', url: 'https://internal.local/admin' } }, res);

    expect(res.statusCode).toBe(403);
    expect(res.headers['x-docfy-proxy-error']).toBe('origin_not_allowed');
  });

  describe('llmsTxt option', () => {
    const fakeDocument: DocumentModel = {
      info: { title: 'Demo API', version: '1.0.0', description: undefined },
      tagGroups: [],
      securitySchemes: {},
      servers: [],
    };

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('does not register llms.txt routes when the option is omitted', () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app);

      expect(calls.some((c) => typeof c.args[0] === 'string' && c.args[0].includes('llms'))).toBe(false);
    });

    it('warns and registers nothing when llmsTxt: true is given without staticSpecPath', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, { llmsTxt: true });

      expect(calls.some((c) => typeof c.args[0] === 'string' && c.args[0].includes('llms'))).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('llmsTxt: true'));
      warnSpy.mockRestore();
    });

    it('serves llms.txt and llms-full.txt scoped under mountPath when llmsTxt.document is given', async () => {
      mockNormalizeDocument.mockResolvedValue(fakeDocument);
      mockBuildLlmsTxt.mockReturnValue('llms.txt body');
      mockBuildLlmsFullTxt.mockReturnValue('llms-full.txt body');

      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, { llmsTxt: { document: { openapi: '3.0.0' } } });

      const llmsTxtCall = calls.find((c) => c.args[0] === '/docs/llms.txt');
      const llmsFullTxtCall = calls.find((c) => c.args[0] === '/docs/llms-full.txt');
      expect(llmsTxtCall).toBeDefined();
      expect(llmsFullTxtCall).toBeDefined();

      const res = makeMockResponse();
      await (llmsTxtCall!.args[1] as (req: unknown, res: unknown) => Promise<void>)(undefined, res);

      expect(mockNormalizeDocument).toHaveBeenCalledWith({ openapi: '3.0.0' });
      expect(mockBuildLlmsTxt).toHaveBeenCalledWith(fakeDocument, {
        title: undefined,
        description: undefined,
        docsBaseUrl: '/docs/',
      });
      expect(res.headers['Content-Type']).toBe('text/plain');
      expect(res.body).toBe('llms.txt body');
    });

    it('reuses the parsed staticSpecPath document when llmsTxt: true is given alongside it', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-ui-module-llms-'));
      const specPath = path.join(tmpDir, 'openapi.json');
      fs.writeFileSync(specPath, '{"openapi":"3.0.0","info":{"title":"From file"}}');

      mockNormalizeDocument.mockResolvedValue(fakeDocument);
      mockBuildLlmsTxt.mockReturnValue('llms.txt body');
      mockBuildLlmsFullTxt.mockReturnValue('llms-full.txt body');

      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, { staticSpecPath: specPath, llmsTxt: true });

      const llmsTxtCall = calls.find((c) => c.args[0] === '/docs/llms.txt')!;
      const res = makeMockResponse();
      await (llmsTxtCall.args[1] as (req: unknown, res: unknown) => Promise<void>)(undefined, res);

      expect(mockNormalizeDocument).toHaveBeenCalledWith({ openapi: '3.0.0', info: { title: 'From file' } });

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('responds 500 when building llms.txt fails', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockNormalizeDocument.mockRejectedValue(new Error('boom'));

      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, { llmsTxt: { document: {} } });

      const llmsTxtCall = calls.find((c) => c.args[0] === '/docs/llms.txt')!;
      const res = makeMockResponse();
      await (llmsTxtCall.args[1] as (req: unknown, res: unknown) => Promise<void>)(undefined, res);

      expect(res.statusCode).toBe(500);
      errorSpy.mockRestore();
    });
  });
});

describe('DocfyUiModule.setup() — Fastify', () => {
  it('registers a single scoped plugin at mountPath instead of using app.use()', () => {
    const { app, calls, scopedRegistrations } = makeRecordingApp('fastify');
    DocfyUiModule.setup('/docs', app);

    expect(calls.some((c) => c.args[0] === '/docs')).toBe(false);
    expect(scopedRegistrations).toHaveLength(1);
    expect(scopedRegistrations[0].opts).toEqual({ prefix: '/docs' });
  });

  it('registers @fastify/static with wildcard/index disabled and decorateReply off', () => {
    const { app, scopedRegistrations } = makeRecordingApp('fastify');
    DocfyUiModule.setup('/docs', app);

    const registerCall = scopedRegistrations[0].scopedCalls.find((c) => c.method === 'register');
    expect(registerCall).toBeDefined();
    const [, opts] = registerCall!.args as [unknown, Record<string, unknown>];
    expect(opts.wildcard).toBe(false);
    expect(opts.index).toBe(false);
    expect(opts.decorateReply).toBe(false);
    expect(opts.root as string).toMatch(/docfy-ui[/\\]dist$/);
  });

  it('the scoped not-found handler serves the patched index.html', () => {
    const { app, scopedRegistrations } = makeRecordingApp('fastify');
    DocfyUiModule.setup('/docs', app);

    const notFoundCall = scopedRegistrations[0].scopedCalls.find((c) => c.method === 'setNotFoundHandler');
    expect(notFoundCall).toBeDefined();
    const handler = notFoundCall!.args[0] as (req: unknown, reply: ReturnType<typeof makeMockResponse>) => void;

    const reply = makeMockResponse();
    handler(undefined, reply);

    expect(reply.headers['Content-Type']).toBe('text/html');
    expect(reply.body).toContain('<base href="/docs/" />');
    expect(reply.body).toContain('window.__DOCFY_BASE_PATH__ = "/docs/"');
  });

  it('still registers /api-json via httpAdapter.get(), unaffected by the Fastify branch', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-ui-module-test-'));
    const specPath = path.join(tmpDir, 'openapi.json');
    fs.writeFileSync(specPath, '{"openapi":"3.0.0"}');

    const { app, calls } = makeRecordingApp('fastify');
    DocfyUiModule.setup('/docs', app, { staticSpecPath: specPath });

    const specCall = calls.find((c) => c.args[0] === '/api-json');
    expect(specCall).toBeDefined();

    const handler = specCall!.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
    const res = makeMockResponse();
    handler(undefined, res);

    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.body).toBe('{"openapi":"3.0.0"}');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws a clear error when @fastify/static cannot be resolved', () => {
    jest.resetModules();
    jest.doMock('@fastify/static', () => {
      throw new Error("Cannot find module '@fastify/static'");
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- needs a fresh module instance after jest.doMock, a static import wouldn't re-evaluate
    const { DocfyUiModule: IsolatedDocfyUiModule } = require('../docfy-ui.module');
    const { app } = makeRecordingApp('fastify');

    expect(() => IsolatedDocfyUiModule.setup('/docs', app)).toThrow(/@fastify\/static/);

    jest.dontMock('@fastify/static');
    jest.resetModules();
  });
});
