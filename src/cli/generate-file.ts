import path from 'path';
import type { ControllerInfo, InlineSchema, MethodInfo, ParamInfo, ResponseTypeInfo, SchemaProperty } from './extract-methods';

// ---------------------------------------------------------------------------
// Sanitisation helpers
// ---------------------------------------------------------------------------

const IDENTIFIER_RE = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;

function sanitizeIdentifier(value: string, fallback: string): string {
  return IDENTIFIER_RE.test(value) ? value : fallback;
}

function sanitizeComment(value: string): string {
  return value.replace(/[`'"\\*]/g, '').slice(0, 200);
}

function sanitizeHttpPath(value: string | null): string {
  if (!value) return '';
  return '/' + value.replace(/[^a-zA-Z0-9/_:.-]/g, '');
}

function sanitizeParamName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
}

// ---------------------------------------------------------------------------
// HTTP verb → default success status code
// ---------------------------------------------------------------------------

function defaultStatusCode(httpDecorator: string | null, httpStatusCode: number | null): number {
  if (httpStatusCode !== null) return httpStatusCode;
  switch (httpDecorator) {
    case 'Post':   return 201;
    case 'Delete': return 204;
    default:       return 200;
  }
}

// ---------------------------------------------------------------------------
// Import path resolution
// ---------------------------------------------------------------------------

export function relativeImport(docsFilePath: string, controllerFilePath: string): string {
  const rel = path.relative(path.dirname(docsFilePath), controllerFilePath);
  const withoutExt = rel.replace(/\.ts$/, '');
  return withoutExt.startsWith('.') ? withoutExt : `./${withoutExt}`;
}

function resolvedImportPath(docsFilePath: string, absolutePath: string): string {
  const rel = path.relative(path.dirname(docsFilePath), absolutePath);
  const importPath = rel.replace(/\.ts$/, '').replace(/\\/g, '/');
  return importPath.startsWith('.') ? importPath : `./${importPath}`;
}

// ---------------------------------------------------------------------------
// Primitive TypeScript type → JavaScript constructor name
// ---------------------------------------------------------------------------

const PRIMITIVE_MAP: Record<string, string> = {
  string: 'String',
  number: 'Number',
  boolean: 'Boolean',
};

/**
 * Maps a TS primitive type string to its JS constructor for Swagger.
 * Returns null for non-primitives (DTOs, unknown, etc.).
 */
function primitiveToConstructor(tsType: string): string | null {
  const base = tsType.replace(/\[\]$/, '').trim();
  return PRIMITIVE_MAP[base] ?? null;
}

// ---------------------------------------------------------------------------
// Unique import collector (response types + body types)
// ---------------------------------------------------------------------------

interface ResolvedImport {
  name: string;
  importPath: string;
}

function collectDtoImports(
  methods: MethodInfo[],
  docsFilePath: string,
): ResolvedImport[] {
  const seen = new Map<string, string>(); // name → importPath

  const register = (rt: ResponseTypeInfo | null) => {
    if (!rt) return;
    if (!IDENTIFIER_RE.test(rt.name)) return;
    if (rt.isInterface) return;   // interfaces have no runtime value — don't import
    if (rt.classSchema) return;   // using inline schema — type: not referenced, no import needed
    if (seen.has(rt.name)) return;
    seen.set(rt.name, resolvedImportPath(docsFilePath, rt.absolutePath));
  };

  for (const m of methods) {
    register(m.responseType);
    for (const p of m.params) {
      register(p.bodyType ?? null);
    }
  }

  return Array.from(seen.entries()).map(([name, importPath]) => ({ name, importPath }));
}

// ---------------------------------------------------------------------------
// Swagger decorator set collector (for dynamic imports)
// ---------------------------------------------------------------------------

type SwaggerDecorator = 'ApiTags' | 'ApiOperation' | 'ApiResponse' | 'ApiParam' | 'ApiBody' | 'ApiQuery' | 'ApiBearerAuth';

function collectSwaggerDecorators(ctrl: ControllerInfo): Set<SwaggerDecorator> {
  const used = new Set<SwaggerDecorator>(['ApiTags', 'ApiOperation', 'ApiResponse']);
  for (const m of ctrl.methods) {
    if (m.requiresAuth) used.add('ApiBearerAuth');
    for (const p of m.params) {
      if (p.nestDecorator === '@Param' && p.nestDecoratorArg !== null) used.add('ApiParam');
      if (p.nestDecorator === '@Query' && p.nestDecoratorArg !== null) used.add('ApiQuery');
      if (p.nestDecorator === '@Body' && p.nestDecoratorArg === null)  used.add('ApiBody');
    }
  }
  if (ctrl.controllerRequiresAuth) used.add('ApiBearerAuth');
  return used;
}

// ---------------------------------------------------------------------------
// Method signature comment
// ---------------------------------------------------------------------------

function methodSignatureComment(m: MethodInfo): string {
  const verb = m.httpDecorator ? `${m.httpDecorator.toUpperCase()} ` : '';
  const httpPath = m.httpPath !== null ? sanitizeHttpPath(m.httpPath) : '';
  const route = verb || httpPath ? `${verb}${httpPath} → ` : '';
  const paramList = m.params
    .map((p) => `${sanitizeIdentifier(p.name, '_')}: ${sanitizeComment(p.type)}`)
    .join(', ');
  const returnType = sanitizeComment(m.returnType);
  const asyncPrefix = m.isAsync ? 'async ' : '';
  const methodName = sanitizeIdentifier(m.name, '_');
  const inherited = m.isInherited && m.inheritedFrom
    ? ` [inherited from ${sanitizeComment(m.inheritedFrom)}]`
    : '';
  return `${route}${asyncPrefix}${methodName}(${paramList}): ${returnType}${inherited}`;
}

// ---------------------------------------------------------------------------
// Per-param decorator renderers
// ---------------------------------------------------------------------------

function renderApiParam(p: ParamInfo, indent: string): string | null {
  if (p.nestDecorator !== '@Param' || p.nestDecoratorArg === null) return null;
  const name = sanitizeParamName(p.nestDecoratorArg);
  if (!name) return null;
  const constructor = primitiveToConstructor(p.type) ?? 'String';
  return `${indent}ApiParam({ name: '${name}', type: ${constructor} }),`;
}

function renderApiQuery(p: ParamInfo, indent: string): string | null {
  if (p.nestDecorator !== '@Query' || p.nestDecoratorArg === null) return null;
  const name = sanitizeParamName(p.nestDecoratorArg);
  if (!name) return null;
  const constructor = primitiveToConstructor(p.type) ?? 'String';
  const required = !p.type.includes('?') && !p.type.includes('undefined');
  return `${indent}ApiQuery({ name: '${name}', type: ${constructor}, required: ${required} }),`;
}

function renderApiBody(p: ParamInfo, indent: string): string | null {
  if (p.nestDecorator !== '@Body' || p.nestDecoratorArg !== null) return null;

  if (p.bodyType && IDENTIFIER_RE.test(p.bodyType.name)) {
    if (p.bodyType.isInterface && p.bodyType.inlineSchema) {
      const schemaStr = renderSchemaArg(p.bodyType.inlineSchema, false, indent);
      return `${indent}ApiBody({ schema: ${schemaStr} }),`;
    }
    if (p.bodyType.isInterface) {
      return `${indent}ApiBody({}),`;
    }
    if (p.bodyType.classSchema) {
      const schemaStr = renderSchemaArg(p.bodyType.classSchema, false, indent);
      return `${indent}ApiBody({ schema: ${schemaStr} }),`;
    }
    return `${indent}ApiBody({ type: ${p.bodyType.name} }),`;
  }

  const constructor = primitiveToConstructor(p.type);
  if (constructor) {
    return `${indent}ApiBody({ type: ${constructor} }),`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Inline schema rendering (for interface-typed DTOs)
// ---------------------------------------------------------------------------

function renderSchemaProperty(prop: SchemaProperty, indent: string): string {
  const inner = `${indent}  `;
  const pairs: string[] = [];

  if (prop.type !== undefined)   pairs.push(`${inner}type: '${prop.type}'`);
  if (prop.format !== undefined) pairs.push(`${inner}format: '${prop.format}'`);
  if (prop.nullable)             pairs.push(`${inner}nullable: true`);
  if (prop.minimum !== undefined) pairs.push(`${inner}minimum: ${prop.minimum}`);
  if (prop.maximum !== undefined) pairs.push(`${inner}maximum: ${prop.maximum}`);
  if (prop.minLength !== undefined) pairs.push(`${inner}minLength: ${prop.minLength}`);
  if (prop.maxLength !== undefined) pairs.push(`${inner}maxLength: ${prop.maxLength}`);
  if (prop.enum && prop.enum.length > 0) {
    const vals = prop.enum.map((v) => typeof v === 'string' ? `'${v}'` : String(v)).join(', ');
    pairs.push(`${inner}enum: [${vals}]`);
  }
  if (prop.oneOf && prop.oneOf.length > 0) {
    const entries = prop.oneOf
      .map((p) => `${inner}  ${renderSchemaProperty(p, `${inner}  `)}`)
      .join(',\n');
    pairs.push(`${inner}oneOf: [\n${entries},\n${inner}]`);
  }
  if (prop.items !== undefined) {
    pairs.push(`${inner}items: ${renderSchemaProperty(prop.items, inner)}`);
  }
  if (prop.properties !== undefined) {
    const propLines = Object.entries(prop.properties)
      .map(([k, v]) => `${inner}  ${k}: ${renderSchemaProperty(v, `${inner}  `)}`)
      .join(',\n');
    pairs.push(`${inner}properties: {\n${propLines},\n${inner}}`);
  }
  if (prop.required && prop.required.length > 0) {
    pairs.push(`${inner}required: [${prop.required.map((r) => `'${r}'`).join(', ')}]`);
  }

  if (pairs.length === 0) return '{}';
  return `{\n${pairs.join(',\n')},\n${indent}}`;
}

function renderSchemaArg(schema: InlineSchema, isArray: boolean, indent: string): string {
  const inner = `${indent}  `;
  const objectProp: SchemaProperty = {
    type: 'object',
    ...(Object.keys(schema.properties).length > 0 ? { properties: schema.properties } : {}),
    ...(schema.required.length > 0 ? { required: schema.required } : {}),
  };

  if (isArray) {
    return renderSchemaProperty({ type: 'array', items: objectProp }, inner);
  }
  return renderSchemaProperty(objectProp, inner);
}

// ---------------------------------------------------------------------------
// ApiResponse rendering
// ---------------------------------------------------------------------------

const HTTP_DESCRIPTIONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
};

function statusDescription(status: number): string {
  return HTTP_DESCRIPTIONS[status] ?? String(status);
}

function renderApiResponse(status: number, responseType: ResponseTypeInfo | null, baseIndent: string): string {
  const description = statusDescription(status);

  if (!responseType || !IDENTIFIER_RE.test(responseType.name)) {
    return `ApiResponse({ status: ${status}, description: '${description}' })`;
  }
  if (responseType.isInterface && responseType.inlineSchema) {
    const schemaStr = renderSchemaArg(responseType.inlineSchema, responseType.isArray, baseIndent);
    return [
      `ApiResponse({`,
      `${baseIndent}  status: ${status},`,
      `${baseIndent}  description: '${description}',`,
      `${baseIndent}  schema: ${schemaStr},`,
      `${baseIndent}})`,
    ].join('\n');
  }
  if (responseType.isInterface) {
    return `ApiResponse({ status: ${status}, description: '${description}' })`;
  }
  // Class with class-validator decorators and no @ApiProperty — emit inline schema
  if (responseType.classSchema) {
    const schemaStr = renderSchemaArg(responseType.classSchema, responseType.isArray, baseIndent);
    return [
      `ApiResponse({`,
      `${baseIndent}  status: ${status},`,
      `${baseIndent}  description: '${description}',`,
      `${baseIndent}  schema: ${schemaStr},`,
      `${baseIndent}})`,
    ].join('\n');
  }
  const typePart = responseType.isArray
    ? `[${responseType.name}]`
    : responseType.name;
  return `ApiResponse({ status: ${status}, description: '${description}', type: ${typePart} })`;
}

// ---------------------------------------------------------------------------
// Summary inference
// ---------------------------------------------------------------------------

/**
 * Converts a camelCase method name into a human-readable Swagger summary.
 * findAll → "Find all", createUser → "Create user", getProfileById → "Get profile by id"
 */
export function inferSummary(methodName: string): string {
  const words = methodName
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPMethod → HTTP Method
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')      // camelCase → camel Case
    .split(' ')
    .filter(Boolean);

  if (words.length === 0) return '';

  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Method block
// ---------------------------------------------------------------------------

function renderMethod(m: MethodInfo, indent: string): string {
  const name = sanitizeIdentifier(m.name, '_method');
  const sig = methodSignatureComment(m);
  const status = defaultStatusCode(m.httpDecorator, m.httpStatusCode);
  const summary = inferSummary(name); // use sanitized name, not raw m.name
  const inner = `${indent}  `;

  const lines: string[] = [
    `${indent}// ${sig}`,
    `${indent}${name}: [`,
    `${inner}ApiOperation({ summary: '${summary}' }),`,
  ];

  if (m.requiresAuth) lines.push(`${inner}ApiBearerAuth(),`);

  for (const p of m.params) {
    const paramLine = renderApiParam(p, inner)
      ?? renderApiQuery(p, inner)
      ?? renderApiBody(p, inner);
    if (paramLine) lines.push(paramLine);
  }

  lines.push(`${inner}${renderApiResponse(status, m.responseType, inner)},`);

  const hasBodyParam = m.params.some(
    (p) => p.nestDecorator === '@Body' && p.nestDecoratorArg === null,
  );
  if (hasBodyParam) {
    lines.push(`${inner}ApiResponse({ status: 400, description: '${statusDescription(400)}' }),`);
  }
  if (m.requiresAuth) {
    lines.push(`${inner}ApiResponse({ status: 401, description: '${statusDescription(401)}' }),`);
  }

  lines.push(`${indent}],`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// ApiTags value
// ---------------------------------------------------------------------------

function apiTagValue(ctrl: ControllerInfo): string {
  if (ctrl.controllerPath) return sanitizeComment(ctrl.controllerPath);
  return sanitizeComment(
    ctrl.className.replace(/Controller$/, '').toLowerCase(),
  );
}

// ---------------------------------------------------------------------------
// Full file renderer
// ---------------------------------------------------------------------------

export function renderDocsFile(
  ctrl: ControllerInfo,
  docsFilePath: string,
  format: 'ts' | 'js',
): string {
  const importPath = relativeImport(docsFilePath, ctrl.filePath);
  const className = sanitizeIdentifier(ctrl.className, 'Controller');
  const tag = apiTagValue(ctrl);

  const dtoImports = collectDtoImports(ctrl.methods, docsFilePath);
  const swaggerDecorators = collectSwaggerDecorators(ctrl);
  const swaggerImportList = [
    'ApiTags', 'ApiOperation', 'ApiResponse',
    ...(swaggerDecorators.has('ApiBearerAuth') ? ['ApiBearerAuth'] : []),
    ...(swaggerDecorators.has('ApiParam') ? ['ApiParam'] : []),
    ...(swaggerDecorators.has('ApiQuery') ? ['ApiQuery'] : []),
    ...(swaggerDecorators.has('ApiBody') ? ['ApiBody'] : []),
  ].join(', ');

  const classDecoratorLines = [
    `    ApiTags('${tag}'),`,
    ...(ctrl.controllerRequiresAuth ? [`    ApiBearerAuth(),`] : []),
  ].join('\n');

  const methodsBlock = ctrl.methods.length === 0
    ? '  // No public HTTP methods found.'
    : ctrl.methods.map((m) => renderMethod(m, '  ')).join('\n\n');

  if (format === 'js') {
    const requireLines = dtoImports
      .map((i) => `const { ${i.name} } = require('${i.importPath}');`)
      .join('\n');

    return [
      `// Generated by nestjs-docfy — edit freely, use --force to merge new methods`,
      ``,
      `const { docs } = require('nestjs-docfy');`,
      `const { ${swaggerImportList} } = require('@nestjs/swagger');`,
      `const { ${className} } = require('${importPath}');`,
      ...(requireLines ? [requireLines] : []),
      ``,
      `docs(${className}, {`,
      `  classDecorators: [`,
      classDecoratorLines,
      `  ],`,
      `  methods: {`,
      methodsBlock.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n'),
      `  },`,
      `});`,
      ``,
    ].join('\n');
  }

  const importLines = dtoImports
    .map((i) => `import { ${i.name} } from '${i.importPath}';`)
    .join('\n');

  return [
    `// Generated by nestjs-docfy — edit freely, use --force to merge new methods`,
    `import { docs } from 'nestjs-docfy';`,
    `import { ${swaggerImportList} } from '@nestjs/swagger';`,
    `import { ${className} } from '${importPath}';`,
    ...(importLines ? [importLines] : []),
    ``,
    `docs(${className}, {`,
    `  classDecorators: [`,
    classDecoratorLines,
    `  ],`,
    `  methods: {`,
    methodsBlock,
    `  },`,
    `});`,
    ``,
  ].join('\n');
}
