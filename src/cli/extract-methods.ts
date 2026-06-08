import { ClassDeclaration, MethodDeclaration, ParameterDeclaration, SyntaxKind, Type } from 'ts-morph';

export interface ParamInfo {
  name: string;
  type: string;
  nestDecorator: string | null;    // '@Param', '@Body', '@Query', etc.
  nestDecoratorArg: string | null; // e.g. 'id' from @Param('id'), null when no arg
  bodyType: ResponseTypeInfo | null; // resolved DTO type for @Body() params
}

/**
 * A resolved DTO/entity type suitable for use in ApiResponse/ApiBody({ type: ... }).
 * Only set when the type resolves to a named class or interface from
 * a source file — primitives, inline objects, and unresolvable types are null.
 */
export interface ResponseTypeInfo {
  /** Short identifier name, e.g. "RegisterResponseDto" */
  name: string;
  /** Absolute path to the file that declares the type */
  absolutePath: string;
  /** True when the original type was an array, e.g. Promise<User[]> */
  isArray: boolean;
}

export interface MethodInfo {
  name: string;
  httpDecorator: string | null; // 'Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'
  httpPath: string | null;
  params: ParamInfo[];
  returnType: string;
  responseType: ResponseTypeInfo | null;
  isAsync: boolean;
  isInherited: boolean;
  inheritedFrom: string | null;
  requiresAuth: boolean; // true when method or controller has a JWT-like guard
}

export interface ControllerInfo {
  className: string;
  filePath: string;
  controllerPath: string | null; // value of @Controller('path')
  methods: MethodInfo[];
  hasDocsFile: boolean; // will be set by the scanner
  controllerRequiresAuth: boolean; // true when @UseGuards is on the controller itself
}

const HTTP_DECORATORS = new Set([
  'Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All',
]);

const NEST_PARAM_DECORATORS = new Set([
  'Param', 'Body', 'Query', 'Headers', 'Req', 'Res', 'Request',
  'Response', 'Session', 'UploadedFile', 'UploadedFiles', 'Ip', 'HostParam',
]);

/** Primitives and built-ins that should never appear as ApiResponse/ApiBody type. */
const SKIP_TYPE_NAMES = new Set([
  'void', 'undefined', 'null', 'never', 'unknown', 'any',
  'string', 'number', 'boolean', 'object', 'symbol', 'bigint',
  'String', 'Number', 'Boolean', 'Object', 'Array',
  'Promise', 'Observable', 'Subject', 'BehaviorSubject',
]);

const IDENTIFIER_RE = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;

function getDecoratorName(dec: { getName(): string | undefined }): string | null {
  try {
    return dec.getName() ?? null;
  } catch {
    return null;
  }
}

function getDecoratorFirstStringArg(method: MethodDeclaration, decoratorName: string): string | null {
  try {
    const dec = method.getDecorator(decoratorName);
    if (!dec) return null;
    const args = dec.getArguments();
    if (args.length === 0) return '';
    const first = args[0];
    if (first.getKind() === SyntaxKind.StringLiteral) {
      return first.getText().replace(/^['"`]|['"`]$/g, '');
    }
    return null;
  } catch {
    return null;
  }
}

/** Extracts the first string argument of a parameter-level decorator, e.g. 'id' from @Param('id'). */
function getParamDecoratorArg(p: ParameterDeclaration, decoratorName: string): string | null {
  try {
    const dec = p.getDecorator(decoratorName);
    if (!dec) return null;
    const args = dec.getArguments();
    if (args.length === 0) return null;
    const first = args[0];
    if (first.getKind() === SyntaxKind.StringLiteral) {
      return first.getText().replace(/^['"`]|['"`]$/g, '');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves a named DTO/class type from a ts-morph Type.
 * Returns null for primitives, anonymous objects, union/intersection, node_modules, .d.ts.
 */
function resolveNamedType(type: Type, isArray: boolean): ResponseTypeInfo | null {
  try {
    if (type.isString() || type.isNumber() || type.isBoolean()) return null;
    if (type.isUndefined() || type.isNull() || type.isVoid()) return null;
    if (type.isAnonymous()) return null;
    if (type.isUnion() || type.isIntersection()) return null;
    if (type.isTuple()) return null;

    const symbol = type.getSymbol() ?? type.getAliasSymbol();
    if (!symbol) return null;

    const name = symbol.getName();
    if (!name || !IDENTIFIER_RE.test(name)) return null;
    if (SKIP_TYPE_NAMES.has(name)) return null;

    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) return null;

    const sourceFile = declarations[0].getSourceFile();
    const absolutePath = sourceFile.getFilePath();

    if (absolutePath.includes('node_modules')) return null;
    if (absolutePath.endsWith('.d.ts')) return null;

    return { name, absolutePath, isArray };
  } catch {
    return null;
  }
}

function extractParams(method: MethodDeclaration): ParamInfo[] {
  try {
    return method.getParameters().map((p) => {
      let nestDecorator: string | null = null;
      let nestDecoratorArg: string | null = null;
      let decoratorShortName: string | null = null;

      for (const dec of p.getDecorators()) {
        const name = getDecoratorName(dec);
        if (name && NEST_PARAM_DECORATORS.has(name)) {
          nestDecorator = `@${name}`;
          decoratorShortName = name;
          nestDecoratorArg = getParamDecoratorArg(p, name);
          break;
        }
      }

      const typeNode = p.getTypeNode();
      const typeText = typeNode ? typeNode.getText() : 'unknown';

      // Resolve DTO type only for @Body() without a field selector
      // @Body('field') means partial body — skip DTO resolution for those
      let bodyType: ResponseTypeInfo | null = null;
      if (decoratorShortName === 'Body' && nestDecoratorArg === null) {
        try {
          const paramType = p.getType();
          bodyType = resolveNamedType(paramType, false);
        } catch {
          // type resolution is best-effort
        }
      }

      return {
        name: p.getName(),
        type: typeText,
        nestDecorator,
        nestDecoratorArg,
        bodyType,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Unwraps Promise<T> → T, and Observable<T> → T.
 * Returns the original type if it's not a wrapper.
 */
function unwrapAsync(type: Type): Type {
  try {
    const name = type.getSymbol()?.getName();
    if (name === 'Promise' || name === 'Observable') {
      const args = type.getTypeArguments();
      if (args.length > 0) return args[0];
    }
  } catch {
    // ignore
  }
  return type;
}

/**
 * Resolves the ResponseTypeInfo for a method's return type.
 * Returns null for primitives, inline objects, void, and unresolvable types.
 */
function resolveResponseType(method: MethodDeclaration): ResponseTypeInfo | null {
  try {
    const rawType = method.getReturnType();
    const inner = unwrapAsync(rawType);

    let isArray = false;
    let elementType = inner;
    if (inner.isArray()) {
      isArray = true;
      elementType = inner.getArrayElementTypeOrThrow();
    }

    return resolveNamedType(elementType, isArray);
  } catch {
    return null;
  }
}

/**
 * Strips ts-morph's fully-qualified import paths from inferred type text.
 * e.g. Promise<import("/abs/path/foo.dto").FooDto> → Promise<FooDto>
 */
function cleanTypeText(text: string): string {
  return text.replace(/import\([^)]+\)\./g, '');
}

/**
 * Returns true if any @UseGuards argument looks like a JWT/auth guard.
 * Matches names containing 'Jwt', 'Auth', or 'Bearer' (case-insensitive).
 */
function hasJwtGuard(decorators: ReturnType<ClassDeclaration['getDecorators']>): boolean {
  for (const dec of decorators) {
    try {
      if (dec.getName() !== 'UseGuards') continue;
      for (const arg of dec.getArguments()) {
        const text = arg.getText();
        if (/jwt|auth|bearer/i.test(text)) return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Extracts public, non-static methods from a controller class declaration.
 * Marks inherited methods (from base classes) but still includes them.
 * Private and protected methods are ignored.
 * controllerAuth: whether the controller-level @UseGuards was detected as JWT.
 */
export function extractMethods(cls: ClassDeclaration, controllerAuth: boolean): MethodInfo[] {
  const results: MethodInfo[] = [];
  const ownMethodNames = new Set(
    cls.getMethods().map((m) => m.getName()),
  );

  // Own methods
  for (const method of cls.getMethods()) {
    if (method.hasModifier(SyntaxKind.PrivateKeyword)) continue;
    if (method.hasModifier(SyntaxKind.ProtectedKeyword)) continue;
    if (method.isStatic()) continue;

    let httpDecorator: string | null = null;
    let httpPath: string | null = null;

    for (const dec of method.getDecorators()) {
      const name = getDecoratorName(dec);
      if (name && HTTP_DECORATORS.has(name)) {
        httpDecorator = name;
        httpPath = getDecoratorFirstStringArg(method, name);
        break;
      }
    }

    let returnType = 'unknown';
    try {
      const returnTypeNode = method.getReturnTypeNode();
      returnType = returnTypeNode
        ? returnTypeNode.getText()
        : cleanTypeText(method.getReturnType().getText());
    } catch {
      // ts-morph can fail to infer complex types — keep 'unknown'
    }

    const responseType = resolveResponseType(method);
    const methodAuth = hasJwtGuard(method.getDecorators());

    results.push({
      name: method.getName(),
      httpDecorator,
      httpPath,
      params: extractParams(method),
      returnType,
      responseType,
      isAsync: method.isAsync(),
      isInherited: false,
      inheritedFrom: null,
      requiresAuth: controllerAuth || methodAuth,
    });
  }

  // Inherited methods from base class(es)
  try {
    const baseClass = cls.getBaseClass();
    if (baseClass) {
      const baseClassName = baseClass.getName() ?? 'unknown';
      for (const method of baseClass.getMethods()) {
        if (method.hasModifier(SyntaxKind.PrivateKeyword)) continue;
        if (method.hasModifier(SyntaxKind.ProtectedKeyword)) continue;
        if (method.isStatic()) continue;
        if (ownMethodNames.has(method.getName())) continue;

        let httpDecorator: string | null = null;
        for (const dec of method.getDecorators()) {
          const name = getDecoratorName(dec);
          if (name && HTTP_DECORATORS.has(name)) {
            httpDecorator = name;
            break;
          }
        }

        results.push({
          name: method.getName(),
          httpDecorator,
          httpPath: null,
          params: extractParams(method),
          returnType: 'unknown',
          responseType: null,
          isAsync: method.isAsync(),
          isInherited: true,
          inheritedFrom: baseClassName,
          requiresAuth: controllerAuth || hasJwtGuard(method.getDecorators()),
        });
      }
    }
  } catch {
    // base class resolution is best-effort
  }

  return results;
}

/** Detects whether a controller class itself has a JWT-like @UseGuards. */
export function extractControllerAuth(cls: ClassDeclaration): boolean {
  try {
    return hasJwtGuard(cls.getDecorators());
  } catch {
    return false;
  }
}

/**
 * Extracts the path argument from @Controller('path').
 * Returns null if the decorator is absent or has no string argument.
 */
export function extractControllerPath(cls: ClassDeclaration): string | null {
  try {
    const dec = cls.getDecorator('Controller');
    if (!dec) return null;
    const args = dec.getArguments();
    if (args.length === 0) return '';
    const first = args[0];
    if (first.getKind() === SyntaxKind.StringLiteral) {
      return first.getText().replace(/^['"`]|['"`]$/g, '');
    }
    return null;
  } catch {
    return null;
  }
}
