import { computePatchedDocument } from '../../cli/patch-spec';
import type { ControllerInfo, MethodInfo } from '../../cli/extract-methods';
import type { OpenApiDocument } from '../../cli/merge-spec-patch';

function makeMethod(overrides: Partial<MethodInfo> = {}): MethodInfo {
  return {
    name: 'findAll',
    httpDecorator: 'Get',
    httpPath: '',
    httpStatusCode: null,
    params: [],
    returnType: 'unknown',
    responseType: null,
    isAsync: true,
    isInherited: false,
    inheritedFrom: null,
    requiresAuth: false,
    ...overrides,
  };
}

function makeCtrl(overrides: Partial<ControllerInfo> = {}): ControllerInfo {
  return {
    className: 'UsersController',
    filePath: '/project/src/users/users.controller.ts',
    controllerPath: 'users',
    hasDocsFile: true,
    controllerRequiresAuth: false,
    methods: [makeMethod()],
    ...overrides,
  };
}

const BASE_DOCUMENT: OpenApiDocument = {
  openapi: '3.0.0',
  paths: { '/users': { get: { operationId: 'UsersController_findAll' } } },
};

const DOCS_FILE = `
docs(UsersController, {
  classDecorators: [ApiTags('users')],
  methods: {
    findAll: [ApiOperation({ summary: 'List users' })],
  },
});
`;

describe('computePatchedDocument()', () => {
  it('patches the matching operation using the controller\'s docs file content', () => {
    const result = computePatchedDocument(BASE_DOCUMENT, [makeCtrl()], 'ts', () => DOCS_FILE);
    expect(result.document.paths!['/users'].get).toMatchObject({
      summary: 'List users',
      tags: ['users'],
    });
  });

  it('counts exactly the operations a docs file actually patched', () => {
    const result = computePatchedDocument(BASE_DOCUMENT, [makeCtrl()], 'ts', () => DOCS_FILE);
    expect(result.patchedOperationCount).toBe(1);
  });

  it('reports controllers with no docs file separately, without treating it as an error', () => {
    const ctrl = makeCtrl({ hasDocsFile: false });
    const result = computePatchedDocument(BASE_DOCUMENT, [ctrl], 'ts', () => null);
    expect(result.controllersWithoutDocs).toEqual(['UsersController']);
    expect(result.unparseableDocsFiles).toEqual([]);
  });

  it('reports a docs file that exists but fails to read/parse as unparseable', () => {
    const result = computePatchedDocument(BASE_DOCUMENT, [makeCtrl()], 'ts', () => null);
    expect(result.unparseableDocsFiles).toEqual(['/project/src/users/users.controller.docs.ts']);
  });

  it('reports a docs file with no docs(...) call as unparseable', () => {
    const result = computePatchedDocument(BASE_DOCUMENT, [makeCtrl()], 'ts', () => 'export const x = 1;');
    expect(result.unparseableDocsFiles).toEqual(['/project/src/users/users.controller.docs.ts']);
  });

  it('merges patches from multiple controllers independently', () => {
    const ordersCtrl = makeCtrl({
      className: 'OrdersController',
      filePath: '/project/src/orders/orders.controller.ts',
      controllerPath: 'orders',
    });
    const doc: OpenApiDocument = {
      paths: {
        '/users': { get: { operationId: 'a' } },
        '/orders': { get: { operationId: 'b' } },
      },
    };
    const readDocsFile = (path: string) =>
      path.includes('users') ? DOCS_FILE : `docs(OrdersController, { classDecorators: [ApiTags('orders')], methods: { findAll: [] } });`;

    const result = computePatchedDocument(doc, [makeCtrl(), ordersCtrl], 'ts', readDocsFile);
    expect(result.document.paths!['/users'].get.tags).toEqual(['users']);
    expect(result.document.paths!['/orders'].get.tags).toEqual(['orders']);
  });

  it('surfaces unmatched routes from the underlying merge (e.g. a documented method with no live route)', () => {
    const docFileWithGhost = `
      docs(UsersController, {
        classDecorators: [],
        methods: { ghostMethod: [ApiOperation({ summary: 'never routed' })] },
      });
    `;
    const ctrl = makeCtrl({ methods: [makeMethod({ name: 'ghostMethod', httpDecorator: null })] });
    const result = computePatchedDocument(BASE_DOCUMENT, [ctrl], 'ts', () => docFileWithGhost);
    // ghostMethod has no httpDecorator, so buildOpenApiPatch never even produces a route for it —
    // confirms patch-building and merge stay consistent end to end with no error.
    expect(result.unmatchedRoutes).toEqual([]);
    expect(result.patchedOperationCount).toBe(0);
  });

  it('derives the .docs.js path when format is "js"', () => {
    const calls: string[] = [];
    computePatchedDocument(BASE_DOCUMENT, [makeCtrl()], 'js', (p) => {
      calls.push(p);
      return DOCS_FILE;
    });
    expect(calls).toEqual(['/project/src/users/users.controller.docs.js']);
  });
});
