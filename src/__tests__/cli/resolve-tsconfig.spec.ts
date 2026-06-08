import path from 'path';
import { resolveTsconfig } from '../../cli/resolve-tsconfig';
import { ConfigNotFoundError } from '../../cli/errors';
import { PathTraversalError } from '../../cli/errors';

const FIXTURES = path.join(__dirname, 'fixtures');
const fix = (name: string) => path.join(FIXTURES, name);

describe('resolveTsconfig()', () => {
  it('finds tsconfig.json in simple project', () => {
    const result = resolveTsconfig(fix('simple'), fix('simple'));
    expect(result).toBe(path.join(fix('simple'), 'tsconfig.json'));
  });

  it('prefers tsconfig.build.json over tsconfig.json', () => {
    const result = resolveTsconfig(
      path.join(fix('nx'), 'apps/worker'),
      fix('nx'),
    );
    expect(result).toContain('tsconfig.build.json');
  });

  it('throws ConfigNotFoundError when no tsconfig exists', () => {
    expect(() => resolveTsconfig('/tmp/no-tsconfig-here', '/tmp')).toThrow(
      ConfigNotFoundError,
    );
  });

  it('throws ConfigNotFoundError (not PathTraversalError) when appRoot escapes projectRoot', () => {
    // assertWithinRoot rejects each candidate silently; the loop exhausts all
    // candidates and throws ConfigNotFoundError — never leaking internal errors.
    expect(() =>
      resolveTsconfig('/etc/passwd-dir', fix('simple')),
    ).toThrow(ConfigNotFoundError);
  });
});
