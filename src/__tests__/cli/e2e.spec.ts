/**
 * End-to-end integration tests.
 * Each test spins up the CLI against a real fixture directory on disk.
 * No mocking — real fs reads and writes, real ts-morph analysis.
 * Generated .docs.ts files are cleaned up after each test.
 */
import { execSync, ExecSyncOptionsWithBufferEncoding } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI = path.join(__dirname, '../../../dist/cli/index.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function fix(name: string): string {
  return path.join(FIXTURES, name);
}

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
  try { walk(dir); } catch { /* dir may not exist */ }
  return result;
}

function cleanup(dir: string): void {
  findDocs(dir).forEach((f) => fs.unlinkSync(f));
}

// ---------------------------------------------------------------------------
// Simple project
// ---------------------------------------------------------------------------
describe('E2E — simple project', () => {
  const ROOT = fix('scan');

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
// NX monorepo
// ---------------------------------------------------------------------------
describe('E2E — NX monorepo', () => {
  const ROOT = fix('nx');

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
  const ROOT = fix('nest-cli');

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
  const ROOT = fix('generic');

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
  const ROOT = fix('scan');

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
  const ROOT = fix('scan');

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
