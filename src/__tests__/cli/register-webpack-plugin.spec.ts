import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerWebpackPlugin } from '../../cli/register-webpack-plugin';

function writeNestCli(root: string, content: unknown): void {
  fs.writeFileSync(path.join(root, 'nest-cli.json'), JSON.stringify(content), 'utf8');
}

function readNestCli(root: string): { compilerOptions?: { plugins?: unknown[] } } {
  return JSON.parse(fs.readFileSync(path.join(root, 'nest-cli.json'), 'utf8')) as {
    compilerOptions?: { plugins?: unknown[] };
  };
}

describe('registerWebpackPlugin()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-register-plugin-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when nest-cli.json does not exist', () => {
    expect(registerWebpackPlugin(tmpDir, false)).toBeNull();
  });

  it('returns null when nest-cli.json is not valid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'nest-cli.json'), '{not valid json', 'utf8');
    expect(registerWebpackPlugin(tmpDir, false)).toBeNull();
  });

  it('adds compilerOptions.plugins when missing entirely', () => {
    writeNestCli(tmpDir, { compilerOptions: { webpack: true } });
    const result = registerWebpackPlugin(tmpDir, false);
    expect(result).toEqual({ path: path.join(tmpDir, 'nest-cli.json'), changed: true });
    expect(readNestCli(tmpDir).compilerOptions?.plugins).toEqual(['nestjs-docfy']);
  });

  it('appends to an existing plugins array without dropping other entries', () => {
    writeNestCli(tmpDir, { compilerOptions: { webpack: true, plugins: ['@nestjs/swagger/plugin'] } });
    registerWebpackPlugin(tmpDir, false);
    expect(readNestCli(tmpDir).compilerOptions?.plugins).toEqual(['@nestjs/swagger/plugin', 'nestjs-docfy']);
  });

  it('is a no-op when the plugin is already registered', () => {
    writeNestCli(tmpDir, { compilerOptions: { webpack: true, plugins: ['nestjs-docfy'] } });
    const before = fs.readFileSync(path.join(tmpDir, 'nest-cli.json'), 'utf8');
    const result = registerWebpackPlugin(tmpDir, false);
    expect(result).toEqual({ path: path.join(tmpDir, 'nest-cli.json'), changed: false });
    expect(fs.readFileSync(path.join(tmpDir, 'nest-cli.json'), 'utf8')).toBe(before);
  });

  it('recognizes an object-form plugin entry as already registered', () => {
    writeNestCli(tmpDir, { compilerOptions: { webpack: true, plugins: [{ name: 'nestjs-docfy' }] } });
    const result = registerWebpackPlugin(tmpDir, false);
    expect(result?.changed).toBe(false);
  });

  it('does not write the file in dry-run mode, but still reports changed:true', () => {
    writeNestCli(tmpDir, { compilerOptions: { webpack: true } });
    const before = fs.readFileSync(path.join(tmpDir, 'nest-cli.json'), 'utf8');
    const result = registerWebpackPlugin(tmpDir, true);
    expect(result).toEqual({ path: path.join(tmpDir, 'nest-cli.json'), changed: true });
    expect(fs.readFileSync(path.join(tmpDir, 'nest-cli.json'), 'utf8')).toBe(before);
  });
});
