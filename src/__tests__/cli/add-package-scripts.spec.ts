import fs from 'fs';
import os from 'os';
import path from 'path';
import { addPackageScripts } from '../../cli/add-package-scripts';

function writePackageJson(root: string, content: unknown): void {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(content), 'utf8');
}

function readPackageJson(root: string): { scripts?: Record<string, string> } {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
}

describe('addPackageScripts()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-add-scripts-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when package.json does not exist', () => {
    expect(addPackageScripts(tmpDir, false)).toBeNull();
  });

  it('returns null when package.json is not valid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{not valid json', 'utf8');
    expect(addPackageScripts(tmpDir, false)).toBeNull();
  });

  it('adds both scripts when scripts is missing entirely', () => {
    writePackageJson(tmpDir, { name: 'demo' });
    const result = addPackageScripts(tmpDir, false);
    expect(result).toEqual({
      path: path.join(tmpDir, 'package.json'),
      changed: true,
      added: ['docs:generate', 'docs:preview'],
    });
    expect(readPackageJson(tmpDir).scripts).toEqual({
      'docs:generate': 'nestjs-docfy generate',
      'docs:preview': 'nestjs-docfy generate --dry-run',
    });
  });

  it('adds only the missing script, preserving existing scripts', () => {
    writePackageJson(tmpDir, { scripts: { build: 'tsc', 'docs:generate': 'nestjs-docfy generate' } });
    const result = addPackageScripts(tmpDir, false);
    expect(result?.added).toEqual(['docs:preview']);
    expect(readPackageJson(tmpDir).scripts).toEqual({
      build: 'tsc',
      'docs:generate': 'nestjs-docfy generate',
      'docs:preview': 'nestjs-docfy generate --dry-run',
    });
  });

  it('does not overwrite a custom script already defined under the same name', () => {
    writePackageJson(tmpDir, { scripts: { 'docs:generate': 'echo custom' } });
    const result = addPackageScripts(tmpDir, false);
    expect(result?.added).toEqual(['docs:preview']);
    expect(readPackageJson(tmpDir).scripts?.['docs:generate']).toBe('echo custom');
  });

  it('is a no-op when both scripts are already present', () => {
    writePackageJson(tmpDir, {
      scripts: { 'docs:generate': 'nestjs-docfy generate', 'docs:preview': 'nestjs-docfy generate --dry-run' },
    });
    const before = fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8');
    const result = addPackageScripts(tmpDir, false);
    expect(result).toEqual({ path: path.join(tmpDir, 'package.json'), changed: false, added: [] });
    expect(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8')).toBe(before);
  });

  it('reports changed without writing to disk in dry-run mode', () => {
    writePackageJson(tmpDir, { name: 'demo' });
    const before = fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8');
    const result = addPackageScripts(tmpDir, true);
    expect(result?.changed).toBe(true);
    expect(result?.added).toEqual(['docs:generate', 'docs:preview']);
    expect(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8')).toBe(before);
  });
});
