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

  // Achado 1: a companion file with more than one docs() call (a source file
  // exporting several @Controller classes, e.g. an api-gateway grouping
  // proxy controllers by domain) used to always merge into the FIRST call
  // found, regardless of which class the new methods actually belong to.
  describe('multi-class companion file (Achado 1)', () => {
    const MULTI = `
import { docs } from 'nestjs-docfy';
import { CasosController, WebhookController } from './agente-ia.controller';

docs(CasosController, {
  classDecorators: [
    ApiTags('casos'),
  ],
  methods: {
    criar: [
      ApiOperation({ summary: 'Criar' }),
    ],
  },
});

docs(WebhookController, {
  classDecorators: [
    ApiTags('webhook'),
  ],
  methods: {},
});
`.trim();

    function makeWebhookCtrl(methodNames: string[]) {
      const ctrl = makeCtrl(methodNames);
      ctrl.className = 'WebhookController';
      return ctrl;
    }

    it('merges a new method into the matching class only, not the first docs() call in the file', () => {
      const result = mergeDocsFile(MULTI, makeWebhookCtrl(['receber']))!;
      expect(result).not.toBeNull();
      expect(result.addedMethods).toEqual(['receber']);

      // `receber` must land inside WebhookController's own methods object —
      // not inside CasosController's, which would fail to type-check
      // ("Object literal may only specify known properties").
      const webhookBlock = result.content.slice(result.content.indexOf('docs(WebhookController'));
      expect(webhookBlock).toContain('receber');

      const casosBlock = result.content.slice(0, result.content.indexOf('docs(WebhookController'));
      expect(casosBlock).not.toContain('receber');
      expect(casosBlock).toContain('criar');
    });

    it('leaves the other class entirely untouched', () => {
      const result = mergeDocsFile(MULTI, makeWebhookCtrl(['receber']))!;
      expect(result.content).toContain("ApiTags('casos')");
      expect(result.content).toContain('criar');
    });

    it('returns null (not a wrong merge) when the class has no docs() call in the file at all', () => {
      const ctrl = makeCtrl(['findAll']);
      ctrl.className = 'SimuladorController';
      const result = mergeDocsFile(MULTI, ctrl);
      expect(result).toBeNull();
    });
  });
});
