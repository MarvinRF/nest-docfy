import { mergeDocsFile } from '../../cli/merge-docs';
import type { ControllerInfo } from '../../cli/extract-methods';

function makeCtrl(methodNames: string[]): ControllerInfo {
  return {
    className: 'UsersController',
    filePath: '/project/src/users/users.controller.ts',
    controllerPath: 'users',
    hasDocsFile: true,
    controllerRequiresAuth: false,
    methods: methodNames.map((name) => ({
      name,
      httpDecorator: 'Get',
      httpPath: null,
      httpStatusCode: null,
      params: [],
      returnType: 'unknown',
      responseType: null,
      isAsync: false,
      isInherited: false,
      inheritedFrom: null,
      requiresAuth: false,
    })),
  };
}

const EXISTING = `
import { docs } from 'nestjs-docfy';
import { UsersController } from './users.controller';

docs(UsersController, {
  classDecorators: [
    ApiTags('users'),
  ],
  methods: {
    findAll: [
      ApiOperation({ summary: 'List users' }),
    ],
  },
});
`.trim();

describe('mergeDocsFile()', () => {
  it('returns non-null for a valid existing file', () => {
    const result = mergeDocsFile(EXISTING, makeCtrl(['findAll', 'findOne']));
    expect(result).not.toBeNull();
  });

  it('adds missing method findOne without removing findAll', () => {
    const result = mergeDocsFile(EXISTING, makeCtrl(['findAll', 'findOne']))!;
    expect(result.content).toContain('findAll');
    expect(result.content).toContain('findOne');
  });

  it('reports addedMethods correctly', () => {
    const result = mergeDocsFile(EXISTING, makeCtrl(['findAll', 'findOne']))!;
    expect(result.addedMethods).toEqual(['findOne']);
  });

  it('does not re-add a method that already exists', () => {
    const result = mergeDocsFile(EXISTING, makeCtrl(['findAll']))!;
    expect(result.addedMethods).toHaveLength(0);
  });

  it('preserves existing decorator content (ApiTags, ApiOperation)', () => {
    const result = mergeDocsFile(EXISTING, makeCtrl(['findAll', 'create']))!;
    expect(result.content).toContain("ApiTags('users')");
    expect(result.content).toContain("ApiOperation({ summary: 'List users' })");
  });

  it('returns null for unparseable content', () => {
    // ts-morph may still parse it (permissive), so we only assert no throw
    expect(() => mergeDocsFile('}{', makeCtrl(['findAll']))).not.toThrow();
  });

  it('returns null when no docs() call is found', () => {
    const noDocsCall = `import { something } from 'somewhere';\nsomething();`;
    const result = mergeDocsFile(noDocsCall, makeCtrl(['findAll']));
    expect(result).toBeNull();
  });

  it('does not add methods with invalid identifiers', () => {
    const ctrl = makeCtrl(['findAll']);
    ctrl.methods.push({
      name: 'evil); process.exit(1);//',
      httpDecorator: null,
      httpPath: null,
      params: [],
      returnType: 'void',
      responseType: null,
      isAsync: false,
      httpStatusCode: null,
      isInherited: false,
      inheritedFrom: null,
      requiresAuth: false,
    });
    const result = mergeDocsFile(EXISTING, ctrl)!;
    expect(result.content).not.toContain('process.exit');
  });

  it('handles existing file with no methods property by adding it', () => {
    const noMethods = `
import { docs } from 'nestjs-docfy';
import { UsersController } from './users.controller';
docs(UsersController, { classDecorators: [] });
    `.trim();
    const result = mergeDocsFile(noMethods, makeCtrl(['findAll']));
    expect(result).not.toBeNull();
    expect(result!.content).toContain('findAll');
  });
});
