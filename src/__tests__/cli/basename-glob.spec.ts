import { basenameGlobToRegExp } from '../../cli/scan-controllers';

describe('basenameGlobToRegExp()', () => {
  it.each([
    ['*.ctrl.ts', 'users.ctrl.ts', true],
    ['*.ctrl.ts', 'users.ctrl.tsx', false],
    ['*.ctrl.ts', 'usersXctrlYts', false],
    ['*.{controller,ctrl}.ts', 'users.ctrl.ts', true],
    ['*.{controller,ctrl}.ts', 'users.controller.ts', true],
    ['*.{controller,ctrl}.ts', 'users.service.ts', false],
    ['user?.controller.ts', 'users.controller.ts', true],
    ['user?.controller.ts', 'user.controller.ts', false],
  ])('%s against %s -> %s', (glob, name, expected) => {
    expect(basenameGlobToRegExp(glob).test(name)).toBe(expected);
  });
});
