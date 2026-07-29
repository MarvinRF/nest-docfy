import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exportSpec } from '../../cli/export-spec';
import { CliError } from '../../cli/errors';

function writeEntry(root: string, name: string, content: string): string {
  const p = path.join(root, name);
  fs.writeFileSync(p, content, 'utf8');
  return name;
}

describe('exportSpec()', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestjs-docfy-export-spec-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('runs a .js entry file and returns its document via stdout mode', () => {
    const entry = writeEntry(
      root,
      'entry.js',
      `module.exports = async function () {
        return { app: { close: async () => {} }, document: { openapi: '3.0.3', paths: {} } };
      };`,
    );

    const result = exportSpec({ entry, root });

    expect(result.outPath).toBeUndefined();
    expect(result.document).toEqual({ openapi: '3.0.3', paths: {} });
  });

  it('writes the document to --out when given', () => {
    const entry = writeEntry(
      root,
      'entry.js',
      `module.exports = async function () {
        return { app: { close: async () => {} }, document: { openapi: '3.0.3', paths: { '/x': {} } } };
      };`,
    );

    const result = exportSpec({ entry, root, out: 'openapi.json' });

    expect(result.outPath).toBe(path.join(root, 'openapi.json'));
    const written = JSON.parse(fs.readFileSync(result.outPath!, 'utf8'));
    expect(written).toEqual({ openapi: '3.0.3', paths: { '/x': {} } });
  });

  it('closes the app returned by the entry file', () => {
    const entry = writeEntry(
      root,
      'entry.js',
      `let closed = false;
      module.exports = async function () {
        return {
          app: { close: async () => { closed = true; require('fs').writeFileSync(require('path').join(__dirname, 'closed.marker'), 'yes'); } },
          document: { openapi: '3.0.3', paths: {} },
        };
      };`,
    );

    exportSpec({ entry, root });

    expect(fs.existsSync(path.join(root, 'closed.marker'))).toBe(true);
  });

  it('throws a CliError when --entry does not exist', () => {
    expect(() => exportSpec({ entry: 'does-not-exist.js', root })).toThrow(CliError);
    expect(() => exportSpec({ entry: 'does-not-exist.js', root })).toThrow('not found');
  });

  it('throws when the entry file has no callable default export', () => {
    writeEntry(root, 'entry.js', `module.exports = { notAFunction: true };`);
    expect(() => exportSpec({ entry: 'entry.js', root })).toThrow(CliError);
  });

  it('supports a .ts entry file via ts-node', () => {
    // `entry` is an absolute path (path.resolve ignores `root` once given
    // one) into the temp dir, while `root` points at nest-docfy's own
    // project root so ts-node/tsconfig-paths — real devDependencies here,
    // not present in the empty temp dir — resolve correctly.
    const entryFile = writeEntry(
      root,
      'entry.ts',
      `export default async function () {
        return { app: { close: async () => {} }, document: { openapi: '3.0.3', paths: {}, marker: 'ts-entry' } };
      }`,
    );
    const nestDocfyRoot = path.resolve(__dirname, '..', '..', '..');

    const result = exportSpec({ entry: path.join(root, entryFile), root: nestDocfyRoot });

    expect(result.document).toMatchObject({ marker: 'ts-entry' });
  });
});
