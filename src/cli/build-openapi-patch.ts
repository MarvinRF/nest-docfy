import type { ControllerInfo, MethodInfo, ResponseTypeInfo } from './extract-methods';
import type { ExtractedDocsConfig } from './extract-docs-config';
import { isUnresolved, EvaluatedValue } from './eval-decorator-args';

export type OpenApiSchema = Record<string, unknown>;

export interface OperationPatch {
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema: OpenApiSchema }>;
  requestBody?: { required?: boolean; content: Record<string, { schema: OpenApiSchema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema: OpenApiSchema }> }>;
}

/** path -> httpMethod (lowercase) -> patch */
export type SpecPatch = Record<string, Record<string, OperationPatch>>;

const HTTP_METHODS_OPENAPI = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function joinPaths(controllerPath: string | null, methodPath: string | null): string {
  const a = (controllerPath ?? '').replace(/^\/+|\/+$/g, '');
  const b = (methodPath ?? '').replace(/^\/+|\/+$/g, '');
  const joined = [a, b].filter(Boolean).join('/');
  return `/${joined}`;
}

function schemaFromResponseType(info: ResponseTypeInfo | null): OpenApiSchema | undefined {
  if (!info) return undefined;
  const inline = info.classSchema ?? info.inlineSchema;
  const base: OpenApiSchema = inline
    ? { type: 'object', properties: inline.properties, ...(inline.required.length ? { required: inline.required } : {}) }
    : { $ref: `#/components/schemas/${info.name}` };
  return info.isArray ? { type: 'array', items: base } : base;
}

function findBodyResponseType(method: MethodInfo): ResponseTypeInfo | null {
  const bodyParam = method.params.find((p) => p.nestDecorator === '@Body' && p.bodyType);
  return bodyParam?.bodyType ?? null;
}

/** Resolves a schema for an ApiBody/ApiResponse `type`/`schema` argument value. */
function resolveSchemaArg(
  value: EvaluatedValue | undefined,
  fallback: ResponseTypeInfo | null,
): OpenApiSchema | undefined {
  if (value === undefined) return schemaFromResponseType(fallback);
  if (isUnresolved(value)) return schemaFromResponseType(fallback);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as OpenApiSchema;
  }
  return schemaFromResponseType(fallback);
}

function asRecord(value: EvaluatedValue | undefined): Record<string, EvaluatedValue> {
  if (value && typeof value === 'object' && !Array.isArray(value) && !isUnresolved(value)) {
    return value as Record<string, EvaluatedValue>;
  }
  return {};
}

function plain(value: EvaluatedValue | undefined): string | number | boolean | undefined {
  if (value === undefined || isUnresolved(value) || value === null || typeof value === 'object') return undefined;
  return value;
}

/**
 * Computes the OpenAPI fragment a controller's `.docs.ts` file represents,
 * purely from statically-extracted data — no decorators are applied to any
 * class, no Reflect metadata is touched, nothing is required() at runtime.
 *
 * This intentionally does not aim for full parity with what `@nestjs/swagger`
 * decorators would produce when actually applied (that's a much larger
 * surface — enums, oneOf/anyOf, examples, links, callbacks, etc.). It covers
 * the common path: tags, operation summary/description, responses with a
 * status + description + schema, request bodies, and bearer auth — enough
 * to validate that statically-computed patches can stand in for runtime
 * decoration where the latter is structurally impossible (see the README's
 * "Not supported: webpack: true" section).
 */
export function buildOpenApiPatch(ctrl: ControllerInfo, config: ExtractedDocsConfig): SpecPatch {
  const patch: SpecPatch = {};

  const classTags = config.classDecorators
    .filter((d) => d.name === 'ApiTags')
    .flatMap((d) => d.args.filter((a): a is string => typeof a === 'string'));

  for (const method of ctrl.methods) {
    if (!method.httpDecorator) continue;
    const httpMethod = method.httpDecorator.toLowerCase();
    if (!HTTP_METHODS_OPENAPI.has(httpMethod)) continue;

    const route = joinPaths(ctrl.controllerPath, method.httpPath);
    const calls = config.methods[method.name] ?? [];
    const op: OperationPatch = {};

    if (classTags.length > 0) op.tags = classTags;

    for (const call of calls) {
      switch (call.name) {
        case 'ApiOperation': {
          const arg = asRecord(call.args[0]);
          const summary = plain(arg.summary);
          const description = plain(arg.description);
          const deprecated = plain(arg.deprecated);
          if (typeof summary === 'string') op.summary = summary;
          if (typeof description === 'string') op.description = description;
          if (typeof deprecated === 'boolean') op.deprecated = deprecated;
          break;
        }

        case 'ApiResponse': {
          const arg = asRecord(call.args[0]);
          const status = plain(arg.status);
          const statusKey = typeof status === 'number' ? String(status) : 'default';
          const description = plain(arg.description);
          const schema = resolveSchemaArg(arg.schema ?? arg.type, method.responseType);

          op.responses ??= {};
          op.responses[statusKey] = {
            ...(typeof description === 'string' ? { description } : {}),
            ...(schema ? { content: { 'application/json': { schema } } } : {}),
          };
          break;
        }

        case 'ApiBody': {
          const arg = asRecord(call.args[0]);
          const fallback = findBodyResponseType(method);
          const schema = resolveSchemaArg(arg.schema ?? arg.type, fallback);
          if (schema) {
            op.requestBody = {
              required: true,
              content: { 'application/json': { schema } },
            };
          }
          break;
        }

        case 'ApiBearerAuth': {
          op.security = [...(op.security ?? []), { bearer: [] }];
          break;
        }

        case 'ApiParam':
        case 'ApiQuery':
        case 'ApiHeader': {
          const arg = asRecord(call.args[0]);
          const name = plain(arg.name);
          if (typeof name !== 'string') break;
          const paramIn = call.name === 'ApiParam' ? 'path' : call.name === 'ApiQuery' ? 'query' : 'header';
          const required = plain(arg.required);
          op.parameters = [
            ...(op.parameters ?? []),
            {
              name,
              in: paramIn,
              ...(typeof required === 'boolean' ? { required } : {}),
              schema: { type: 'string' },
            },
          ];
          break;
        }

        default:
          // Unrecognized decorator (custom, or not yet handled) — ignored, not an error.
          break;
      }
    }

    patch[route] ??= {};
    patch[route][httpMethod] = op;
  }

  return patch;
}
