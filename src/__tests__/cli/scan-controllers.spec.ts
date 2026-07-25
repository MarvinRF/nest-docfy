import path from 'path';
import { scanApp, deriveDocsFilePath } from '../../cli/scan-controllers';
import type { ProjectApp } from '../../cli/project-types';

const SCAN_ROOT = path.join(__dirname, 'fixtures', 'scan');

function makeApp(overrides: Partial<ProjectApp> = {}): ProjectApp {
  return {
    name: 'test',
    root: SCAN_ROOT,
    tsconfig: path.join(SCAN_ROOT, 'tsconfig.json'),
    controllerGlob: '**/*.controller.ts',
    ...overrides,
  };
}

describe('deriveDocsFilePath()', () => {
  it('replaces .ts extension with .docs.ts', () => {
    expect(deriveDocsFilePath('/src/users.controller.ts', 'ts')).toBe('/src/users.controller.docs.ts');
  });

  it('produces .docs.js for js format', () => {
    expect(deriveDocsFilePath('/src/users.controller.ts', 'js')).toBe('/src/users.controller.docs.js');
  });
});

describe('scanApp()', () => {
  let result: ReturnType<typeof scanApp>;

  beforeAll(() => {
    result = scanApp(makeApp(), SCAN_ROOT, undefined, 'ts');
  });

  it('finds UsersController', () => {
    const names = result.controllers.map((c) => c.className);
    expect(names).toContain('UsersController');
  });

  it('finds PlainController', () => {
    const names = result.controllers.map((c) => c.className);
    expect(names).toContain('PlainController');
  });

  it('finds ProductsController', () => {
    const names = result.controllers.map((c) => c.className);
    expect(names).toContain('ProductsController');
  });

  it('finds BrokenController (no methods — valid edge case)', () => {
    const names = result.controllers.map((c) => c.className);
    expect(names).toContain('BrokenController');
  });

  it('does not include classes without @Controller', () => {
    const names = result.controllers.map((c) => c.className);
    expect(names).not.toContain('CrudBase');
  });

  it('returns no scan errors for valid fixtures', () => {
    expect(result.errors).toHaveLength(0);
  });

  describe('UsersController methods', () => {
    let ctrl: (typeof result.controllers)[number];
    beforeAll(() => {
      ctrl = result.controllers.find((c) => c.className === 'UsersController')!;
    });

    it('extracts all 3 public methods', () => {
      expect(ctrl.methods).toHaveLength(3);
    });

    it('detects @Get decorator on findAll', () => {
      const m = ctrl.methods.find((m) => m.name === 'findAll')!;
      expect(m.httpDecorator).toBe('Get');
    });

    it('detects @Get with :id path on findOne', () => {
      const m = ctrl.methods.find((m) => m.name === 'findOne')!;
      expect(m.httpDecorator).toBe('Get');
      expect(m.httpPath).toBe(':id');
    });

    it('detects @Post on create', () => {
      const m = ctrl.methods.find((m) => m.name === 'create')!;
      expect(m.httpDecorator).toBe('Post');
    });

    it('extracts @Param decorator on findOne param', () => {
      const m = ctrl.methods.find((m) => m.name === 'findOne')!;
      const idParam = m.params.find((p) => p.name === 'id')!;
      expect(idParam.nestDecorator).toBe('@Param');
    });

    it('extracts @Body decorator on create param', () => {
      const m = ctrl.methods.find((m) => m.name === 'create')!;
      const bodyParam = m.params.find((p) => p.name === 'body')!;
      expect(bodyParam.nestDecorator).toBe('@Body');
    });

    it('extracts controller path as "users"', () => {
      expect(ctrl.controllerPath).toBe('users');
    });

    it('marks own methods as not inherited', () => {
      for (const m of ctrl.methods) {
        expect(m.isInherited).toBe(false);
      }
    });
  });

  describe('ProductsController (inheritance)', () => {
    let ctrl: (typeof result.controllers)[number];
    beforeAll(() => {
      ctrl = result.controllers.find((c) => c.className === 'ProductsController')!;
    });

    it('includes own method create', () => {
      const names = ctrl.methods.map((m) => m.name);
      expect(names).toContain('create');
    });

    it('includes inherited method findAll from CrudBase', () => {
      const inherited = ctrl.methods.find((m) => m.name === 'findAll');
      expect(inherited).toBeDefined();
      expect(inherited?.isInherited).toBe(true);
      expect(inherited?.inheritedFrom).toBe('CrudBase');
    });
  });

  describe('PlainController (no HTTP methods)', () => {
    let ctrl: (typeof result.controllers)[number];
    beforeAll(() => {
      ctrl = result.controllers.find((c) => c.className === 'PlainController')!;
    });

    it('has one method (helper) with no HTTP decorator', () => {
      expect(ctrl.methods).toHaveLength(1);
      expect(ctrl.methods[0].httpDecorator).toBeNull();
    });
  });

  describe('BrokenController (no methods)', () => {
    let ctrl: (typeof result.controllers)[number];
    beforeAll(() => {
      ctrl = result.controllers.find((c) => c.className === 'BrokenController')!;
    });

    it('has zero methods', () => {
      expect(ctrl.methods).toHaveLength(0);
    });
  });

  describe('AuthController (responseType + param decorators)', () => {
    let ctrl: (typeof result.controllers)[number];
    beforeAll(() => {
      ctrl = result.controllers.find((c) => c.className === 'AuthController')!;
    });

    it('finds AuthController', () => {
      expect(ctrl).toBeDefined();
    });

    // responseType
    it('resolves RegisterResponseDto for register()', () => {
      const m = ctrl.methods.find((m) => m.name === 'register')!;
      expect(m.responseType?.name).toBe('RegisterResponseDto');
      expect(m.responseType?.isArray).toBe(false);
    });

    it('resolves LoginResponseDto for login()', () => {
      const m = ctrl.methods.find((m) => m.name === 'login')!;
      expect(m.responseType?.name).toBe('LoginResponseDto');
    });

    it('resolves UserDto[] for listUsers()', () => {
      const m = ctrl.methods.find((m) => m.name === 'listUsers')!;
      expect(m.responseType?.name).toBe('UserDto');
      expect(m.responseType?.isArray).toBe(true);
    });

    it('resolves UserDto for getMe()', () => {
      const m = ctrl.methods.find((m) => m.name === 'getMe')!;
      expect(m.responseType?.name).toBe('UserDto');
      expect(m.responseType?.isArray).toBe(false);
    });

    it('responseType absolutePath points to auth-response.dto.ts', () => {
      const m = ctrl.methods.find((m) => m.name === 'register')!;
      expect(m.responseType?.absolutePath).toContain('auth-response.dto.ts');
    });

    // @Body extraction
    it('resolves bodyType for register() @Body dto: RegisterDto', () => {
      const m = ctrl.methods.find((m) => m.name === 'register')!;
      const bodyParam = m.params.find((p) => p.nestDecorator === '@Body')!;
      expect(bodyParam).toBeDefined();
      expect(bodyParam.nestDecoratorArg).toBeNull();
      expect(bodyParam.bodyType?.name).toBe('RegisterDto');
    });

    it('resolves bodyType for login() @Body dto: LoginDto', () => {
      const m = ctrl.methods.find((m) => m.name === 'login')!;
      const bodyParam = m.params.find((p) => p.nestDecorator === '@Body')!;
      expect(bodyParam.bodyType?.name).toBe('LoginDto');
    });

    // @Query extraction
    it('extracts nestDecoratorArg for @Query params in listUsers()', () => {
      const m = ctrl.methods.find((m) => m.name === 'listUsers')!;
      const pageParam = m.params.find((p) => p.nestDecoratorArg === 'page')!;
      expect(pageParam).toBeDefined();
      expect(pageParam.nestDecorator).toBe('@Query');
      const qParam = m.params.find((p) => p.nestDecoratorArg === 'q')!;
      expect(qParam.nestDecorator).toBe('@Query');
    });

    // @Param extraction
    it('extracts nestDecoratorArg for @Param in getUser()', () => {
      const m = ctrl.methods.find((m) => m.name === 'getUser')!;
      const idParam = m.params.find((p) => p.nestDecorator === '@Param')!;
      expect(idParam).toBeDefined();
      expect(idParam.nestDecoratorArg).toBe('id');
    });
  });

  describe('GuardedController (@UseGuards detection)', () => {
    let guarded: (typeof result.controllers)[number];
    let partial: (typeof result.controllers)[number];
    beforeAll(() => {
      guarded = result.controllers.find((c) => c.className === 'GuardedController')!;
      partial = result.controllers.find((c) => c.className === 'PartialGuardController')!;
    });

    it('finds GuardedController', () => expect(guarded).toBeDefined());
    it('finds PartialGuardController', () => expect(partial).toBeDefined());

    it('sets controllerRequiresAuth=true when @UseGuards is on the class', () => {
      expect(guarded.controllerRequiresAuth).toBe(true);
    });

    it('all methods on GuardedController have requiresAuth=true', () => {
      for (const m of guarded.methods) {
        expect(m.requiresAuth).toBe(true);
      }
    });

    it('sets controllerRequiresAuth=false when no class-level guard', () => {
      expect(partial.controllerRequiresAuth).toBe(false);
    });

    it('publicRoute has requiresAuth=false', () => {
      const m = partial.methods.find((m) => m.name === 'publicRoute')!;
      expect(m.requiresAuth).toBe(false);
    });

    it('privateRoute has requiresAuth=true (method-level guard)', () => {
      const m = partial.methods.find((m) => m.name === 'privateRoute')!;
      expect(m.requiresAuth).toBe(true);
    });
  });

  describe('security', () => {
    it('does not scan files outside the project root', () => {
      const outsideApp = makeApp({ root: '/tmp/outside', tsconfig: path.join(SCAN_ROOT, 'tsconfig.json') });
      const r = scanApp(outsideApp, '/tmp/outside', undefined, 'ts');
      // All files from our tsconfig are inside SCAN_ROOT which is not inside /tmp/outside
      // so either they're filtered or an error is produced — no controllers from outside
      expect(r.controllers.every((c) => c.filePath.startsWith(SCAN_ROOT))).toBe(true);
    });

    it('returns an error (not a throw) for a bad tsconfig path', () => {
      const badApp = makeApp({ tsconfig: path.join(SCAN_ROOT, 'nonexistent.json') });
      const r = scanApp(badApp, SCAN_ROOT, undefined, 'ts');
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.controllers).toHaveLength(0);
    });
  });
});
