import 'reflect-metadata';
import { DocfyModule } from '../docfy.module';
import { DocfyRegistry } from '../registry';

function makeCache(filename: string, target: Function) {
  return () => ({ [filename]: { exports: { [target.name]: target } } });
}

function moduleNotFoundError(modulePath: string) {
  return Object.assign(new Error(`Cannot find module '${modulePath}'`), {
    code: 'MODULE_NOT_FOUND',
  });
}

describe('DocfyModule._loadAllDocs()', () => {
  let mockRequire: jest.Mock;

  beforeEach(() => {
    DocfyRegistry._reset();
    mockRequire = jest.fn();
  });

  it('requires the docs file derived from the controller path', () => {
    class UsersController {}
    DocfyRegistry.add(UsersController);
    const cache = makeCache('/app/dist/users/users.controller.js', UsersController);

    DocfyModule._loadAllDocs({}, mockRequire, cache);

    expect(mockRequire).toHaveBeenCalledWith('/app/dist/users/users.controller.docs.js');
  });

  it('loads docs for multiple controllers', () => {
    class CtrlA {}
    class CtrlB {}
    DocfyRegistry.add(CtrlA);
    DocfyRegistry.add(CtrlB);
    const cache = () => ({
      '/app/dist/a.controller.js': { exports: { CtrlA } },
      '/app/dist/b.controller.js': { exports: { CtrlB } },
    });

    DocfyModule._loadAllDocs({}, mockRequire, cache);

    expect(mockRequire).toHaveBeenCalledTimes(2);
    expect(mockRequire).toHaveBeenCalledWith('/app/dist/a.controller.docs.js');
    expect(mockRequire).toHaveBeenCalledWith('/app/dist/b.controller.docs.js');
  });

  it('skips (warns) when resolveDocsPath returns null — default mode', () => {
    class OrphanController {}
    DocfyRegistry.add(OrphanController);

    expect(() => DocfyModule._loadAllDocs({}, mockRequire, () => ({}))).not.toThrow();
    expect(mockRequire).not.toHaveBeenCalled();
  });

  it('throws when resolveDocsPath returns null — strict mode', () => {
    class OrphanController {}
    DocfyRegistry.add(OrphanController);

    expect(() =>
      DocfyModule._loadAllDocs({ strict: true }, mockRequire, () => ({})),
    ).toThrow('[nestjs-docfy]');
  });

  describe('MODULE_NOT_FOUND handling', () => {
    it('warns (not throws) when the docs file itself is missing — default mode', () => {
      class NoDocsController {}
      DocfyRegistry.add(NoDocsController);
      const cache = makeCache('/app/no.controller.js', NoDocsController);
      const docsPath = '/app/no.controller.docs.js';

      mockRequire.mockImplementation(() => { throw moduleNotFoundError(docsPath); });

      expect(() => DocfyModule._loadAllDocs({}, mockRequire, cache)).not.toThrow();
    });

    it('throws when the docs file is missing — strict mode', () => {
      class StrictNoDocsController {}
      DocfyRegistry.add(StrictNoDocsController);
      const cache = makeCache('/app/strict.controller.js', StrictNoDocsController);
      const docsPath = '/app/strict.controller.docs.js';

      mockRequire.mockImplementation(() => { throw moduleNotFoundError(docsPath); });

      expect(() =>
        DocfyModule._loadAllDocs({ strict: true }, mockRequire, cache),
      ).toThrow('[nestjs-docfy]');
    });

    it('rethrows MODULE_NOT_FOUND for a missing dependency inside the docs file', () => {
      class BadImportController {}
      DocfyRegistry.add(BadImportController);
      const cache = makeCache('/app/bad-import.controller.js', BadImportController);

      // The missing module is a dependency, not the docs file itself
      mockRequire.mockImplementation(() => {
        throw moduleNotFoundError('/app/some-missing-dep');
      });

      expect(() =>
        DocfyModule._loadAllDocs({}, mockRequire, cache),
      ).toThrow("Cannot find module '/app/some-missing-dep'");
    });
  });

  it('rethrows unexpected errors (e.g. syntax error in docs file)', () => {
    class BadController {}
    DocfyRegistry.add(BadController);
    const cache = makeCache('/app/bad.controller.js', BadController);

    mockRequire.mockImplementation(() => { throw new Error('SyntaxError: Unexpected token'); });

    expect(() => DocfyModule._loadAllDocs({}, mockRequire, cache)).toThrow('SyntaxError');
  });

  it('forRoot() returns a valid DynamicModule', () => {
    const result = DocfyModule.forRoot();
    expect(result).toMatchObject({ module: DocfyModule });
  });

  it('forRoot() with strict option is valid', () => {
    const result = DocfyModule.forRoot({ strict: true });
    expect(result).toMatchObject({ module: DocfyModule });
  });
});
