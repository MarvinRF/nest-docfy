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

type ScopedCall = { method: 'register' | 'setNotFoundHandler' | 'addHook'; args: unknown[] };
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
        addHook: (...a: unknown[]) => scopedCalls.push({ method: 'addHook', args: a }),
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

/** Parses the `<script type="application/json" id="docfy-config">` block from served HTML. */
function readHostConfig(html: string | undefined): Record<string, unknown> {
  const match = /<script type="application\/json" id="docfy-config">(.*?)<\/script>/s.exec(html ?? '');
  if (!match) throw new Error('no docfy-config block in served HTML');
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function fallbackBody(calls: ReturnType<typeof makeRecordingApp>['calls'], mountPath = '/docs'): string {
  const fallback = calls.filter((c) => c.args[0] === mountPath).at(-1)!;
  const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
  const res = makeMockResponse();
  handler(undefined, res);
  return res.body ?? '';
}

const JSON_HEADERS = { 'content-type': 'application/json' };

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
    expect(res.body).toBe(
      PATCHED_INDEX_HTML.replace(
        '<head>',
        `<head>\n    <base href="/docs/" />\n    <script type="application/json" id="docfy-config">{"basePath":"/docs/"}</script>`,
      ),
    );
    expect(res.body).not.toMatch(/<script>/);
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

    expect(readHostConfig(res.body).specs).toEqual(specs);
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
    expect(readHostConfig(res.body).proxyPath).toBe('/docs/__docfy_proxy');
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
    await handler({ headers: JSON_HEADERS, body: { method: 'GET', url: 'https://internal.local/admin' } }, res);

    expect(res.statusCode).toBe(403);
    expect(res.headers['x-docfy-proxy-error']).toBe('origin_not_allowed');
  });

  describe('proxy access control', () => {
    function proxyHandler(calls: ReturnType<typeof makeRecordingApp>['calls']) {
      const proxyCall = calls.find((c) => c.args[0] === '/docs/__docfy_proxy');
      return proxyCall?.args[1] as ((req: unknown, res: ReturnType<typeof makeMockResponse>) => unknown) | undefined;
    }
    const servers = { openApiDocument: { servers: [{ url: 'https://api.example.com' }] } };

    it('rejects a non-JSON content type with 415 (blocks cross-site form posts)', async () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, servers);
      const res = makeMockResponse();
      await proxyHandler(calls)!({ headers: { 'content-type': 'text/plain' }, body: '{}' }, res);
      expect(res.statusCode).toBe(415);
      expect(res.headers['x-docfy-proxy-error']).toBe('unsupported_media_type');
    });

    it('rejects with 403 when proxyAuthorize returns false', async () => {
      const { app, calls } = makeRecordingApp();
      const proxyAuthorize = jest.fn().mockResolvedValue(false);
      DocfyUiModule.setup('/docs', app, { ...servers, proxyAuthorize });
      const res = makeMockResponse();
      const req = { headers: JSON_HEADERS, body: { method: 'GET', url: 'https://api.example.com/x' } };
      await proxyHandler(calls)!(req, res);
      expect(proxyAuthorize).toHaveBeenCalledWith(req);
      expect(res.statusCode).toBe(403);
      expect(res.headers['x-docfy-proxy-error']).toBe('proxy_unauthorized');
    });

    it('fails closed with 403 when proxyAuthorize throws', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, {
        ...servers,
        proxyAuthorize: () => {
          throw new Error('session store down');
        },
      });
      const res = makeMockResponse();
      await proxyHandler(calls)!({ headers: JSON_HEADERS, body: {} }, res);
      expect(res.statusCode).toBe(403);
      error.mockRestore();
    });

    describe('with NODE_ENV=production', () => {
      const originalEnv = process.env.NODE_ENV;
      let error: jest.SpyInstance;
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      });
      afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        error.mockRestore();
      });

      it('does not register the proxy without proxyAuthorize, and says why', () => {
        const { app, calls } = makeRecordingApp();
        DocfyUiModule.setup('/docs', app, servers);
        expect(proxyHandler(calls)).toBeUndefined();
        expect(readHostConfig(fallbackBody(calls)).proxyPath).toBeUndefined();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('"Try it out" proxy is DISABLED'));
      });

      it('registers the proxy when proxyAuthorize is given', () => {
        const { app, calls } = makeRecordingApp();
        DocfyUiModule.setup('/docs', app, { ...servers, proxyAuthorize: () => true });
        expect(proxyHandler(calls)).toBeDefined();
      });

      it('registers the proxy when allowProxyInProduction is set', () => {
        const { app, calls } = makeRecordingApp();
        DocfyUiModule.setup('/docs', app, { ...servers, allowProxyInProduction: true });
        expect(proxyHandler(calls)).toBeDefined();
      });

      it('never sends security notices to the browser', () => {
        const { app, calls } = makeRecordingApp();
        DocfyUiModule.setup('/docs', app, { ...servers, allowProxyInProduction: true, securityHeaders: false });
        expect(readHostConfig(fallbackBody(calls)).securityNotices).toBeUndefined();
      });
    });

    it('outside production, sends a notice when the proxy has no proxyAuthorize', () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, servers);
      const notices = readHostConfig(fallbackBody(calls)).securityNotices as string[];
      expect(notices).toEqual([expect.stringContaining('has no proxyAuthorize hook')]);
    });

    it('sends no notice when proxyAuthorize is given', () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, { ...servers, proxyAuthorize: () => true });
      expect(readHostConfig(fallbackBody(calls)).securityNotices).toBeUndefined();
    });
  });

  describe('security headers', () => {
    function headersMiddleware(calls: ReturnType<typeof makeRecordingApp>['calls']) {
      const first = calls.find((c) => c.args[0] === '/docs');
      const res = makeMockResponse();
      const next = jest.fn();
      (first!.args[1] as (req: unknown, res: unknown, next: () => void) => void)(undefined, res, next);
      return { headers: res.headers, next };
    }

    it('sends a strict CSP and hardening headers before the static middleware', () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, {
        specs: [{ name: 'orders', url: 'https://orders.internal/api-json' }],
        cspConnectSrc: ['https://api.example.com'],
      });
      const { headers, next } = headersMiddleware(calls);
      expect(next).toHaveBeenCalled();
      expect(headers['Content-Security-Policy']).toContain("script-src 'self'");
      expect(headers['Content-Security-Policy']).toContain(
        "connect-src 'self' https://orders.internal https://api.example.com",
      );
      expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'self'");
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['Referrer-Policy']).toBe('no-referrer');
    });

    it('uses contentSecurityPolicy verbatim when given', () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, { contentSecurityPolicy: "default-src 'none'" });
      expect(headersMiddleware(calls).headers['Content-Security-Policy']).toBe("default-src 'none'");
    });

    it('registers no headers middleware with securityHeaders: false, and warns in dev', () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, { securityHeaders: false });
      expect(calls.filter((c) => c.args[0] === '/docs')).toHaveLength(2);
      expect(readHostConfig(fallbackBody(calls)).securityNotices).toEqual([
        expect.stringContaining('Security headers are disabled'),
      ]);
    });

    it('on Fastify, sets the same headers from a scoped onRequest hook', () => {
      const { app, scopedRegistrations } = makeRecordingApp('fastify');
      DocfyUiModule.setup('/docs', app);
      const hook = scopedRegistrations[0].scopedCalls.find((c) => c.method === 'addHook')!;
      expect(hook.args[0]).toBe('onRequest');
      const reply = makeMockResponse();
      const done = jest.fn();
      (hook.args[1] as (req: unknown, reply: unknown, done: () => void) => void)(undefined, reply, done);
      expect(reply.headers['Content-Security-Policy']).toContain("script-src 'self'");
      expect(done).toHaveBeenCalled();
    });
  });

  describe('injected HTML hardening', () => {
    function getBodyAt(mountPath: string, calls: ReturnType<typeof makeRecordingApp>['calls']): string {
      const fallback = calls.filter((c) => c.args[0] === mountPath).at(-1)!;
      const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
      const res = makeMockResponse();
      handler(undefined, res);
      return res.body ?? '';
    }

    it('escapes a </script> in a spec name so it cannot break out of the injected <script> tag', () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app, { specs: [{ name: '</script><script>alert(1)</script>', url: '/a' }] });

      const body = getBodyAt('/docs', calls);
      expect(body).not.toContain('</script><script>alert');
      expect(body).toContain('\\u003c/script>\\u003cscript>alert(1)');
    });

    it('escapes the mount path inside the <base href> attribute', () => {
      const { app, calls } = makeRecordingApp();
      const mountPath = '/docs"><script>alert(1)</script>';
      DocfyUiModule.setup(mountPath, app);

      const body = getBodyAt(mountPath, calls);
      expect(body).not.toContain('"><script>alert');
      expect(body).toContain('<base href="/docs&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;/" />');
    });
  });

  describe('guides option', () => {
    function getFallbackBody(
      app: ReturnType<typeof makeRecordingApp>['app'],
      calls: ReturnType<typeof makeRecordingApp>['calls'],
    ): string {
      const fallback = calls.filter((c) => c.args[0] === '/docs').at(-1)!;
      const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;
      const res = makeMockResponse();
      handler(undefined, res);
      return res.body ?? '';
    }

    it('does not inject window.__DOCFY_GUIDES__ when guides is omitted', () => {
      const { app, calls } = makeRecordingApp();
      DocfyUiModule.setup('/docs', app);
      expect(getFallbackBody(app, calls)).not.toContain('__DOCFY_GUIDES__');
    });

    it('injects window.__DOCFY_GUIDES__ as JSON when guides is provided', () => {
      const { app, calls } = makeRecordingApp();
      const guides = [{ slug: 'getting-started', title: 'Getting Started', content: '# Hi' }];
      DocfyUiModule.setup('/docs', app, { guides });

      expect(readHostConfig(getFallbackBody(app, calls)).guides).toEqual(guides);
    });

    it('escapes a literal </script> in guide content so it cannot break out of the injected <script> tag', () => {
      const { app, calls } = makeRecordingApp();
      const guides = [{ slug: 'xss', title: 'XSS', content: 'Example: <script>alert(1)</script>' }];
      DocfyUiModule.setup('/docs', app, { guides });

      const body = getFallbackBody(app, calls);
      expect(body).not.toContain('</script>alert');
      expect(body).toContain('\\u003cscript>alert(1)\\u003c/script>');
    });
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
    expect(readHostConfig(reply.body).basePath).toBe('/docs/');
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
