import { resolveDocsPath } from '../resolve-docs-path';

class SomeService {}

function makeCache(filename: string, target: Function, exportKey = 'default') {
  return () => ({
    [filename]: { exports: { [exportKey]: target } },
  });
}

describe('resolveDocsPath()', () => {
  it('derives .docs.js path from a .controller.js file', () => {
    class UsersController {}
    const readCache = makeCache('/app/dist/users/users.controller.js', UsersController, 'UsersController');

    expect(resolveDocsPath(UsersController, readCache)).toBe(
      '/app/dist/users/users.controller.docs.js',
    );
  });

  it('derives .docs.ts path when running under ts-node', () => {
    class UsersControllerTs {}
    const readCache = makeCache('/app/src/users/users.controller.ts', UsersControllerTs, 'UsersControllerTs');

    expect(resolveDocsPath(UsersControllerTs, readCache)).toBe(
      '/app/src/users/users.controller.docs.ts',
    );
  });

  it('returns null when the class is not found in the cache', () => {
    expect(resolveDocsPath(SomeService, () => ({}))).toBeNull();
  });

  it('returns null when the file does not follow the .controller. convention', () => {
    class UsersService {}
    const readCache = makeCache('/app/src/users/users.service.js', UsersService, 'UsersService');

    expect(resolveDocsPath(UsersService, readCache)).toBeNull();
  });

  it('handles paths with dots in directory names', () => {
    class ItemsController {}
    const readCache = makeCache('/my.app/src/v1/items.controller.js', ItemsController, 'ItemsController');

    expect(resolveDocsPath(ItemsController, readCache)).toBe(
      '/my.app/src/v1/items.controller.docs.js',
    );
  });

  it('handles a module exporting multiple classes', () => {
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
});
