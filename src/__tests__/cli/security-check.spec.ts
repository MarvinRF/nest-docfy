import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkSecurity } from '../../cli/security-check';

describe('checkSecurity()', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-security-check-'));
    fs.mkdirSync(path.join(root, 'src'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const writeMain = (body: string) => fs.writeFileSync(path.join(root, 'src', 'main.ts'), body);
  const codes = (nodeVersion = '22.12.0') => checkSecurity(root, nodeVersion).map((f) => f.code);

  it('reports nothing for a setup without the proxy', () => {
    writeMain(`DocfyUiModule.setup('/docs', app);`);
    expect(codes()).toEqual([]);
  });

  it('flags a proxy without proxyAuthorize, with its location', () => {
    writeMain(`\nDocfyUiModule.setup('/docs', app, { openApiDocument: document });`);
    const [finding] = checkSecurity(root, '22.12.0');
    expect(finding.code).toBe('proxy-without-authorize');
    expect(finding.location).toBe(path.join('src', 'main.ts') + ':2');
  });

  it('accepts a proxy with proxyAuthorize', () => {
    writeMain(`DocfyUiModule.setup('/docs', app, { openApiDocument: document, proxyAuthorize: (r) => ok(r) });`);
    expect(codes()).toEqual([]);
  });

  it('flags allowProxyInProduction without proxyAuthorize', () => {
    writeMain(
      `DocfyUiModule.setup('/docs', app, { additionalProxyOrigins: ['https://x'], allowProxyInProduction: true });`,
    );
    expect(codes()).toEqual(['proxy-allowed-in-production']);
  });

  it('flags securityHeaders: false', () => {
    writeMain(`DocfyUiModule.setup('/docs', app, { securityHeaders: false });`);
    expect(codes()).toEqual(['security-headers-disabled']);
  });

  it('skips options it cannot judge statically and files under node_modules', () => {
    writeMain(`DocfyUiModule.setup('/docs', app, options);`);
    fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'node_modules', 'x', 'a.ts'),
      `DocfyUiModule.setup('/d', app, { securityHeaders: false });`,
    );
    expect(codes()).toEqual([]);
  });

  it('flags a Node.js version below 22.12', () => {
    writeMain('');
    expect(codes('20.19.0')).toEqual(['node-version']);
    expect(codes('22.11.0')).toEqual(['node-version']);
    expect(codes('24.0.0')).toEqual([]);
  });
});
