import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DocfyUiModule, DocfyUiSetupTarget } from '../docfy-ui.module';

function makeRecordingApp(): { app: DocfyUiSetupTarget; calls: Array<{ args: unknown[] }> } {
  const calls: Array<{ args: unknown[] }> = [];
  return {
    app: { use: (...args: unknown[]) => calls.push({ args }) },
    calls,
  };
}

function makeMockResponse() {
  const res = {
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    sentFile: undefined as string | undefined,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    end(chunk?: string) {
      res.body = chunk;
      return res;
    },
    sendFile(filePath: string) {
      res.sentFile = filePath;
      return res;
    },
  };
  return res;
}

describe('DocfyUiModule.setup()', () => {
  it('registers static-asset middleware and an index.html fallback at mountPath', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app);

    const mountPathCalls = calls.filter((c) => c.args[0] === '/docs');
    expect(mountPathCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('the index.html fallback handler serves docfy-ui\'s actual published index.html', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app);

    const fallback = calls.filter((c) => c.args[0] === '/docs').at(-1)!;
    const handler = fallback.args[1] as (req: unknown, res: ReturnType<typeof makeMockResponse>) => void;

    const res = makeMockResponse();
    handler(undefined, res);

    expect(res.sentFile).toMatch(/docfy-ui[/\\]dist[/\\]index\.html$/);
    expect(fs.existsSync(res.sentFile!)).toBe(true);
  });

  it('does not register a /api-json handler when staticSpecPath is omitted', () => {
    const { app, calls } = makeRecordingApp();
    DocfyUiModule.setup('/docs', app);

    expect(calls.some((c) => c.args[0] === '/api-json')).toBe(false);
  });

  it('registers a /api-json handler serving the given file\'s contents when staticSpecPath is set', () => {
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
    expect(() =>
      DocfyUiModule.setup('/docs', app, { staticSpecPath: '/nonexistent/openapi.json' }),
    ).toThrow();
  });
});
