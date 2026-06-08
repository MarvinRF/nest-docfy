import path from 'path';
import type { ControllerInfo, MethodInfo, ResponseTypeInfo } from './extract-methods';

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

// ---------------------------------------------------------------------------
// HTTP verb → default success status code
// ---------------------------------------------------------------------------

function defaultStatusCode(httpDecorator: string | null): number {
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

// ---------------------------------------------------------------------------
// Response type imports collector
// ---------------------------------------------------------------------------

interface ResolvedImport {
  name: string;
  importPath: string;
}

/**
 * Collects all unique response type imports needed for a controller's methods.
 * Deduplicates by type name — if two methods return the same type, one import.
 * Validates each type name with IDENTIFIER_RE before including.
 */
function collectResponseImports(
  methods: MethodInfo[],
  docsFilePath: string,
): ResolvedImport[] {
  const seen = new Map<string, string>(); // name → importPath

  for (const m of methods) {
    const rt = m.responseType;
    if (!rt) continue;
    if (!IDENTIFIER_RE.test(rt.name)) continue; // safety: skip invalid identifiers
    if (seen.has(rt.name)) continue;

    const rel = path.relative(path.dirname(docsFilePath), rt.absolutePath);
    const importPath = rel.replace(/\.ts$/, '').replace(/\\/g, '/');
    const normalized = importPath.startsWith('.') ? importPath : `./${importPath}`;

    seen.set(rt.name, normalized);
  }

  return Array.from(seen.entries()).map(([name, importPath]) => ({ name, importPath }));
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
// ApiResponse rendering
// ---------------------------------------------------------------------------

function renderApiResponse(status: number, responseType: ResponseTypeInfo | null): string {
  if (!responseType || !IDENTIFIER_RE.test(responseType.name)) {
    return `ApiResponse({ status: ${status} })`;
  }
  const typePart = responseType.isArray
    ? `[${responseType.name}]`
    : responseType.name;
  return `ApiResponse({ status: ${status}, type: ${typePart} })`;
}

// ---------------------------------------------------------------------------
// Method block
// ---------------------------------------------------------------------------

function renderMethod(m: MethodInfo, indent: string): string {
  const name = sanitizeIdentifier(m.name, '_method');
  const sig = methodSignatureComment(m);
  const status = defaultStatusCode(m.httpDecorator);
  const apiResponse = renderApiResponse(status, m.responseType);
  return [
    `${indent}// ${sig}`,
    `${indent}${name}: [`,
    `${indent}  ApiOperation({ summary: '' }),`,
    `${indent}  ${apiResponse},`,
    `${indent}],`,
  ].join('\n');
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
  const controllerRoute = ctrl.controllerPath !== null
    ? ` (route: "${sanitizeHttpPath(ctrl.controllerPath)}")`
    : '';
  const timestamp = new Date().toISOString();
  const tag = apiTagValue(ctrl);

  const responseImports = collectResponseImports(ctrl.methods, docsFilePath);

  const methodsBlock = ctrl.methods.length === 0
    ? '  // No public HTTP methods found.'
    : ctrl.methods.map((m) => renderMethod(m, '  ')).join('\n\n');

  if (format === 'js') {
    const requireLines = responseImports
      .map((i) => `const { ${i.name} } = require('${i.importPath}');`)
      .join('\n');

    return [
      `// Auto-generated by nestjs-docfy`,
      `// Generated: ${timestamp}`,
      ``,
      `const { docs } = require('nestjs-docfy');`,
      `const { ApiTags, ApiOperation, ApiResponse } = require('@nestjs/swagger');`,
      `const { ${className} } = require('${importPath}');`,
      ...(requireLines ? [requireLines] : []),
      ``,
      `docs(${className}, {`,
      `  classDecorators: [`,
      `    ApiTags('${tag}'),`,
      `  ],`,
      `  methods: {`,
      methodsBlock.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n'),
      `  },`,
      `});`,
      ``,
    ].join('\n');
  }

  const importLines = responseImports
    .map((i) => `import { ${i.name} } from '${i.importPath}';`)
    .join('\n');

  return [
    `/**`,
    ` * Auto-generated by nestjs-docfy`,
    ` * Controller: ${className}${controllerRoute}`,
    ` * Generated: ${timestamp}`,
    ` */`,
    `import { docs } from 'nestjs-docfy';`,
    `import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';`,
    `import { ${className} } from '${importPath}';`,
    ...(importLines ? [importLines] : []),
    ``,
    `docs(${className}, {`,
    `  classDecorators: [`,
    `    ApiTags('${tag}'),`,
    `  ],`,
    `  methods: {`,
    methodsBlock,
    `  },`,
    `});`,
    ``,
  ].join('\n');
}
