import path from 'path';
import { renderDocsFile, relativeImport } from '../../cli/generate-file';
import type { ControllerInfo } from '../../cli/extract-methods';

function makeCtrl(overrides: Partial<ControllerInfo> = {}): ControllerInfo {
  return {
    className: 'UsersController',
    filePath: '/project/src/users/users.controller.ts',
    controllerPath: 'users',
    hasDocsFile: false,
    methods: [
      {
        name: 'findAll',
        httpDecorator: 'Get',
        httpPath: '',
        params: [],
        returnType: 'Promise<string[]>',
        isAsync: true,
        isInherited: false,
        inheritedFrom: null,
      },
      {
        name: 'findOne',
        httpDecorator: 'Get',
        httpPath: ':id',
        params: [{ name: 'id', type: 'string', nestDecorator: '@Param' }],
        returnType: 'Promise<string>',
        isAsync: true,
        isInherited: false,
        inheritedFrom: null,
      },
    ],
    ...overrides,
  };
}

const DOCS_PATH = '/project/src/users/users.controller.docs.ts';

describe('relativeImport()', () => {
  it('produces a relative path from docs file to controller', () => {
    const result = relativeImport(DOCS_PATH, '/project/src/users/users.controller.ts');
    expect(result).toBe('./users.controller');
  });

  it('handles cross-directory imports', () => {
    const result = relativeImport(
      '/project/src/docs/users.controller.docs.ts',
      '/project/src/users/users.controller.ts',
    );
    expect(result).toContain('../users/users.controller');
  });

  it('always starts with ./', () => {
    const result = relativeImport(DOCS_PATH, '/project/src/users/users.controller.ts');
    expect(result.startsWith('.')).toBe(true);
  });
});

describe('renderDocsFile() — ts format', () => {
  let output: string;
  beforeAll(() => {
    output = renderDocsFile(makeCtrl(), DOCS_PATH, 'ts');
  });

  it('contains the import from nestjs-docfy', () => {
    expect(output).toContain("from 'nestjs-docfy'");
  });

  it('contains the controller import', () => {
    expect(output).toContain('UsersController');
    expect(output).toContain('./users.controller');
  });

  it('contains docs() call', () => {
    expect(output).toContain('docs(UsersController,');
  });

  it('contains findAll method key', () => {
    expect(output).toContain('findAll:');
  });

  it('contains findOne method key', () => {
    expect(output).toContain('findOne:');
  });

  it('contains GET route in comment for findAll', () => {
    expect(output).toContain('GET');
  });

  it('contains :id path in comment for findOne', () => {
    expect(output).toContain(':id');
  });

  it('contains ApiOperation placeholder comment', () => {
    expect(output).toContain('// ApiOperation');
  });

  it('contains ApiResponse placeholder comment', () => {
    expect(output).toContain('// ApiResponse');
  });

  it('contains generated timestamp comment', () => {
    expect(output).toContain('Generated:');
  });
});

describe('renderDocsFile() — js format', () => {
  let output: string;
  beforeAll(() => {
    output = renderDocsFile(makeCtrl(), DOCS_PATH.replace('.ts', '.js'), 'js');
  });

  it('uses require instead of import', () => {
    expect(output).toContain("require('nestjs-docfy')");
    expect(output).toContain('UsersController');
  });

  it('does not contain import keyword', () => {
    expect(output).not.toMatch(/^import /m);
  });
});

describe('renderDocsFile() — security: sanitisation', () => {
  it('does not inject code via malicious className', () => {
    const ctrl = makeCtrl({ className: 'Evil`); process.exit(1); docs(' });
    const output = renderDocsFile(ctrl, DOCS_PATH, 'ts');
    expect(output).not.toContain('process.exit');
    expect(output).toContain('Controller'); // fallback identifier used
  });

  it('does not inject code via malicious method name', () => {
    const ctrl = makeCtrl({
      methods: [{
        name: 'evil`); process.exit(1);//',
        httpDecorator: null, httpPath: null, params: [],
        returnType: 'void', isAsync: false, isInherited: false, inheritedFrom: null,
      }],
    });
    const output = renderDocsFile(ctrl, DOCS_PATH, 'ts');
    expect(output).not.toContain('process.exit');
  });

  it('does not break out of string literals via malicious controllerPath', () => {
    // controllerPath appears only inside a comment — the real risk is breaking
    // out of a string/template literal into executable code. Verify that
    // string-breaking characters are stripped.
    const ctrl = makeCtrl({ controllerPath: "'); require('child_process').execSync('id')//" });
    const output = renderDocsFile(ctrl, DOCS_PATH, 'ts');
    // The dangerous characters ' and ) must not appear outside of a comment context
    // We verify the import/docs() call lines are not corrupted
    const codeLines = output.split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
    expect(codeLines.join('\n')).not.toContain("require('child_process')");
  });

  it('does not break out of comment blocks via malicious returnType', () => {
    // returnType appears in a line comment — the real risk is closing a block
    // comment with */ and injecting code after it. Verify * is stripped.
    const ctrl = makeCtrl({
      methods: [{
        name: 'findAll',
        httpDecorator: 'Get', httpPath: null, params: [],
        returnType: '*/ require("child_process").execSync("id") /*',
        isAsync: false, isInherited: false, inheritedFrom: null,
      }],
    });
    const output = renderDocsFile(ctrl, DOCS_PATH, 'ts');
    // * is stripped by sanitizeComment, so */ cannot appear from returnType
    expect(output).not.toContain('require("child_process")');
  });
});

describe('renderDocsFile() — edge cases', () => {
  it('handles controller with no methods gracefully', () => {
    const ctrl = makeCtrl({ methods: [] });
    const output = renderDocsFile(ctrl, DOCS_PATH, 'ts');
    expect(output).toContain('No public HTTP methods found');
  });

  it('handles null controllerPath (no route argument)', () => {
    const ctrl = makeCtrl({ controllerPath: null });
    expect(() => renderDocsFile(ctrl, DOCS_PATH, 'ts')).not.toThrow();
  });

  it('handles inherited method with inheritedFrom label', () => {
    const ctrl = makeCtrl({
      methods: [{
        name: 'findAll',
        httpDecorator: 'Get', httpPath: null, params: [],
        returnType: 'unknown',
        isAsync: false, isInherited: true, inheritedFrom: 'CrudBase',
      }],
    });
    const output = renderDocsFile(ctrl, DOCS_PATH, 'ts');
    expect(output).toContain('CrudBase');
  });
});
