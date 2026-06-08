import { ClassDeclaration, MethodDeclaration, SyntaxKind } from 'ts-morph';

export interface ParamInfo {
  name: string;
  type: string;
  nestDecorator: string | null; // '@Param', '@Body', '@Query', etc.
}

export interface MethodInfo {
  name: string;
  httpDecorator: string | null; // 'Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'
  httpPath: string | null;
  params: ParamInfo[];
  returnType: string;
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

    results.push({
      name: method.getName(),
      httpDecorator,
      httpPath,
      params: extractParams(method),
      returnType,
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
