import path from 'path';
import {
  parseAndValidateOptions,
  assertWithinRoot,
  validateGlob,
  resolveAndValidate,
} from '../../cli/parse-args';
import { PathTraversalError } from '../../cli/errors';

const ROOT = '/project/root';

describe('assertWithinRoot()', () => {
  it('accepts a path that is inside the root', () => {
    expect(() =>
      assertWithinRoot('/project/root/src/foo.ts', ROOT),
    ).not.toThrow();
  });

  it('accepts the root itself', () => {
    expect(() => assertWithinRoot(ROOT, ROOT)).not.toThrow();
  });

  it('rejects a path that escapes via ../..', () => {
    expect(() =>
      assertWithinRoot('/project/etc/passwd', ROOT),
    ).toThrow(PathTraversalError);
  });

  it('rejects a path that looks inside but resolves outside', () => {
    expect(() =>
      assertWithinRoot('/project/root/../../../etc/passwd', ROOT),
    ).toThrow(PathTraversalError);
  });

  it('rejects a sibling directory', () => {
    expect(() =>
      assertWithinRoot('/project/other', ROOT),
    ).toThrow(PathTraversalError);
  });
});

describe('validateGlob()', () => {
  it('accepts a normal controller glob', () => {
    expect(validateGlob('**/*.controller.ts')).toBe('**/*.controller.ts');
  });

  it('accepts a nested path glob', () => {
    expect(validateGlob('src/modules/**/*.controller.ts')).toBe(
      'src/modules/**/*.controller.ts',
    );
  });

  it('rejects a pattern starting with ..', () => {
    expect(() => validateGlob('../../etc/**')).toThrow(/resolves outside/);
  });

  it('rejects shell injection characters', () => {
    expect(() => validateGlob('**/*.ts; rm -rf /')).toThrow(/Invalid --pattern/);
  });

  it('rejects backtick injection', () => {
    expect(() => validateGlob('`whoami`')).toThrow(/Invalid --pattern/);
  });

  it('rejects dollar sign injection', () => {
    expect(() => validateGlob('$(cat /etc/passwd)')).toThrow(/Invalid --pattern/);
  });
});

describe('resolveAndValidate()', () => {
  it('resolves a valid relative path', () => {
    const result = resolveAndValidate('src/tsconfig.json', ROOT, '--tsconfig');
    expect(result).toBe(path.join(ROOT, 'src/tsconfig.json'));
  });

  it('rejects a path escaping root', () => {
    expect(() =>
      resolveAndValidate('../../etc/passwd', ROOT, '--tsconfig'),
    ).toThrow(PathTraversalError);
  });
});

describe('parseAndValidateOptions()', () => {
  it('returns safe defaults when nothing is provided', () => {
    const opts = parseAndValidateOptions({});
    expect(opts.pattern).toBe('**/*.controller.ts');
    expect(opts.force).toBe(false);
    expect(opts.dryRun).toBe(false);
    expect(opts.quiet).toBe(false);
    expect(opts.watch).toBe(false);
    expect(opts.format).toBe('ts');
    expect(opts.tsconfig).toBeUndefined();
    expect(opts.out).toBeUndefined();
  });

  it('accepts format js', () => {
    const opts = parseAndValidateOptions({ format: 'js' });
    expect(opts.format).toBe('js');
  });

  it('rejects an unknown format', () => {
    expect(() => parseAndValidateOptions({ format: 'jsx' })).toThrow(/Invalid --format/);
  });

  it('rejects a malicious glob in --pattern', () => {
    expect(() =>
      parseAndValidateOptions({ pattern: '**; rm -rf /' }),
    ).toThrow(/Invalid --pattern/);
  });

  it('resolves root to an absolute path', () => {
    const opts = parseAndValidateOptions({ root: '.' });
    expect(path.isAbsolute(opts.root)).toBe(true);
  });

  it('sets force and dryRun flags correctly', () => {
    const opts = parseAndValidateOptions({ force: true, dryRun: true });
    expect(opts.force).toBe(true);
    expect(opts.dryRun).toBe(true);
  });
});
