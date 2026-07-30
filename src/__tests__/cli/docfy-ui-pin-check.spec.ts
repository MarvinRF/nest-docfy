import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkDocfyUiPin } from '../../cli/docfy-ui-pin-check';

function makeProjectDir(pkgJson: Record<string, unknown> | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestjs-docfy-pin-check-'));
  if (pkgJson) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson), 'utf8');
  }
  return dir;
}

describe('checkDocfyUiPin()', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when the app does not declare docfy-ui at all', () => {
    const dir = makeProjectDir({ name: 'app', dependencies: { express: '^5.0.0' } });
    dirs.push(dir);

    expect(checkDocfyUiPin(dir)).toBeNull();
  });

  it('returns null when the project has no package.json', () => {
    const dir = makeProjectDir(null);
    dirs.push(dir);

    expect(checkDocfyUiPin(dir)).toBeNull();
  });

  it('flags the declared range against the actually-served vendored version, from dependencies', () => {
    const dir = makeProjectDir({ name: 'app', dependencies: { 'docfy-ui': '^0.1.0' } });
    dirs.push(dir);

    const result = checkDocfyUiPin(dir);
    expect(result).not.toBeNull();
    expect(result?.appDeclaredRange).toBe('^0.1.0');
    // Whatever version nestjs-docfy itself vendors is always resolvable in this test env.
    expect(result?.servedVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('also detects the declaration from devDependencies', () => {
    const dir = makeProjectDir({ name: 'app', devDependencies: { 'docfy-ui': '0.2.1' } });
    dirs.push(dir);

    const result = checkDocfyUiPin(dir);
    expect(result?.appDeclaredRange).toBe('0.2.1');
  });
});
