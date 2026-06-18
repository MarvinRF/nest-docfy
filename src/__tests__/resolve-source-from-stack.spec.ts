import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SourceMapGenerator } from 'source-map';
import { parseCallSite, resolveOriginalPath } from '../resolve-source-from-stack';

describe('parseCallSite()', () => {
  it('returns null for an undefined stack', () => {
    expect(parseCallSite(undefined)).toBeNull();
  });

  it('extracts file/line/column from a parenthesized V8 frame', () => {
    const stack = [
      'Error',
      '    at WithDocs (/app/src/with-docs.decorator.js:10:5)',
      '    at Object.<anonymous> (/app/dist/apps/api-gateway/main.js:842:18)',
    ].join('\n');

    const loc = parseCallSite(stack);
    expect(loc).toEqual({ file: '/app/dist/apps/api-gateway/main.js', line: 842, column: 18 });
  });

  it('extracts file/line/column from a bare "at file:line:col" frame (no parens)', () => {
    const stack = [
      'Error',
      '    at WithDocs (/app/src/with-docs.decorator.js:10:5)',
      '    at /app/dist/apps/api-gateway/main.js:842:18',
    ].join('\n');

    const loc = parseCallSite(stack);
    expect(loc).toEqual({ file: '/app/dist/apps/api-gateway/main.js', line: 842, column: 18 });
  });

  it('always skips the capturing function\'s own frame, positionally, even after bundling collapses everything into one file', () => {
    // Post-bundling, the decorator's own frame and the real caller's frame
    // report the *same* file — only line/column differ — so a path-based
    // skip can't tell them apart; the positional skip still can.
    const stack = [
      'Error',
      '    at WithDocs (/app/dist/main.js:10:5)',
      '    at Object.<anonymous> (/app/dist/main.js:842:18)',
    ].join('\n');

    const loc = parseCallSite(stack);
    expect(loc).toEqual({ file: '/app/dist/main.js', line: 842, column: 18 });
  });

  it('skips frames inside node_modules beyond the capturing function\'s own frame', () => {
    const stack = [
      'Error',
      '    at WithDocs (/app/src/with-docs.decorator.js:10:5)',
      '    at SomeWrapper (/app/node_modules/some-lib/index.js:1:1)',
      '    at Object.<anonymous> (/app/dist/main.js:842:18)',
    ].join('\n');

    const loc = parseCallSite(stack);
    expect(loc?.file).toBe('/app/dist/main.js');
  });

  it('returns null when every remaining frame is inside node_modules', () => {
    const stack = [
      'Error',
      '    at WithDocs (/app/src/with-docs.decorator.js:10:5)',
      '    at X (/app/node_modules/a/index.js:1:1)',
    ].join('\n');
    expect(parseCallSite(stack)).toBeNull();
  });
});

describe('resolveOriginalPath()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-sourcemap-test-'));
  });

  it('resolves a webpack:// URI in loc.file directly, without reading any .map file (Node/ts-node already source-mapped the stack itself)', () => {
    // This is what `Error().stack` actually contains when something in the
    // process (ts-node, source-map-support, Node's --enable-source-maps)
    // already auto-resolves stack traces against source maps: the frame's
    // reported "file" is webpack's own namespace URI, not a real path on
    // disk — there is nothing for loadSourceMap() to read in this case.
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/app');
    try {
      const resolved = resolveOriginalPath({
        file: 'webpack://api-gateway/./apps/api-gateway/src/auth/auth.controller.ts',
        line: 36,
        column: 3,
      });
      expect(resolved).toBe('/app/apps/api-gateway/src/auth/auth.controller.ts');
    } finally {
      cwdSpy.mockRestore();
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the bundle file unchanged when no source map exists', () => {
    const bundleFile = path.join(tmpDir, 'main.js');
    fs.writeFileSync(bundleFile, 'console.log(1);');

    expect(resolveOriginalPath({ file: bundleFile, line: 1, column: 0 })).toBe(bundleFile);
  });

  it('resolves a bundled position back to its original source file via a sidecar .map file', () => {
    const bundleFile = path.join(tmpDir, 'main.js');
    const originalRelativePath = 'apps/api-gateway/src/auth/auth.controller.ts';

    const generator = new SourceMapGenerator({ file: 'main.js' });
    generator.addMapping({
      generated: { line: 842, column: 18 },
      original: { line: 3, column: 0 },
      source: originalRelativePath,
    });
    fs.writeFileSync(bundleFile, 'void 0;');
    fs.writeFileSync(`${bundleFile}.map`, generator.toString());

    const resolved = resolveOriginalPath({ file: bundleFile, line: 842, column: 18 });
    expect(resolved).toBe(path.resolve(tmpDir, originalRelativePath));
  });

  it('resolves webpack:// namespace URIs (NestJS CLI\'s actual source-map format) relative to cwd, not the bundle dir', () => {
    const bundleFile = path.join(tmpDir, 'main.js');

    const generator = new SourceMapGenerator({ file: 'main.js' });
    generator.addMapping({
      generated: { line: 50, column: 0 },
      original: { line: 1, column: 0 },
      // This is exactly what `nest build`'s default webpack config emits —
      // not a plain relative path like the other fixtures in this file.
      source: 'webpack://api-gateway/./apps/api-gateway/src/auth/auth.controller.ts',
    });
    fs.writeFileSync(bundleFile, 'void 0;');
    fs.writeFileSync(`${bundleFile}.map`, generator.toString());

    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    try {
      const resolved = resolveOriginalPath({ file: bundleFile, line: 50, column: 0 });
      expect(resolved).toBe(
        path.resolve(tmpDir, 'apps/api-gateway/src/auth/auth.controller.ts'),
      );
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it('resolves a bundled position via an inlined base64 sourceMappingURL data URI', () => {
    const bundleFile = path.join(tmpDir, 'main.js');
    const originalRelativePath = 'apps/api-gateway/src/auth/auth.controller.ts';

    const generator = new SourceMapGenerator({ file: 'main.js' });
    generator.addMapping({
      generated: { line: 5, column: 2 },
      original: { line: 1, column: 0 },
      source: originalRelativePath,
    });
    const encoded = Buffer.from(generator.toString()).toString('base64');
    fs.writeFileSync(
      bundleFile,
      `void 0;\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encoded}\n`,
    );

    const resolved = resolveOriginalPath({ file: bundleFile, line: 5, column: 2 });
    expect(resolved).toBe(path.resolve(tmpDir, originalRelativePath));
  });

  it('returns the bundle file unchanged when the position maps to no source', () => {
    const bundleFile = path.join(tmpDir, 'main.js');
    const generator = new SourceMapGenerator({ file: 'main.js' });
    generator.addMapping({
      generated: { line: 100, column: 0 },
      original: { line: 1, column: 0 },
      source: 'other.ts',
    });
    fs.writeFileSync(bundleFile, 'void 0;');
    fs.writeFileSync(`${bundleFile}.map`, generator.toString());

    // Position before any recorded mapping — nothing for the lookup to resolve to
    expect(resolveOriginalPath({ file: bundleFile, line: 1, column: 0 })).toBe(bundleFile);
  });
});
