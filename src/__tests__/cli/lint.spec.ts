import fs from 'fs';
import { lintControllers, parseDocsFileMethods } from '../../cli/lint';
import type { ControllerInfo } from '../../cli/extract-methods';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtrl(overrides: Partial<ControllerInfo> = {}): ControllerInfo {
  return {
    className: 'UsersController',
    filePath: '/tmp/nestjs-docfy-test-lint.controller.ts',
    controllerPath: 'users',
    hasDocsFile: true,
    controllerRequiresAuth: false,
    methods: [],
    ...overrides,
  };
}

function makeMethod(overrides: Partial<ReturnType<typeof baseMethod>> = {}) {
  return { ...baseMethod(), ...overrides };
}

function baseMethod() {
  return {
    name: 'findAll',
    httpDecorator: 'Get' as string | null,
    httpPath: null as string | null,
    httpStatusCode: null,
    params: [] as {
      name: string;
      type: string;
      nestDecorator: string | null;
      nestDecoratorArg: string | null;
      bodyType: null;
    }[],
    returnType: 'unknown',
    responseType: null,
    isAsync: false,
    isInherited: false,
    inheritedFrom: null,
    requiresAuth: false,
  };
}

function bodyParam() {
  return { name: 'dto', type: 'CreateUserDto', nestDecorator: '@Body', nestDecoratorArg: null, bodyType: null };
}

const DOCS_PATH = '/tmp/nestjs-docfy-test-lint.controller.docs.ts';

function writeDocs(content: string): void {
  fs.writeFileSync(DOCS_PATH, content, 'utf8');
}

// ---------------------------------------------------------------------------
// parseDocsFileMethods()
// ---------------------------------------------------------------------------

describe('parseDocsFileMethods()', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(DOCS_PATH);
    } catch {
      /* ignore */
    }
  });

  it('returns empty map when file does not exist', () => {
    const result = parseDocsFileMethods('/nonexistent/file.docs.ts');
    expect(result.size).toBe(0);
  });

  it('detects summary presence on ApiOperation', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    findAll: [',
        "      ApiOperation({ summary: 'Find all' }),",
        '    ],',
        '    create: [',
        '      ApiOperation({}),',
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const result = parseDocsFileMethods(DOCS_PATH);
    expect(result.get('findAll')?.hasSummary).toBe(true);
    expect(result.get('create')?.hasSummary).toBe(false);
  });

  it('collects ApiResponse status codes', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    create: [',
        '      ApiResponse({ status: 201 }),',
        '      ApiResponse({ status: 400 }),',
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const result = parseDocsFileMethods(DOCS_PATH);
    expect(result.get('create')?.responseStatuses.has(201)).toBe(true);
    expect(result.get('create')?.responseStatuses.has(400)).toBe(true);
    expect(result.get('create')?.responseStatuses.has(404)).toBe(false);
  });

  it('detects ApiBody presence and description', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    create: [',
        "      ApiBody({ type: CreateUserDto, description: 'payload' }),",
        '    ],',
        '    update: [',
        '      ApiBody({ type: UpdateUserDto }),',
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const result = parseDocsFileMethods(DOCS_PATH);
    expect(result.get('create')?.hasApiBody).toBe(true);
    expect(result.get('create')?.hasBodyDescription).toBe(true);
    expect(result.get('update')?.hasApiBody).toBe(true);
    expect(result.get('update')?.hasBodyDescription).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lintControllers()
// ---------------------------------------------------------------------------

describe('lintControllers()', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(DOCS_PATH);
    } catch {
      /* ignore */
    }
  });

  it('skips controllers with no docs file', () => {
    const ctrl = makeCtrl({ hasDocsFile: false, methods: [makeMethod()] });
    const issues = lintControllers([ctrl], 'ts');
    expect(issues).toHaveLength(0);
  });

  it('skips methods not present in the docs file', () => {
    writeDocs('docs(UsersController, { methods: {} });');
    const ctrl = makeCtrl({ methods: [makeMethod({ name: 'findAll' })] });
    const issues = lintControllers([ctrl], 'ts');
    expect(issues).toHaveLength(0);
  });

  it('reports missing-summary when ApiOperation has no summary', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    findAll: [',
        '      ApiOperation({}),',
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const ctrl = makeCtrl({ methods: [makeMethod({ name: 'findAll' })] });
    const issues = lintControllers([ctrl], 'ts');

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('missing-summary');
    expect(issues[0].route).toBe('GET /users');
  });

  it('does not report missing-summary when summary is present', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    findAll: [',
        "      ApiOperation({ summary: 'Find all' }),",
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const ctrl = makeCtrl({ methods: [makeMethod({ name: 'findAll' })] });
    const issues = lintControllers([ctrl], 'ts');
    expect(issues).toHaveLength(0);
  });

  it('reports missing-400-response only for methods with a @Body param', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    create: [',
        "      ApiOperation({ summary: 'Create' }),",
        '      ApiResponse({ status: 201 }),',
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const ctrl = makeCtrl({
      methods: [makeMethod({ name: 'create', httpDecorator: 'Post', params: [bodyParam()] })],
    });
    const issues = lintControllers([ctrl], 'ts');

    const rules = issues.map((i) => i.rule);
    expect(rules).toContain('missing-400-response');
    expect(issues[0].route).toBe('POST /users');
  });

  it('does not report missing-400-response for methods without a body', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    findAll: [',
        "      ApiOperation({ summary: 'Find all' }),",
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const ctrl = makeCtrl({ methods: [makeMethod({ name: 'findAll' })] });
    const issues = lintControllers([ctrl], 'ts');
    expect(issues.some((i) => i.rule === 'missing-400-response')).toBe(false);
  });

  it('reports missing-body-description when ApiBody lacks description', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    create: [',
        "      ApiOperation({ summary: 'Create' }),",
        '      ApiResponse({ status: 400 }),',
        '      ApiBody({ type: CreateUserDto }),',
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const ctrl = makeCtrl({
      methods: [makeMethod({ name: 'create', httpDecorator: 'Post', httpPath: ':id', params: [bodyParam()] })],
    });
    const issues = lintControllers([ctrl], 'ts');

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('missing-body-description');
    expect(issues[0].route).toBe('POST /users/:id');
  });

  it('reports missing-body-description when ApiBody is absent entirely', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    create: [',
        "      ApiOperation({ summary: 'Create' }),",
        '      ApiResponse({ status: 400 }),',
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const ctrl = makeCtrl({
      methods: [makeMethod({ name: 'create', httpDecorator: 'Post', params: [bodyParam()] })],
    });
    const issues = lintControllers([ctrl], 'ts');
    expect(issues.some((i) => i.rule === 'missing-body-description')).toBe(true);
  });

  it('reports no issues for a fully-compliant method', () => {
    writeDocs(
      [
        'docs(UsersController, {',
        '  methods: {',
        '    create: [',
        "      ApiOperation({ summary: 'Create' }),",
        '      ApiResponse({ status: 201 }),',
        '      ApiResponse({ status: 400 }),',
        "      ApiBody({ type: CreateUserDto, description: 'payload' }),",
        '    ],',
        '  },',
        '});',
      ].join('\n'),
    );

    const ctrl = makeCtrl({
      methods: [makeMethod({ name: 'create', httpDecorator: 'Post', params: [bodyParam()] })],
    });
    const issues = lintControllers([ctrl], 'ts');
    expect(issues).toHaveLength(0);
  });

  it('skips method names with invalid identifiers (security)', () => {
    writeDocs('docs(UsersController, { methods: {} });');
    const ctrl = makeCtrl({
      methods: [makeMethod({ name: 'evil); process.exit(1);//' })],
    });
    const issues = lintControllers([ctrl], 'ts');
    expect(issues).toHaveLength(0);
  });
});
