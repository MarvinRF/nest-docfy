import fs from 'fs';
import { checkControllers, getDocumentedMethods } from '../../cli/check';
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
// getDocumentedMethods()
// ---------------------------------------------------------------------------

describe('getDocumentedMethods()', () => {
  const DOCS_PATH = '/tmp/nestjs-docfy-test-check.docs.ts';

  afterEach(() => {
    try { fs.unlinkSync(DOCS_PATH); } catch { /* ignore */ }
  });

  it('returns empty set when file does not exist', () => {
    const result = getDocumentedMethods('/nonexistent/path/file.docs.ts');
    expect(result.size).toBe(0);
  });

  it('detects method names from a typical generated docs file', () => {
    fs.writeFileSync(DOCS_PATH, [
      "import { docs } from 'nestjs-docfy';",
      "docs(UsersController, {",
      "  methods: {",
      "    findAll: [",
      "      ApiOperation({ summary: 'Find all' }),",
      "    ],",
      "    create: [",
      "      ApiOperation({ summary: 'Create' }),",
      "    ],",
      "  },",
      "});",
    ].join('\n'), 'utf8');

    const result = getDocumentedMethods(DOCS_PATH);
    expect(result.has('findAll')).toBe(true);
    expect(result.has('create')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('does not count classDecorators as a method', () => {
    fs.writeFileSync(DOCS_PATH, [
      "docs(Controller, {",
      "  classDecorators: [",
      "    ApiTags('users'),",
      "  ],",
      "  methods: {",
      "    findOne: [",
      "    ],",
      "  },",
      "});",
    ].join('\n'), 'utf8');

    const result = getDocumentedMethods(DOCS_PATH);
    expect(result.has('findOne')).toBe(true);
    // classDecorators is outside the methods block — must not appear
    expect(result.has('classDecorators')).toBe(false);
    expect(result.size).toBe(1);
  });

  it('rejects names that are not valid identifiers (security)', () => {
    // Craft a docs file with a malicious-looking method name
    fs.writeFileSync(DOCS_PATH, [
      "docs(Ctrl, {",
      "  methods: {",
      "    valid: [",
      "  },",
      "});",
    ].join('\n'), 'utf8');

    const result = getDocumentedMethods(DOCS_PATH);
    expect(result.has('valid')).toBe(true);
    // No injection: only identifiers that pass IDENTIFIER_RE are stored
    for (const name of result) {
      expect(/^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// checkControllers()
// ---------------------------------------------------------------------------

describe('checkControllers()', () => {
  const DOCS_PATH = '/tmp/nestjs-docfy-test-check-ctrl.docs.ts';

  afterEach(() => {
    try { fs.unlinkSync(DOCS_PATH); } catch { /* ignore */ }
  });

  it('returns no issues when all controllers are fully documented', () => {
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
      methods: [makeMethod('findAll')],
    });

    const issues = checkControllers([ctrl], 'ts');
    expect(issues).toHaveLength(0);
  });

  it('reports missing-file when controller has no companion docs file', () => {
    const ctrl = makeCtrl({
      hasDocsFile: false,
      methods: [makeMethod('findAll')],
    });

    const issues = checkControllers([ctrl], 'ts');
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('missing-file');
    expect(issues[0].controllerClass).toBe('UsersController');
  });

  it('does not report missing-file when controller has no HTTP methods', () => {
    const ctrl = makeCtrl({
      hasDocsFile: false,
      methods: [makeMethod('helperMethod', null)], // no httpDecorator
    });

    const issues = checkControllers([ctrl], 'ts');
    expect(issues).toHaveLength(0);
  });

  it('reports undocumented-methods when controller has new methods', () => {
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
      methods: [
        makeMethod('findAll'),
        makeMethod('create', 'Post'), // new method, not in docs file
      ],
    });

    const issues = checkControllers([ctrl], 'ts');
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('undocumented-methods');
    expect(issues[0].methods).toContain('create');
    expect(issues[0].methods).not.toContain('findAll');
  });

  it('ignores non-HTTP methods (private helpers, etc.)', () => {
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
      methods: [
        makeMethod('findAll'),
        makeMethod('buildQuery', null), // internal, no HTTP decorator
      ],
    });

    const issues = checkControllers([ctrl], 'ts');
    expect(issues).toHaveLength(0);
  });

  it('handles multiple controllers and reports all issues', () => {
    const ctrlA = makeCtrl({
      className: 'OrdersController',
      filePath: '/project/src/orders/orders.controller.ts',
      hasDocsFile: false,
      methods: [makeMethod('findAll')],
    });
    const ctrlB = makeCtrl({
      className: 'ProductsController',
      filePath: '/project/src/products/products.controller.ts',
      hasDocsFile: false,
      methods: [makeMethod('findAll')],
    });

    const issues = checkControllers([ctrlA, ctrlB], 'ts');
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.controllerClass)).toContain('OrdersController');
    expect(issues.map((i) => i.controllerClass)).toContain('ProductsController');
  });

  it('skips method names with invalid identifiers (security)', () => {
    fs.writeFileSync(DOCS_PATH, [
      "docs(UsersController, { methods: {} });",
    ].join('\n'), 'utf8');

    const ctrl = makeCtrl({
      filePath: DOCS_PATH.replace('.docs.ts', '.ts'),
      hasDocsFile: true,
      methods: [
        { ...makeMethod('evil); process.exit(1);//', 'Get') },
      ],
    });

    // Should not crash and should not produce an issue for the invalid name
    const issues = checkControllers([ctrl], 'ts');
    // The invalid method name fails IDENTIFIER_RE and is filtered out
    expect(issues).toHaveLength(0);
  });
});
