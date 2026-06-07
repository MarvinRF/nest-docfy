import { resolveDocsPath } from '../resolve-docs-path';

function makeCache(filename: string, target: Function, exportKey = target.name) {
  return () => ({ [filename]: { exports: { [exportKey]: target } } });
}

describe('resolveDocsPath()', () => {
  it('derives .docs.js path from a .controller.js file', () => {
    class UsersController {}
    const readCache = makeCache('/app/dist/users/users.controller.js', UsersController);

    expect(resolveDocsPath(UsersController, readCache)).toBe(
      '/app/dist/users/users.controller.docs.js',
    );
  });

  it('derives .docs.ts path when running under ts-node', () => {
    class UsersControllerTs {}
    const readCache = makeCache('/app/src/users/users.controller.ts', UsersControllerTs);

    expect(resolveDocsPath(UsersControllerTs, readCache)).toBe(
      '/app/src/users/users.controller.docs.ts',
    );
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

    expect(resolveDocsPath(ItemsController, readCache)).toBe(
      '/my.app/src/v1/items.controller.docs.js',
    );
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

    expect(resolveDocsPath(UsersController, readCache)).toBe(
      '/app/src/users/users.controller.docs.ts',
    );
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
});
