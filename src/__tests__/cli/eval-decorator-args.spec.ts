import { Project, SyntaxKind } from 'ts-morph';
import { evaluateExpression, evaluateDecoratorCall, isUnresolved } from '../../cli/eval-decorator-args';

function parseExpression(source: string) {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sf = project.createSourceFile('x.ts', `const __x = ${source};`);
  const decl = sf.getVariableDeclarationOrThrow('__x');
  return decl.getInitializerOrThrow();
}

function parseArrayElement(source: string) {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sf = project.createSourceFile('x.ts', `const __arr = [${source}];`);
  const arr = sf.getVariableDeclarationOrThrow('__arr').getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
  return arr.getElements()[0];
}

describe('evaluateExpression()', () => {
  it.each([
    [`'hello'`, 'hello'],
    [`"hello"`, 'hello'],
    ['`hello`', 'hello'],
    ['42', 42],
    ['-7', -7],
    ['true', true],
    ['false', false],
    ['null', null],
  ])('evaluates literal %s', (source, expected) => {
    expect(evaluateExpression(parseExpression(source))).toEqual(expected);
  });

  it('evaluates an array literal recursively', () => {
    expect(evaluateExpression(parseExpression(`['a', 1, true]`))).toEqual(['a', 1, true]);
  });

  it('evaluates an object literal with PropertyAssignment entries', () => {
    expect(evaluateExpression(parseExpression(`{ summary: 'Get user', deprecated: false }`))).toEqual({
      summary: 'Get user',
      deprecated: false,
    });
  });

  it('evaluates nested objects and arrays', () => {
    expect(evaluateExpression(parseExpression(`{ status: 201, tags: ['a', 'b'], nested: { x: 1 } }`))).toEqual({
      status: 201,
      tags: ['a', 'b'],
      nested: { x: 1 },
    });
  });

  it('resolves HttpStatus.X member access to its numeric value', () => {
    expect(evaluateExpression(parseExpression('HttpStatus.CREATED'))).toBe(201);
    expect(evaluateExpression(parseExpression('HttpStatus.NOT_FOUND'))).toBe(404);
  });

  it('resolves a string enum identifier to its member values', () => {
    const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
    const sf = project.createSourceFile('x.ts', `enum Role { Admin = 'admin', User = 'user' } const __x = Role;`);
    const decl = sf.getVariableDeclarationOrThrow('__x');
    expect(evaluateExpression(decl.getInitializerOrThrow())).toEqual(['admin', 'user']);
  });

  it('resolves a numeric enum identifier to its auto-incremented member values', () => {
    const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
    const sf = project.createSourceFile('x.ts', `enum Level { Low, Medium, High } const __x = Level;`);
    const decl = sf.getVariableDeclarationOrThrow('__x');
    expect(evaluateExpression(decl.getInitializerOrThrow())).toEqual([0, 1, 2]);
  });

  it('resolves a const enum identifier to its member values', () => {
    const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
    const sf = project.createSourceFile('x.ts', `const enum Role { Admin = 'admin', User = 'user' } const __x = Role;`);
    const decl = sf.getVariableDeclarationOrThrow('__x');
    expect(evaluateExpression(decl.getInitializerOrThrow())).toEqual(['admin', 'user']);
  });

  it('marks an unresolvable property access (not HttpStatus) as Unresolved', () => {
    const result = evaluateExpression(parseExpression('SomeEnum.VALUE'));
    expect(isUnresolved(result)).toBe(true);
  });

  it('marks a variable reference as Unresolved, preserving its source text', () => {
    const result = evaluateExpression(parseExpression('someVariable'));
    expect(isUnresolved(result)).toBe(true);
    expect((result as { text: string }).text).toBe('someVariable');
  });

  it('marks a function call as Unresolved rather than throwing', () => {
    const result = evaluateExpression(parseExpression('computeSomething()'));
    expect(isUnresolved(result)).toBe(true);
  });

  it('marks a shorthand property as Unresolved but keeps evaluating sibling properties', () => {
    const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
    const sf = project.createSourceFile('x.ts', `const shared = 1; const __x = { shared, summary: 'ok' };`);
    const initializer = sf.getVariableDeclarationOrThrow('__x').getInitializerOrThrow();
    const result = evaluateExpression(initializer) as Record<string, unknown>;
    expect(result.summary).toBe('ok');
    expect(isUnresolved(result.shared as never)).toBe(true);
  });
});

describe('evaluateDecoratorCall()', () => {
  it('extracts name and evaluated args from a simple call', () => {
    const node = parseArrayElement(`ApiTags('users')`);
    expect(evaluateDecoratorCall(node)).toEqual({ name: 'ApiTags', args: ['users'] });
  });

  it('extracts name and an evaluated object-literal arg', () => {
    const node = parseArrayElement(`ApiOperation({ summary: 'List users' })`);
    expect(evaluateDecoratorCall(node)).toEqual({
      name: 'ApiOperation',
      args: [{ summary: 'List users' }],
    });
  });

  it('extracts a zero-argument call', () => {
    const node = parseArrayElement(`ApiBearerAuth()`);
    expect(evaluateDecoratorCall(node)).toEqual({ name: 'ApiBearerAuth', args: [] });
  });

  it('returns null for a non-call expression', () => {
    const node = parseArrayElement(`'not a call'`);
    expect(evaluateDecoratorCall(node)).toBeNull();
  });
});
