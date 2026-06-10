import { ClassDeclaration, InterfaceDeclaration, MethodDeclaration, ParameterDeclaration, SyntaxKind, Type } from 'ts-morph';

export interface ParamInfo {
  name: string;
  type: string;
  nestDecorator: string | null;    // '@Param', '@Body', '@Query', etc.
  nestDecoratorArg: string | null; // e.g. 'id' from @Param('id'), null when no arg
  bodyType: ResponseTypeInfo | null; // resolved DTO type for @Body() params
}

export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object';

export interface SchemaProperty {
  type?: JsonSchemaType;
  format?: string;
  nullable?: boolean;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  enum?: (string | number)[];
}

export interface InlineSchema {
  properties: Record<string, SchemaProperty>;
  required: string[];
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
  /**
   * True when the type is a TypeScript interface (not a class).
   * Interfaces are erased at runtime and cannot be used as Swagger `type:` values.
   * When true, `inlineSchema` holds the extracted property definitions.
   */
  isInterface: boolean;
  /** Extracted property schema when `isInterface` is true. Used to emit `schema:` instead of `type:`. */
  inlineSchema?: InlineSchema;
  /**
   * Schema inferred from class-validator decorators when the type is a class.
   * Only set when the class has class-validator decorators and no `@ApiProperty`.
   * Used to emit `schema:` instead of `type:` so docs are accurate even without @ApiProperty.
   */
  classSchema?: InlineSchema;
}

export interface MethodInfo {
  name: string;
  httpDecorator: string | null; // 'Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'
  httpPath: string | null;
  httpStatusCode: number | null; // explicit @HttpCode(n) override, null = use default
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

/** Extracts the numeric argument of @HttpCode(statusCode). Returns null if absent or invalid. */
function getHttpStatusCode(method: MethodDeclaration): number | null {
  try {
    const dec = method.getDecorator('HttpCode');
    if (!dec) return null;
    const args = dec.getArguments();
    if (args.length === 0) return null;
    const val = Number(args[0].getText());
    // Accept only valid HTTP status codes; reject anything else (injection, NaN, etc.)
    if (Number.isInteger(val) && val >= 100 && val <= 599) return val;
    return null;
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

// ---------------------------------------------------------------------------
// Inline schema extraction (for interface-typed DTOs)
// ---------------------------------------------------------------------------

function typeToSchemaProperty(type: Type, depth: number): SchemaProperty {
  if (depth > 6) return { type: 'object' };

  try {
    // Unwrap union: detect nullable and reduce to the non-null type
    let core = type;
    let isNullable = false;

    if (type.isUnion()) {
      const parts = type.getUnionTypes();
      isNullable = parts.some((t) => t.isNull() || t.isUndefined());
      const nonNull = parts.filter((t) => !t.isNull() && !t.isUndefined());
      if (nonNull.length === 1) {
        core = nonNull[0];
      } else if (nonNull.length === 0) {
        return { nullable: true };
      } else {
        // Complex multi-type union — omit type hint, keep nullable flag
        return isNullable ? { nullable: true } : {};
      }
    }

    const prop: SchemaProperty = {};
    if (isNullable) prop.nullable = true;

    if (core.isString() || core.isStringLiteral()) {
      prop.type = 'string';
    } else if (core.isBoolean() || core.isBooleanLiteral()) {
      prop.type = 'boolean';
    } else if (core.isNumber() || core.isNumberLiteral()) {
      // Distinguish integer from float via literal value
      if (core.isNumberLiteral()) {
        const text = core.getText();
        prop.type = Number.isInteger(Number(text)) ? 'integer' : 'number';
      } else {
        prop.type = 'number';
      }
    } else if (core.isArray()) {
      prop.type = 'array';
      try {
        const elem = core.getArrayElementTypeOrThrow();
        prop.items = typeToSchemaProperty(elem, depth + 1);
      } catch {
        prop.items = {};
      }
    } else {
      // Attempt to recurse into an interface or class with properties
      const sym = core.getSymbol();
      const decls = sym?.getDeclarations();
      if (decls && decls.length > 0) {
        const decl = decls[0];
        const srcPath = decl.getSourceFile().getFilePath();
        if (
          decl.getKind() === SyntaxKind.InterfaceDeclaration &&
          !srcPath.includes('node_modules') &&
          !srcPath.endsWith('.d.ts')
        ) {
          const nested = buildSchemaFromInterface(decl as InterfaceDeclaration, depth + 1);
          prop.type = 'object';
          if (Object.keys(nested.properties).length > 0) prop.properties = nested.properties;
          if (nested.required.length > 0) prop.required = nested.required;
        } else {
          prop.type = 'object';
        }
      } else {
        prop.type = 'object';
      }
    }

    return prop;
  } catch {
    return {};
  }
}

function buildSchemaFromInterface(iface: InterfaceDeclaration, depth: number): InlineSchema {
  const properties: Record<string, SchemaProperty> = {};
  const required: string[] = [];

  try {
    for (const prop of iface.getProperties()) {
      try {
        const name = prop.getName();
        const isOptional = prop.hasQuestionToken();
        properties[name] = typeToSchemaProperty(prop.getType(), depth);
        if (!isOptional) required.push(name);
      } catch {
        // skip unresolvable property
      }
    }
  } catch {
    // best-effort
  }

  return { properties, required };
}

// ---------------------------------------------------------------------------
// class-validator schema inference (for class-based DTOs)
// ---------------------------------------------------------------------------

/**
 * Whitelisted class-validator decorators and their JSON Schema mappings.
 * Only these names are processed — unknown decorators are ignored.
 * This prevents any user-defined or third-party decorator from being
 * misinterpreted as a type hint.
 */
const CV_TYPE_MAP: Record<string, { type: JsonSchemaType; format?: string }> = {
  IsString:     { type: 'string' },
  IsEmail:      { type: 'string', format: 'email' },
  IsUrl:        { type: 'string', format: 'uri' },
  IsUUID:       { type: 'string', format: 'uuid' },
  IsDateString: { type: 'string', format: 'date-time' },
  IsNumber:     { type: 'number' },
  IsInt:        { type: 'integer' },
  IsPositive:   { type: 'number' },
  IsNegative:   { type: 'number' },
  IsBoolean:    { type: 'boolean' },
  IsArray:      { type: 'array' },
  IsObject:     { type: 'object' },
};

/** class-validator decorators that accept a single numeric argument (min/max/length). */
const CV_NUMERIC_ARG_MAP: Record<string, keyof SchemaProperty> = {
  Min:       'minimum',
  Max:       'maximum',
  MinLength: 'minLength',
  MaxLength: 'maxLength',
};

/** Returns true if the class has ANY @ApiProperty decorator on its properties. */
function classHasApiProperty(cls: ClassDeclaration): boolean {
  try {
    for (const prop of cls.getProperties()) {
      for (const dec of prop.getDecorators()) {
        try {
          if (dec.getName() === 'ApiProperty') return true;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return false;
}

/** Safely reads the first numeric literal argument of a decorator. */
function getDecoratorNumericArg(dec: ReturnType<ClassDeclaration['getDecorators']>[number]): number | null {
  try {
    const args = dec.getArguments();
    if (args.length === 0) return null;
    const val = Number(args[0].getText());
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

/**
 * Builds an InlineSchema from a class's class-validator decorators.
 * Returns null when:
 *  - the class has @ApiProperty (Swagger will handle it — preserve type:)
 *  - no class-validator decorators found on any property
 */
function buildSchemaFromClass(cls: ClassDeclaration): InlineSchema | null {
  try {
    if (classHasApiProperty(cls)) return null;

    const properties: Record<string, SchemaProperty> = {};
    const required: string[] = [];
    let foundAny = false;

    for (const prop of cls.getProperties()) {
      try {
        const propName = prop.getName();
        if (!IDENTIFIER_RE.test(propName)) continue;

        const decorators = prop.getDecorators();
        const decoratorNames = new Set(
          decorators.map((d) => { try { return d.getName(); } catch { return ''; } }),
        );

        // Collect type info from whitelisted decorators
        const schema: SchemaProperty = {};
        let hasCV = false;

        for (const dec of decorators) {
          let decName: string;
          try { decName = dec.getName(); } catch { continue; }

          if (decName === 'IsOptional') {
            // Mark as optional — won't be pushed to required[]
            continue;
          }

          if (CV_TYPE_MAP[decName]) {
            const mapping = CV_TYPE_MAP[decName];
            schema.type = mapping.type;
            if (mapping.format) schema.format = mapping.format;
            hasCV = true;
          }

          if (CV_NUMERIC_ARG_MAP[decName]) {
            const val = getDecoratorNumericArg(dec);
            if (val !== null) {
              (schema as Record<string, unknown>)[CV_NUMERIC_ARG_MAP[decName]] = val;
              hasCV = true;
            }
          }
        }

        if (!hasCV) continue; // skip properties with no recognized CV decorators

        // Nullable: property type contains | null or | undefined, or has @IsOptional
        const propType = prop.getType();
        if (propType.isUnion()) {
          const hasNull = propType.getUnionTypes().some((t) => t.isNull() || t.isUndefined());
          if (hasNull) schema.nullable = true;
        }

        const isOptional = prop.hasQuestionToken() || decoratorNames.has('IsOptional');

        properties[propName] = schema;
        foundAny = true;
        if (!isOptional) required.push(propName);
      } catch { /* skip unresolvable property */ }
    }

    if (!foundAny) return null;
    return { properties, required };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

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

    const isInterface = declarations[0].getKind() === SyntaxKind.InterfaceDeclaration;

    const inlineSchema = isInterface
      ? buildSchemaFromInterface(declarations[0] as InterfaceDeclaration, 0)
      : undefined;

    const classSchema = !isInterface && declarations[0].getKind() === SyntaxKind.ClassDeclaration
      ? buildSchemaFromClass(declarations[0] as ClassDeclaration) ?? undefined
      : undefined;

    return { name, absolutePath, isArray, isInterface, inlineSchema, classSchema };
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
    const httpStatusCode = getHttpStatusCode(method);

    results.push({
      name: method.getName(),
      httpDecorator,
      httpPath,
      httpStatusCode,
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
          httpStatusCode: getHttpStatusCode(method),
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
