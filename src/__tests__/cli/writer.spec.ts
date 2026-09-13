import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeDocsFile, type WriterOptions } from '../../cli/writer';
import type { ControllerInfo } from '../../cli/extract-methods';

function makeMethod(name: string) {
  return {
    name,
    httpDecorator: 'Get',
    httpPath: null,
    httpStatusCode: null,
    params: [],
    returnType: 'unknown',
    responseType: null,
    isAsync: false,
    isInherited: false,
    inheritedFrom: null,
    requiresAuth: false,
  };
}

function makeCtrl(overrides: Partial<ControllerInfo>, controllerFilePath: string): ControllerInfo {
  return {
    className: 'Controller',
    filePath: controllerFilePath,
    controllerPath: null,
    hasDocsFile: false,
    controllerRequiresAuth: false,
    methods: [makeMethod('findAll')],
    ...overrides,
  };
}

function baseOpts(projectRoot: string): WriterOptions {
  return { projectRoot, force: false, overwrite: false, dryRun: false, format: 'ts' };
}

// Achado 1: a single source file exporting several @Controller classes (a
// common api-gateway pattern grouping proxy controllers by domain) shares
// ONE companion `.docs.ts` file. The 2nd/3rd controller's write used to be
// misreported as "already exists" (because the FILE existed, from the 1st
// controller's own write) and `--force` then merged its methods into the
// FIRST class's docs() call instead of creating its own — silently
// corrupting the file into something that fails to type-check.
describe('writeDocsFile() — multi-class companion file (Achado 1)', () => {
  let tmpDir: string;
  let controllerFile: string;
  let docsFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-writer-test-'));
    controllerFile = path.join(tmpDir, 'agente-ia.controller.ts');
    docsFile = path.join(tmpDir, 'agente-ia.controller.docs.ts');
    fs.writeFileSync(controllerFile, 'export class CasosController {}\nexport class WebhookController {}\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the file for the first controller', () => {
    const casos = makeCtrl({ className: 'CasosController', methods: [makeMethod('criar')] }, controllerFile);
    const result = writeDocsFile(casos, baseOpts(tmpDir));
    expect(result.outcome).toBe('created');
    expect(fs.readFileSync(docsFile, 'utf8')).toContain('docs(CasosController');
  });

  it('appends (not skips) the second controller once the file already exists from the first', () => {
    const casos = makeCtrl({ className: 'CasosController', methods: [makeMethod('criar')] }, controllerFile);
    writeDocsFile(casos, baseOpts(tmpDir));

    const webhook = makeCtrl({ className: 'WebhookController', methods: [makeMethod('receber')] }, controllerFile);
    const result = writeDocsFile(webhook, baseOpts(tmpDir));

    expect(result.outcome).toBe('appended');
    const content = fs.readFileSync(docsFile, 'utf8');
    expect(content).toContain('docs(CasosController');
    expect(content).toContain('docs(WebhookController');
    // The new class's method must live in ITS OWN call, not injected into
    // CasosController's `methods` object (which would fail to type-check).
    const webhookBlock = content.slice(content.indexOf('docs(WebhookController'));
    expect(webhookBlock).toContain('receber');
    const casosBlock = content.slice(0, content.indexOf('docs(WebhookController'));
    expect(casosBlock).toContain('criar');
    expect(casosBlock).not.toContain('receber');
  });

  it('does not duplicate the shared `docs` import when appending', () => {
    const casos = makeCtrl({ className: 'CasosController', methods: [makeMethod('criar')] }, controllerFile);
    writeDocsFile(casos, baseOpts(tmpDir));
    const webhook = makeCtrl({ className: 'WebhookController', methods: [makeMethod('receber')] }, controllerFile);
    writeDocsFile(webhook, baseOpts(tmpDir));

    const content = fs.readFileSync(docsFile, 'utf8');
    const importCount = (content.match(/from 'nestjs-docfy'/g) ?? []).length;
    expect(importCount).toBe(1);
  });

  it('re-running generate reports the already-documented second class as skipped, not appended again', () => {
    const casos = makeCtrl({ className: 'CasosController', methods: [makeMethod('criar')] }, controllerFile);
    writeDocsFile(casos, baseOpts(tmpDir));
    const webhook = makeCtrl({ className: 'WebhookController', methods: [makeMethod('receber')] }, controllerFile);
    writeDocsFile(webhook, baseOpts(tmpDir));

    const result = writeDocsFile(webhook, baseOpts(tmpDir));
    expect(result.outcome).toBe('skipped');
  });

  it('--force adds a new method to the second class without touching the first', () => {
    const casos = makeCtrl({ className: 'CasosController', methods: [makeMethod('criar')] }, controllerFile);
    writeDocsFile(casos, baseOpts(tmpDir));
    const webhook = makeCtrl({ className: 'WebhookController', methods: [makeMethod('receber')] }, controllerFile);
    writeDocsFile(webhook, baseOpts(tmpDir));

    const webhookV2 = makeCtrl(
      { className: 'WebhookController', methods: [makeMethod('receber'), makeMethod('confirmar')] },
      controllerFile,
    );
    const result = writeDocsFile(webhookV2, { ...baseOpts(tmpDir), force: true });
    expect(result.outcome).toBe('merged');
    expect(result.addedMethods).toEqual(['confirmar']);

    const content = fs.readFileSync(docsFile, 'utf8');
    const casosBlock = content.slice(0, content.indexOf('docs(WebhookController'));
    expect(casosBlock).not.toContain('confirmar');
  });

  it('--overwrite regenerates only the targeted class, preserving the sibling class', () => {
    const casos = makeCtrl({ className: 'CasosController', methods: [makeMethod('criar')] }, controllerFile);
    writeDocsFile(casos, baseOpts(tmpDir));
    const webhook = makeCtrl({ className: 'WebhookController', methods: [makeMethod('receber')] }, controllerFile);
    writeDocsFile(webhook, baseOpts(tmpDir));

    const webhookV2 = makeCtrl({ className: 'WebhookController', methods: [makeMethod('novoMetodo')] }, controllerFile);
    const result = writeDocsFile(webhookV2, { ...baseOpts(tmpDir), overwrite: true });
    expect(result.outcome).toBe('overwritten');

    const content = fs.readFileSync(docsFile, 'utf8');
    expect(content).toContain('docs(CasosController');
    expect(content).toContain('criar');
    expect(content).toContain('novoMetodo');
    expect(content).not.toContain('receber');
  });
});
