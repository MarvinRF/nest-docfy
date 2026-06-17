import fs from 'fs';
import { computeCoverage } from '../../cli/coverage';
import type { ControllerInfo } from '../../cli/extract-methods';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtrl(overrides: Partial<ControllerInfo> = {}): ControllerInfo {
  return {
    className: 'UsersController',
    filePath: '/project/src/users/users.controller.ts',
    controllerPath: 'users',
    hasDocsFile: false,
    controllerRequiresAuth: false,
    methods: [],
    ...overrides,
  };
}

function makeMethod(name: string, httpDecorator: string | null = 'Get') {
  return {
    name,
    httpDecorator,
    httpPath: null,
    httpStatusCode: null,
    params: [],
    returnType: 'unknown',
    responseType: null,
    isAsync: false,
    isInherited: false,
    inheritedFrom: null,
    requiresAuth: false,
  };
}

// ---------------------------------------------------------------------------
// computeCoverage()
// ---------------------------------------------------------------------------

describe('computeCoverage()', () => {
  const DOCS_PATH = '/tmp/nestjs-docfy-test-coverage.docs.ts';

  afterEach(() => {
    try { fs.unlinkSync(DOCS_PATH); } catch { /* ignore */ }
  });

  it('returns NaN coveragePercent when there are no endpoints', () => {
    const ctrl = makeCtrl({ methods: [] });
    const report = computeCoverage([ctrl], 'ts');

    expect(report.totalControllers).toBe(1);
    expect(report.totalEndpoints).toBe(0);
    expect(report.documentedEndpoints).toBe(0);
    expect(report.missingEndpoints).toBe(0);
    expect(Number.isNaN(report.coveragePercent)).toBe(true);
  });

  it('ignores non-HTTP methods in endpoint count', () => {
    const ctrl = makeCtrl({
      methods: [
        makeMethod('findAll', 'Get'),
        makeMethod('helperMethod', null),
      ],
    });
    const report = computeCoverage([ctrl], 'ts');

    expect(report.totalEndpoints).toBe(1);
    expect(report.documentedEndpoints).toBe(0);
  });

  it('reports 0% when controller has no docs file', () => {
    const ctrl = makeCtrl({
      hasDocsFile: false,
      methods: [makeMethod('findAll'), makeMethod('create', 'Post')],
    });
    const report = computeCoverage([ctrl], 'ts');

    expect(report.totalEndpoints).toBe(2);
    expect(report.documentedEndpoints).toBe(0);
    expect(report.missingEndpoints).toBe(2);
    expect(report.coveragePercent).toBe(0);
  });

  it('reports 100% when all methods are documented', () => {
    fs.writeFileSync(DOCS_PATH, [
      "docs(UsersController, {",
      "  methods: {",
      "    findAll: [",
      "    ],",
      "    create: [",
      "    ],",
      "  },",
      "});",
    ].join('\n'), 'utf8');

    const ctrl = makeCtrl({
      filePath: DOCS_PATH.replace('.docs.ts', '.ts'),
      hasDocsFile: true,
      methods: [makeMethod('findAll'), makeMethod('create', 'Post')],
    });
    const report = computeCoverage([ctrl], 'ts');

    expect(report.totalEndpoints).toBe(2);
    expect(report.documentedEndpoints).toBe(2);
    expect(report.missingEndpoints).toBe(0);
    expect(report.coveragePercent).toBe(100);
  });

  it('reports partial coverage correctly (1 of 2 documented = 50%)', () => {
    fs.writeFileSync(DOCS_PATH, [
      "docs(UsersController, {",
      "  methods: {",
      "    findAll: [",
      "    ],",
      "  },",
      "});",
    ].join('\n'), 'utf8');

    const ctrl = makeCtrl({
      filePath: DOCS_PATH.replace('.docs.ts', '.ts'),
      hasDocsFile: true,
      methods: [makeMethod('findAll'), makeMethod('create', 'Post')],
    });
    const report = computeCoverage([ctrl], 'ts');

    expect(report.totalEndpoints).toBe(2);
    expect(report.documentedEndpoints).toBe(1);
    expect(report.missingEndpoints).toBe(1);
    expect(report.coveragePercent).toBe(50);
  });

  it('aggregates across multiple controllers', () => {
    fs.writeFileSync(DOCS_PATH, [
      "docs(UsersController, {",
      "  methods: {",
      "    findAll: [",
      "    ],",
      "  },",
      "});",
    ].join('\n'), 'utf8');

    const ctrlA = makeCtrl({
      className: 'UsersController',
      filePath: DOCS_PATH.replace('.docs.ts', '.ts'),
      hasDocsFile: true,
      methods: [makeMethod('findAll'), makeMethod('create', 'Post')],
    });
    const ctrlB = makeCtrl({
      className: 'ProductsController',
      filePath: '/project/src/products/products.controller.ts',
      hasDocsFile: false,
      methods: [makeMethod('findAll'), makeMethod('findOne')],
    });

    const report = computeCoverage([ctrlA, ctrlB], 'ts');

    expect(report.totalControllers).toBe(2);
    expect(report.totalEndpoints).toBe(4);
    expect(report.documentedEndpoints).toBe(1);
    expect(report.missingEndpoints).toBe(3);
    expect(report.coveragePercent).toBe(25);
  });

  it('rounds to one decimal place (e.g. 1 of 3 → 33.3%)', () => {
    fs.writeFileSync(DOCS_PATH, [
      "docs(UsersController, {",
      "  methods: {",
      "    findAll: [",
      "    ],",
      "  },",
      "});",
    ].join('\n'), 'utf8');

    const ctrl = makeCtrl({
      filePath: DOCS_PATH.replace('.docs.ts', '.ts'),
      hasDocsFile: true,
      methods: [makeMethod('findAll'), makeMethod('create', 'Post'), makeMethod('remove', 'Delete')],
    });
    const report = computeCoverage([ctrl], 'ts');

    expect(report.totalEndpoints).toBe(3);
    expect(report.documentedEndpoints).toBe(1);
    expect(report.coveragePercent).toBe(33.3);
  });

  it('returns zero controllers and NaN when given empty array', () => {
    const report = computeCoverage([], 'ts');

    expect(report.totalControllers).toBe(0);
    expect(report.totalEndpoints).toBe(0);
    expect(Number.isNaN(report.coveragePercent)).toBe(true);
  });
});
