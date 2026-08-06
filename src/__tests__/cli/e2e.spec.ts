/**
 * End-to-end integration tests.
 * Each test spins up the CLI against a real fixture directory on disk.
 * No mocking — real fs reads and writes, real ts-morph analysis.
 * Generated .docs.ts files are cleaned up after each test.
 */
import { execSync, ExecSyncOptionsWithBufferEncoding } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLI = path.join(__dirname, '../../../dist/cli/index.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function fix(name: string): string {
  return path.join(FIXTURES, name);
}

// scan-controllers.spec.ts and watch.spec.ts read fixtures/scan concurrently
// (separate Jest worker processes, different files) — mutating the checked-in
// fixture in place raced with their reads and produced sporadic
// "Cannot read properties of undefined" failures there. Each describe block
// below gets its own throwaway copy instead, so writes/deletes never touch
// the directory other test files depend on staying read-only.
const isolatedDirs: string[] = [];

function isolatedFixture(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `docfy-e2e-${name}-`));
  fs.cpSync(fix(name), dir, { recursive: true });
  isolatedDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of isolatedDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function run(args: string, cwd?: string): { stdout: string; stderr: string; code: number } {
  const opts: ExecSyncOptionsWithBufferEncoding = { encoding: 'buffer', cwd };
  try {
    const stdout = execSync(`node "${CLI}" ${args}`, opts);
    return { stdout: stdout.toString(), stderr: '', code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      code: err.status ?? 1,
    };
  }
}

/**
 * Waits for `filePath` to become visible to fs.existsSync in *this*
 * process. Immediately after `generate` writes a file in a just-spawned
 * child process, a fresh read from a different process occasionally
 * doesn't see it yet on this environment's filesystem — a real,
 * pre-existing timing quirk (confirmed via manual reproduction, unrelated
 * to nestjs-docfy's own synchronous fs.writeFileSync usage), not
 * something worth working around in the CLI itself. This only exists to
 * keep tests that immediately follow a `generate` with a `check`/
 * `coverage` call deterministic.
 */
function waitForFile(filePath: string, timeoutMs = 1000): void {
  const deadline = Date.now() + timeoutMs;
  const sync = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(filePath)) {
    if (Date.now() > deadline) return;
    Atomics.wait(sync, 0, 0, 10);
  }
}

function findDocs(dir: string): string[] {
  const result: string[] = [];
  function walk(d: string): void {
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (entry.endsWith('.docs.ts') || entry.endsWith('.docs.js')) result.push(full);
    }
  }
  try {
    walk(dir);
  } catch {
    /* dir may not exist */
  }
  return result;
}

function cleanup(dir: string): void {
  findDocs(dir).forEach((f) => fs.unlinkSync(f));
}

// ---------------------------------------------------------------------------
// Simple project
// ---------------------------------------------------------------------------
describe('E2E — simple project', () => {
  const ROOT = isolatedFixture('scan');

  afterEach(() => cleanup(ROOT));

  it('exits 0 and creates docs files', () => {
    const { code, stdout } = run(`generate --root "${ROOT}"`);
    expect(code).toBe(0);
    expect(stdout).toContain('[created]');
  });

  it('creates one .docs.ts per controller', () => {
    run(`generate --root "${ROOT}"`);
    const docs = findDocs(ROOT);
    expect(docs.length).toBeGreaterThanOrEqual(4); // UsersController, PlainController, ProductsController, BrokenController
    expect(docs.every((f) => f.endsWith('.docs.ts'))).toBe(true);
  });

  it('docs file contains docs() call with correct controller name', () => {
    run(`generate --root "${ROOT}"`);
    const usersDoc = path.join(ROOT, 'src/users/users.controller.docs.ts');
    expect(fs.existsSync(usersDoc)).toBe(true);
    const content = fs.readFileSync(usersDoc, 'utf8');
    expect(content).toContain('docs(UsersController,');
    expect(content).toContain('findAll:');
    expect(content).toContain('findOne:');
    expect(content).toContain('create:');
  });

  it('idempotent: second run skips all files', () => {
    run(`generate --root "${ROOT}"`);
    const { code, stdout } = run(`generate --root "${ROOT}"`);
    expect(code).toBe(0);
    expect(stdout).toContain('[skipped');
    expect(stdout).not.toContain('[created]');
  });

  it('--force merges without duplicating existing methods', () => {
    run(`generate --root "${ROOT}"`);
    const usersDoc = path.join(ROOT, 'src/users/users.controller.docs.ts');
    const before = fs.readFileSync(usersDoc, 'utf8');

    run(`generate --root "${ROOT}" --force`);
    const after = fs.readFileSync(usersDoc, 'utf8');

    // method keys should appear exactly once
    const findAllCount = (after.match(/findAll:/g) ?? []).length;
    expect(findAllCount).toBe(1);
    // no new methods added (all already existed) — just verify it didn't throw
    void before;
  });

  it('--overwrite discards manual edits and regenerates from scratch', () => {
    run(`generate --root "${ROOT}"`);
    const usersDoc = path.join(ROOT, 'src/users/users.controller.docs.ts');
    fs.appendFileSync(usersDoc, '\n// a manual edit that --force would have preserved\n');

    const { code, stdout } = run(`generate --root "${ROOT}" --overwrite`);
    expect(code).toBe(0);
    expect(stdout).toContain('[overwritten]');
    const after = fs.readFileSync(usersDoc, 'utf8');
    expect(after).not.toContain('a manual edit that --force would have preserved');
    expect(after).toContain('findAll:');
  });

  it('--dry-run writes nothing to disk', () => {
    const { code } = run(`generate --root "${ROOT}" --dry-run`);
    expect(code).toBe(0);
    expect(findDocs(ROOT)).toHaveLength(0);
  });

  it('--format js generates .docs.js files with require()', () => {
    const { code } = run(`generate --root "${ROOT}" --format js`);
    expect(code).toBe(0);
    const jsDocs = findDocs(ROOT).filter((f) => f.endsWith('.docs.js'));
    expect(jsDocs.length).toBeGreaterThan(0);
    const content = fs.readFileSync(jsDocs[0], 'utf8');
    expect(content).toContain("require('nestjs-docfy')");
  });

  it('--quiet suppresses non-error output', () => {
    const { stdout, code } = run(`generate --root "${ROOT}" --quiet`);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// --link-controller
// ---------------------------------------------------------------------------
describe('E2E — --link-controller', () => {
  // Each test gets its own fixture copy — unlike the read-mostly .docs.ts
  // assertions elsewhere in this file, these tests mutate the controller
  // .ts source itself, so sharing one ROOT across tests would leak state
  // between them (e.g. a later "dry-run" assertion seeing an
  // already-linked controller from an earlier test).
  function freshUsersController(): { root: string; controllerPath: string } {
    const root = isolatedFixture('scan');
    return { root, controllerPath: path.join(root, 'src/users/users.controller.ts') };
  }

  it('inserts the import and @WithDocs() into the controller', () => {
    const { root, controllerPath } = freshUsersController();
    const { code, stdout } = run(`generate --root "${root}" --link-controller`);
    expect(code).toBe(0);
    expect(stdout).toContain('@WithDocs()');

    const content = fs.readFileSync(controllerPath, 'utf8');
    expect(content).toContain("import { WithDocs } from 'nestjs-docfy';");
    expect(content).toMatch(/@WithDocs\(\)\s*\n@Controller\('users'\)/);
  });

  it('is idempotent: a second run makes no further changes', () => {
    const { root, controllerPath } = freshUsersController();
    run(`generate --root "${root}" --link-controller`);
    const after1 = fs.readFileSync(controllerPath, 'utf8');

    const { code, stdout } = run(`generate --root "${root}" --link-controller`);
    expect(code).toBe(0);
    expect(stdout).toContain('[already linked]');

    const after2 = fs.readFileSync(controllerPath, 'utf8');
    expect(after2).toBe(after1);
  });

  it('--dry-run leaves the controller file untouched', () => {
    const { root, controllerPath } = freshUsersController();
    const before = fs.readFileSync(controllerPath, 'utf8');
    const { code, stdout } = run(`generate --root "${root}" --link-controller --dry-run`);
    expect(code).toBe(0);
    expect(stdout).toContain('would be added');
    expect(fs.readFileSync(controllerPath, 'utf8')).toBe(before);
  });

  it('without --link-controller, the controller is never touched', () => {
    const { root, controllerPath } = freshUsersController();
    const before = fs.readFileSync(controllerPath, 'utf8');
    run(`generate --root "${root}"`);
    expect(fs.readFileSync(controllerPath, 'utf8')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// init
// Each test gets its own fixture copy — mutates app.module.ts, the
// controller, and package.json, so sharing one ROOT across tests would leak
// state between them (same reasoning as the --link-controller block above).
// ---------------------------------------------------------------------------
describe('E2E — init', () => {
  function freshInitProject(): {
    root: string;
    appModulePath: string;
    controllerPath: string;
    packageJsonPath: string;
  } {
    const root = isolatedFixture('init');
    return {
      root,
      appModulePath: path.join(root, 'src/app.module.ts'),
      controllerPath: path.join(root, 'src/users/users.controller.ts'),
      packageJsonPath: path.join(root, 'package.json'),
    };
  }

  it('wires DocfyModule, decorates the controller, generates docs, and adds package.json scripts', () => {
    const { root, appModulePath, controllerPath, packageJsonPath } = freshInitProject();
    const { code, stdout } = run(`init --root "${root}"`);
    expect(code).toBe(0);
    expect(stdout).toContain('DocfyModule.forRoot()');
    expect(stdout).toContain('@WithDocs()');

    const appModule = fs.readFileSync(appModulePath, 'utf8');
    expect(appModule).toContain("import { DocfyModule } from 'nestjs-docfy';");
    expect(appModule).toContain('imports: [DocfyModule.forRoot(), UsersModule]');

    const controller = fs.readFileSync(controllerPath, 'utf8');
    expect(controller).toContain("import { WithDocs } from 'nestjs-docfy';");
    expect(controller).toMatch(/@WithDocs\(\)\s*\n@Controller\('users'\)/);

    const docsFile = path.join(root, 'src/users/users.controller.docs.ts');
    expect(fs.existsSync(docsFile)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(pkg.scripts).toMatchObject({
      build: 'tsc',
      'docs:generate': 'nestjs-docfy generate',
      'docs:preview': 'nestjs-docfy generate --dry-run',
    });
  });

  it('is idempotent: a second run makes no further changes', () => {
    const { root, appModulePath, controllerPath, packageJsonPath } = freshInitProject();
    run(`init --root "${root}"`);
    const appModuleBefore = fs.readFileSync(appModulePath, 'utf8');
    const controllerBefore = fs.readFileSync(controllerPath, 'utf8');
    const packageJsonBefore = fs.readFileSync(packageJsonPath, 'utf8');

    const { code, stdout } = run(`init --root "${root}"`);
    expect(code).toBe(0);
    expect(stdout).toContain('root module already wired');
    expect(stdout).toContain('already linked');
    expect(stdout).toContain('already present');

    expect(fs.readFileSync(appModulePath, 'utf8')).toBe(appModuleBefore);
    expect(fs.readFileSync(controllerPath, 'utf8')).toBe(controllerBefore);
    expect(fs.readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore);
  });

  it('--dry-run leaves every file untouched', () => {
    const { root, appModulePath, controllerPath, packageJsonPath } = freshInitProject();
    const appModuleBefore = fs.readFileSync(appModulePath, 'utf8');
    const controllerBefore = fs.readFileSync(controllerPath, 'utf8');
    const packageJsonBefore = fs.readFileSync(packageJsonPath, 'utf8');

    const { code, stdout } = run(`init --root "${root}" --dry-run`);
    expect(code).toBe(0);
    expect(stdout).toContain('would be added');

    expect(fs.readFileSync(appModulePath, 'utf8')).toBe(appModuleBefore);
    expect(fs.readFileSync(controllerPath, 'utf8')).toBe(controllerBefore);
    expect(fs.readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore);
    expect(fs.existsSync(path.join(root, 'src/users/users.controller.docs.ts'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// check --json / coverage --json
// A dedicated, single-controller fixture (not `scan`, which deliberately
// has a two-controllers-sharing-one-docs-file edge case that makes
// "fully documented" a fragile thing to assert against).
// ---------------------------------------------------------------------------
describe('E2E — check/coverage --json', () => {
  const ROOT = isolatedFixture('json-output');

  afterEach(() => cleanup(ROOT));

  it('check --json prints a single valid JSON object and passes once docs are generated', () => {
    run(`generate --root "${ROOT}"`);
    waitForFile(path.join(ROOT, 'src/items.controller.docs.ts'));
    const { code, stdout } = run(`check --root "${ROOT}" --json`);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toMatchObject({ issues: [], passed: true, controllersChecked: 1 });
  });

  it('check --json reports issues and exits non-zero when docs are missing', () => {
    const { code, stdout } = run(`check --root "${ROOT}" --json`);
    expect(code).not.toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.passed).toBe(false);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatchObject({ controllerClass: 'ItemsController', kind: 'missing-file' });
  });

  it('coverage --json prints a single valid JSON object with the coverage report', () => {
    run(`generate --root "${ROOT}"`);
    waitForFile(path.join(ROOT, 'src/items.controller.docs.ts'));
    const { code, stdout } = run(`coverage --root "${ROOT}" --json`);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toMatchObject({
      passed: true,
      min: null,
      totalEndpoints: 2,
      documentedEndpoints: 2,
      coveragePercent: 100,
    });
  });

  it('coverage --json --min fails and reports passed:false when below threshold', () => {
    const { code, stdout } = run(`coverage --root "${ROOT}" --json --min 50`);
    expect(code).not.toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toMatchObject({ passed: false, min: 50, coveragePercent: 0 });
  });

  it('check --json reports versionDrift for a docs file stamped with an older version', () => {
    run(`generate --root "${ROOT}"`);
    const docsFile = path.join(ROOT, 'src/items.controller.docs.ts');
    waitForFile(docsFile);
    const content = fs.readFileSync(docsFile, 'utf8');
    fs.writeFileSync(
      docsFile,
      content.replace(/Generated by nestjs-docfy@[\d.]+\./, 'Generated by nestjs-docfy@0.0.1.'),
    );

    const { code, stdout } = run(`check --root "${ROOT}" --json`);
    expect(code).toBe(0); // versionDrift is informational, never fails the exit code
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.versionDrift).toEqual([{ controllerClass: 'ItemsController', docsFile, stampedVersion: '0.0.1' }]);
  });
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------
describe('E2E — doctor', () => {
  const ROOT = isolatedFixture('json-output');

  afterEach(() => cleanup(ROOT));

  it('doctor --json reports a clean project once docs are generated', () => {
    run(`generate --root "${ROOT}"`);
    waitForFile(path.join(ROOT, 'src/items.controller.docs.ts'));
    const { code, stdout } = run(`doctor --root "${ROOT}" --json`);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toMatchObject({ passed: true, controllersScanned: 1, controllerIssues: [] });
  });

  it('doctor --json reports controller issues without failing the exit code', () => {
    const { code, stdout } = run(`doctor --root "${ROOT}" --json`);
    expect(code).toBe(0); // doctor is a diagnostic tool, not a CI gate — check owns that role
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.passed).toBe(false);
    expect(parsed.controllerIssues).toHaveLength(1);
    expect(parsed.controllerIssues[0]).toMatchObject({ controllerClass: 'ItemsController', kind: 'missing-file' });
  });

  it('doctor (text mode) prints a human-readable report and exits 0', () => {
    const { code, stdout } = run(`doctor --root "${ROOT}"`);
    expect(code).toBe(0);
    expect(stdout).toContain('nestjs-docfy doctor');
    expect(stdout).toContain('Some diagnostics need attention');
  });
});

// ---------------------------------------------------------------------------
// NX monorepo
// ---------------------------------------------------------------------------
describe('E2E — NX monorepo', () => {
  const ROOT = isolatedFixture('nx');

  afterEach(() => cleanup(ROOT));

  it('detects NX and exits 0', () => {
    const { code, stdout } = run(`generate --root "${ROOT}"`);
    expect(code).toBe(0);
    expect(stdout).toContain('NX Monorepo');
  });

  it('generates docs for controllers in both apps', () => {
    run(`generate --root "${ROOT}"`);
    const docs = findDocs(ROOT);
    const names = docs.map((f) => path.basename(f));
    expect(names).toContain('orders.controller.docs.ts');
    expect(names).toContain('jobs.controller.docs.ts');
  });

  it('generated docs files stay within the project root', () => {
    run(`generate --root "${ROOT}"`);
    const absRoot = path.resolve(ROOT) + path.sep;
    for (const f of findDocs(ROOT)) {
      expect(path.resolve(f).startsWith(absRoot)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Nest CLI monorepo
// ---------------------------------------------------------------------------
describe('E2E — Nest CLI monorepo', () => {
  const ROOT = isolatedFixture('nest-cli');

  afterEach(() => cleanup(ROOT));

  it('detects Nest CLI Monorepo and exits 0', () => {
    const { code, stdout } = run(`generate --root "${ROOT}"`);
    expect(code).toBe(0);
    expect(stdout).toContain('Nest CLI Monorepo');
  });

  it('generates docs for controllers in api and admin', () => {
    run(`generate --root "${ROOT}"`);
    const names = findDocs(ROOT).map((f) => path.basename(f));
    expect(names).toContain('users.controller.docs.ts');
    expect(names).toContain('dashboard.controller.docs.ts');
  });
});

// ---------------------------------------------------------------------------
// Generic monorepo
// ---------------------------------------------------------------------------
describe('E2E — Generic monorepo', () => {
  const ROOT = isolatedFixture('generic');

  afterEach(() => cleanup(ROOT));

  it('detects Generic Monorepo and exits 0', () => {
    const { code, stdout } = run(`generate --root "${ROOT}"`);
    expect(code).toBe(0);
    expect(stdout).toContain('Generic Monorepo');
  });

  it('generates docs for both services', () => {
    run(`generate --root "${ROOT}"`);
    const names = findDocs(ROOT).map((f) => path.basename(f));
    expect(names).toContain('health.controller.docs.ts');
    expect(names).toContain('metrics.controller.docs.ts');
  });
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------
describe('E2E — exit codes', () => {
  const ROOT = isolatedFixture('scan');

  afterEach(() => cleanup(ROOT));

  it('exits 0 on full success', () => {
    const { code } = run(`generate --root "${ROOT}"`);
    expect(code).toBe(0);
  });

  it('exits 0 when all files skipped (idempotent)', () => {
    run(`generate --root "${ROOT}"`);
    const { code } = run(`generate --root "${ROOT}"`);
    expect(code).toBe(0);
  });

  it('exits 2 on fatal error (invalid --root escaping project)', () => {
    // Pass a pattern with injection attempt — parse-args should catch it
    const { code } = run(`generate --root "." --pattern "../../etc/**"`);
    expect(code).toBe(2);
  });

  it('exits 0 for --dry-run even with no existing docs', () => {
    const { code } = run(`generate --root "${ROOT}" --dry-run`);
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Security: output files never land outside project root
// ---------------------------------------------------------------------------
describe('E2E — security: output confinement', () => {
  const ROOT = isolatedFixture('scan');

  afterEach(() => cleanup(ROOT));

  it('all generated files are inside the project root', () => {
    run(`generate --root "${ROOT}"`);
    const absRoot = path.resolve(ROOT) + path.sep;
    for (const f of findDocs(ROOT)) {
      expect(path.resolve(f).startsWith(absRoot)).toBe(true);
    }
  });

  it('generated file content does not contain process.exit outside comments', () => {
    run(`generate --root "${ROOT}"`);
    for (const f of findDocs(ROOT)) {
      const content = fs.readFileSync(f, 'utf8');
      const codeLines = content
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
      expect(codeLines.join('\n')).not.toContain('process.exit');
    }
  });
});

// ---------------------------------------------------------------------------
// generate-client
// ---------------------------------------------------------------------------
// Skipped below Node 22.12: openapi-typescript's CJS build eagerly requires
// parse-json@8 (ESM-only), which throws ERR_REQUIRE_ESM on any Node without
// native require(esm) interop — a real runtime restriction, not something
// spawning a child process (as every suite here does) works around. Every
// other command stays lazy-loaded specifically so this doesn't take the
// rest of the CLI down with it (see index.ts's generate-client command).
const SUPPORTS_REQUIRE_ESM = (() => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
})();
const describeGenerateClient = SUPPORTS_REQUIRE_ESM ? describe : describe.skip;

describeGenerateClient('E2E — generate-client', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-generate-client-e2e-'));
    fs.writeFileSync(
      path.join(tmpDir, 'spec.json'),
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'findAllUsers',
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: { id: { type: 'string' }, email: { type: 'string' } },
              required: ['id', 'email'],
            },
          },
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes schema.d.ts and client.ts to the default output directory', () => {
    const { code } = run(`generate-client --spec ./spec.json`, tmpDir);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, 'generated-client/schema.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'generated-client/client.ts'))).toBe(true);
  });

  it('generates a paths interface matching the spec', () => {
    run(`generate-client --spec ./spec.json`, tmpDir);
    const schema = fs.readFileSync(path.join(tmpDir, 'generated-client/schema.d.ts'), 'utf8');
    expect(schema).toContain('export interface paths');
    expect(schema).toContain('"/users"');
    expect(schema).toContain('findAllUsers');
  });

  it('generates a client.ts importing openapi-fetch and the generated types', () => {
    run(`generate-client --spec ./spec.json`, tmpDir);
    const client = fs.readFileSync(path.join(tmpDir, 'generated-client/client.ts'), 'utf8');
    expect(client).toContain("from 'openapi-fetch'");
    expect(client).toContain("from './schema'");
    expect(client).toContain('export function createApiClient');
  });

  it('respects a custom --out directory', () => {
    const { code } = run(`generate-client --spec ./spec.json --out ./custom-out`, tmpDir);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, 'custom-out/schema.d.ts'))).toBe(true);
  });

  it('exits with a fatal error when --spec points to a missing file', () => {
    const { code, stderr } = run(`generate-client --spec ./missing.json`, tmpDir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Could not read --spec file/);
  });

  it('rejects an --out path that escapes the project root', () => {
    const { code } = run(`generate-client --spec ./spec.json --out ../../../etc`, tmpDir);
    expect(code).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lint-spec
// ---------------------------------------------------------------------------

describe('E2E — lint-spec', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-lint-spec-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSpec(paths: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(tmpDir, 'spec.json'),
      JSON.stringify({ openapi: '3.0.3', info: { title: 'Test API', version: '1.0.0' }, paths }),
    );
  }

  it('exits 0 with no issues for a fully-documented spec', () => {
    writeSpec({
      '/users': {
        get: {
          tags: ['Users'],
          summary: 'List users',
          description: 'Lists all users.',
          responses: { '200': { description: 'OK' }, '404': { description: 'Not Found' } },
        },
      },
    });

    const { code, stdout } = run('lint-spec --spec ./spec.json', tmpDir);
    expect(code).toBe(0);
    expect(stdout).toContain('passed every quality check');
  });

  it('exits 1 and lists each issue for an undocumented spec', () => {
    writeSpec({ '/users': { get: { responses: { '200': { description: 'OK' } } } } });

    const { code, stderr } = run('lint-spec --spec ./spec.json', tmpDir);
    expect(code).toBe(1);
    expect(stderr).toContain('missing-summary');
    expect(stderr).toContain('missing-description');
    expect(stderr).toContain('missing-tags');
    expect(stderr).toContain('no-error-response');
  });

  it('supports --json with issuesFound/passed', () => {
    writeSpec({ '/users': { get: { responses: { '200': { description: 'OK' } } } } });

    const { code, stdout } = run('lint-spec --spec ./spec.json --json', tmpDir);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.passed).toBe(false);
    expect(parsed.issuesFound).toBeGreaterThan(0);
  });

  it('flags a duplicate operationId across two endpoints', () => {
    writeSpec({
      '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      '/users/{id}': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
    });

    const { stderr } = run('lint-spec --spec ./spec.json', tmpDir);
    expect(stderr).toContain('duplicate-operation-id');
  });

  it('exits with a fatal error when --spec points to a missing file', () => {
    const { code, stderr } = run('lint-spec --spec ./missing.json', tmpDir);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Could not read --spec file/);
  });
});
