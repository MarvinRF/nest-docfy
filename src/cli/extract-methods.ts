import { ClassDeclaration, MethodDeclaration, SyntaxKind, Type } from 'ts-morph';

export interface ParamInfo {
  name: string;
  type: string;
  nestDecorator: string | null; // '@Param', '@Body', '@Query', etc.
}

/**
 * A resolved DTO/entity type suitable for use in ApiResponse({ type: ... }).
 * Only set when the return type resolves to a named class or interface from
 * a source file — primitives, inline objects, and unresolvable types are null.
 */
export interface ResponseTypeInfo {
  /** Short identifier name, e.g. "RegisterResponseDto" */
  name: string;
  /** Absolute path to the file that declares the type */
  absolutePath: string;
  /** True when the original return type was an array, e.g. Promise<User[]> */
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
}

export interface ControllerInfo {
  className: string;
  filePath: string;
  controllerPath: string | null; // value of @Controller('path')
  methods: MethodInfo[];
  hasDocsFile: boolean; // will be set by the scanner
}

const HTTP_DECORATORS = new Set([
  'Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All',
]);

const NEST_PARAM_DECORATORS = new Set([
  'Param', 'Body', 'Query', 'Headers', 'Req', 'Res', 'Request',
  'Response', 'Session', 'UploadedFile', 'UploadedFiles', 'Ip', 'HostParam',
]);

/** Primitives and built-ins that should never appear as ApiResponse type. */
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

function extractParams(method: MethodDeclaration): ParamInfo[] {
  try {
    return method.getParameters().map((p) => {
      let nestDecorator: string | null = null;
      for (const dec of p.getDecorators()) {
        const name = getDecoratorName(dec);
        if (name && NEST_PARAM_DECORATORS.has(name)) {
          nestDecorator = `@${name}`;
          break;
        }
      }
      const typeNode = p.getTypeNode();
      return {
        name: p.getName(),
        type: typeNode ? typeNode.getText() : 'unknown',
        nestDecorator,
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

    // Check for array: T[] or Array<T>
    let isArray = false;
    let elementType = inner;
    if (inner.isArray()) {
      isArray = true;
      elementType = inner.getArrayElementTypeOrThrow();
    }

    // Skip primitives, void, inline objects, union/intersection types
    if (elementType.isString() || elementType.isNumber() || elementType.isBoolean()) return null;
    if (elementType.isUndefined() || elementType.isNull() || elementType.isVoid()) return null;
    if (elementType.isAnonymous()) return null; // inline { id: string } objects
    if (elementType.isUnion() || elementType.isIntersection()) return null;
    if (elementType.isTuple()) return null;

    const symbol = elementType.getSymbol() ?? elementType.getAliasSymbol();
    if (!symbol) return null;

    const name = symbol.getName();

    // Validate identifier — skip anything that isn't a clean class/interface name
    if (!name || !IDENTIFIER_RE.test(name)) return null;
    if (SKIP_TYPE_NAMES.has(name)) return null;

    // Resolve the source file where the type is declared
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) return null;

    const sourceFile = declarations[0].getSourceFile();
    const absolutePath = sourceFile.getFilePath();

    // Skip node_modules and .d.ts declaration files (no user source)
    if (absolutePath.includes('node_modules')) return null;
    if (absolutePath.endsWith('.d.ts')) return null;

    return { name, absolutePath, isArray };
  } catch {
    return null;
  }
}

/**
 * Extracts public, non-static methods from a controller class declaration.
 * Marks inherited methods (from base classes) but still includes them.
 * Private and protected methods are ignored.
 */
export function extractMethods(cls: ClassDeclaration): MethodInfo[] {
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
        : method.getReturnType().getText();
    } catch {
      // ts-morph can fail to infer complex types — keep 'unknown'
    }

    const responseType = resolveResponseType(method);

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
        if (ownMethodNames.has(method.getName())) continue; // overridden

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
        });
      }
    }
  } catch {
    // base class resolution is best-effort
  }

  return results;
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
