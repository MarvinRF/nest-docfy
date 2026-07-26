import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DocfyUiModule, DocfyUiSetupTarget } from '../docfy-ui.module';

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
