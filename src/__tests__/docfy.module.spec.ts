import 'reflect-metadata';
import { DocfyModule } from '../docfy.module';
import { DocfyRegistry } from '../registry';

function makeCache(filename: string, target: Function) {
  return () => ({ [filename]: { exports: { [target.name]: target } } });
}

describe('DocfyModule.loadAllDocs()', () => {
  let mockRequire: jest.Mock;

  beforeEach(() => {
    DocfyRegistry._reset();
    mockRequire = jest.fn();
  });

  it('requires the docs file derived from the controller path', () => {
    class UsersController {}
    DocfyRegistry.add(UsersController);
    const cache = makeCache('/app/dist/users/users.controller.js', UsersController);

    DocfyModule.loadAllDocs(mockRequire, cache);

    expect(mockRequire).toHaveBeenCalledWith('/app/dist/users/users.controller.docs.js');
  });

  it('skips and warns when resolveDocsPath returns null (class not in cache)', () => {
    class OrphanController {}
    DocfyRegistry.add(OrphanController);
    const warnSpy = jest.spyOn(DocfyModule['logger' as never] as any, 'warn').mockImplementation(() => {});

    DocfyModule.loadAllDocs(mockRequire, () => ({}));

    expect(mockRequire).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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

    DocfyModule.loadAllDocs(mockRequire, cache);

    expect(mockRequire).toHaveBeenCalledTimes(2);
    expect(mockRequire).toHaveBeenCalledWith('/app/dist/a.controller.docs.js');
    expect(mockRequire).toHaveBeenCalledWith('/app/dist/b.controller.docs.js');
  });

  it('swallows MODULE_NOT_FOUND (missing docs file is allowed)', () => {
    class NoDocsController {}
    DocfyRegistry.add(NoDocsController);
    const cache = makeCache('/app/no.controller.js', NoDocsController);

    const err = Object.assign(new Error('Not found'), { code: 'MODULE_NOT_FOUND' });
    mockRequire.mockImplementation(() => { throw err; });

    expect(() => DocfyModule.loadAllDocs(mockRequire, cache)).not.toThrow();
  });

  it('rethrows unexpected errors from the docs file', () => {
    class BadController {}
    DocfyRegistry.add(BadController);
    const cache = makeCache('/app/bad.controller.js', BadController);

    mockRequire.mockImplementation(() => { throw new Error('Syntax error'); });

    expect(() => DocfyModule.loadAllDocs(mockRequire, cache)).toThrow('Syntax error');
  });

  it('forRoot() returns a valid DynamicModule', () => {
    const result = DocfyModule.forRoot();
    expect(result).toMatchObject({ module: DocfyModule });
  });
});
