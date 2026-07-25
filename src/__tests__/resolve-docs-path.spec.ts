import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SourceMapGenerator } from 'source-map';
import { resolveDocsPath } from '../resolve-docs-path';

function makeCache(filename: string, target: NewableFunction, exportKey = target.name) {
  return () => ({ [filename]: { exports: { [exportKey]: target } } });
}

describe('resolveDocsPath()', () => {
  it('derives .docs.js path from a .controller.js file', () => {
    class UsersController {}
    const readCache = makeCache('/app/dist/users/users.controller.js', UsersController);

    expect(resolveDocsPath(UsersController, readCache)).toBe('/app/dist/users/users.controller.docs.js');
  });

  it('derives .docs.ts path when running under ts-node', () => {
    class UsersControllerTs {}
    const readCache = makeCache('/app/src/users/users.controller.ts', UsersControllerTs);

    expect(resolveDocsPath(UsersControllerTs, readCache)).toBe('/app/src/users/users.controller.docs.ts');
  });

  it('returns null when the class is not found in the cache', () => {
    class UnknownService {}
    expect(resolveDocsPath(UnknownService, () => ({}))).toBeNull();
  });

  it('returns null when the file does not follow the .controller. convention', () => {
    class UsersService {}
    const readCache = makeCache('/app/src/users/users.service.js', UsersService);

    expect(resolveDocsPath(UsersService, readCache)).toBeNull();
  });

  it('handles paths with dots in directory names', () => {
    class ItemsController {}
    const readCache = makeCache('/my.app/src/v1/items.controller.js', ItemsController);

    expect(resolveDocsPath(ItemsController, readCache)).toBe('/my.app/src/v1/items.controller.docs.js');
  });

  it('handles a module directly exporting multiple controllers', () => {
    class ControllerA {}
    class ControllerB {}
    const readCache = () => ({
      '/app/dist/mixed.controller.js': {
        exports: { ControllerA, ControllerB } as Record<string, unknown>,
      },
    });

    expect(resolveDocsPath(ControllerA, readCache)).toBe('/app/dist/mixed.controller.docs.js');
    expect(resolveDocsPath(ControllerB, readCache)).toBe('/app/dist/mixed.controller.docs.js');
  });

  it('prefers the .controller.ts file over a barrel index.ts when both export the class', () => {
    class UsersController {}
    const readCache = () => ({
      '/app/src/users/index.ts': {
        exports: { UsersController } as Record<string, unknown>,
      },
      '/app/src/users/users.controller.ts': {
        exports: { UsersController } as Record<string, unknown>,
      },
    });

    expect(resolveDocsPath(UsersController, readCache)).toBe('/app/src/users/users.controller.docs.ts');
  });

  it('falls back to the first candidate when no .controller. file is found among duplicates', () => {
    class SomeController {}
    // Two barrel files, neither with .controller. in the name
    const readCache = () => ({
      '/app/src/index.ts': { exports: { SomeController } as Record<string, unknown> },
      '/app/src/shared/index.ts': { exports: { SomeController } as Record<string, unknown> },
    });

    // Returns the first candidate — but without .controller. suffix it'll return null
    expect(resolveDocsPath(SomeController, readCache)).toBeNull();
  });

  describe('webpack-bundled app (require.cache has no per-file entries)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-webpack-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('falls back to the @WithDocs() call-site stack + source map when require.cache lookup finds nothing', () => {
      class AuthController {}

      // require.cache has exactly what a webpack-bundled NestJS app actually
      // has: one entry, for the bundle entry point, which doesn't export the
      // controller class at all (it's inlined, not module-exported there).
      const bundleFile = path.join(tmpDir, 'main.js');
      const emptyCache = () => ({ [bundleFile]: { exports: {} } });

      const originalRelativePath = 'apps/api-gateway/src/auth/auth.controller.ts';
      const generator = new SourceMapGenerator({ file: 'main.js' });
      generator.addMapping({
        generated: { line: 10, column: 5 },
        original: { line: 20, column: 0 },
        source: originalRelativePath,
      });
      fs.writeFileSync(bundleFile, 'void 0;');
      fs.writeFileSync(`${bundleFile}.map`, generator.toString());

      const callSiteStack = [
        'Error',
        '    at WithDocs (/app/dist/main.js:1:1)',
        `    at Object.<anonymous> (${bundleFile}:10:5)`,
      ].join('\n');

      const docsPath = resolveDocsPath(AuthController, emptyCache, callSiteStack);
      expect(docsPath).toBe(path.resolve(tmpDir, 'apps/api-gateway/src/auth/auth.controller.docs.ts'));
    });

    it('returns null when require.cache lookup fails and there is no call-site stack either', () => {
      class OrphanController {}
      const emptyCache = () => ({});

      expect(resolveDocsPath(OrphanController, emptyCache)).toBeNull();
    });
  });
});
