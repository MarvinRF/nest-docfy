import type { ControllerInfo, MethodInfo, ResponseTypeInfo } from './extract-methods';
import type { ExtractedDocsConfig } from './extract-docs-config';
import { isUnresolved, EvaluatedValue } from './eval-decorator-args';

export type OpenApiSchema = Record<string, unknown>;

export interface MediaTypeContent {
  schema?: OpenApiSchema;
  example?: unknown;
  examples?: Record<string, unknown>;
}

export interface OperationPatch {
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema: OpenApiSchema }>;
  requestBody?: { required?: boolean; content: Record<string, MediaTypeContent> };
  responses?: Record<string, { description?: string; content?: Record<string, MediaTypeContent> }>;
}

/** path -> httpMethod (lowercase) -> patch */
export type SpecPatch = Record<string, Record<string, OperationPatch>>;

const HTTP_METHODS_OPENAPI = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/**
 * Converts NestJS's Express-style route param syntax (`:id`) to OpenAPI's
 * path templating syntax (`{id}`) — the format `@nestjs/swagger`'s generated
 * base document actually uses for `paths` keys. Without this, patch-spec/the
 * CLI plugin would compute a route key that never matches any parameterized
 * route in the real document (`/users/:id` vs `/users/{id}`), silently
 * dropping the patch for every such route rather than erroring loudly —
 * exactly the kind of failure `unmatchedRoutes` exists to surface, except
 * this bypassed it entirely by producing an internally-consistent but
 * wrong key on both sides of the CLI's own tests.
 */
function toOpenApiPathParams(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function joinPaths(controllerPath: string | null, methodPath: string | null): string {
  const a = (controllerPath ?? '').replace(/^\/+|\/+$/g, '');
  const b = (methodPath ?? '').replace(/^\/+|\/+$/g, '');
  const joined = [a, b].filter(Boolean).join('/');
  return toOpenApiPathParams(`/${joined}`);
}

function schemaFromResponseType(info: ResponseTypeInfo | null): OpenApiSchema | undefined {
  if (!info) return undefined;
  if (info.unionMembers) {
    const base: OpenApiSchema = { oneOf: info.unionMembers.map((m) => schemaFromResponseType(m)) };
    return info.isArray ? { type: 'array', items: base } : base;
  }
  const inline = info.classSchema ?? info.inlineSchema;
  const base: OpenApiSchema = inline
    ? {
        type: 'object',
        properties: inline.properties,
        ...(inline.required.length ? { required: inline.required } : {}),
      }
    : { $ref: `#/components/schemas/${info.name}` };
  return info.isArray ? { type: 'array', items: base } : base;
}

function findBodyResponseType(method: MethodInfo): ResponseTypeInfo | null {
  const bodyParam = method.params.find((p) => p.nestDecorator === '@Body' && p.bodyType);
  return bodyParam?.bodyType ?? null;
}

/**
 * True when `value` is itself Unresolved, or is an array/object containing an
 * Unresolved marker anywhere inside it. A shallow check isn't enough here —
 * `evaluateExpression` recurses into nested object/array literals, so a
 * single non-literal sub-value (a variable, a function call) buried inside
 * an otherwise-literal `schema`/`example` object still needs to bail the
 * whole value rather than leak the internal `{ __unresolved, text }` marker
 * shape into the emitted OpenAPI document as if it were real data.
 */
function containsUnresolved(value: EvaluatedValue): boolean {
  if (isUnresolved(value)) return true;
  if (Array.isArray(value)) return value.some(containsUnresolved);
  if (value !== null && typeof value === 'object') return Object.values(value).some(containsUnresolved);
  return false;
}

/** Resolves a schema for an ApiBody/ApiResponse `type`/`schema` argument value. */
function resolveSchemaArg(
  value: EvaluatedValue | undefined,
  fallback: ResponseTypeInfo | null,
): OpenApiSchema | undefined {
  if (value === undefined) return schemaFromResponseType(fallback);
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && !containsUnresolved(value)) {
    return value as OpenApiSchema;
  }
  return schemaFromResponseType(fallback);
}

/**
 * Resolves an ApiResponse/ApiBody `example`/`examples` option to a plain
 * literal value, or undefined if it's absent or contains any unresolved
 * (non-literal) part — same "don't guess" rule as `resolveSchemaArg`.
 */
function literalValue(value: EvaluatedValue | undefined): unknown {
  if (value === undefined || containsUnresolved(value)) return undefined;
  return value;
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
 * Extracts an ApiParam/ApiQuery/ApiHeader/ApiProperty `enum` option into an
 * OpenAPI-ready array of string/number values. Handles both shapes that
 * reach here as an already-evaluated array: a literal `enum: ['a', 'b']`
 * and `enum: Role` (a TS enum reference resolved by eval-decorator-args to
 * its member values). Anything else (unresolved, not an array, empty) is
 * left out of the schema rather than guessed at.
 */
function enumSchemaValues(value: EvaluatedValue | undefined): (string | number)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
  return values.length > 0 ? values : undefined;
}

/**
 * Computes the OpenAPI fragment a controller's `.docs.ts` file represents,
 * purely from statically-extracted data — no decorators are applied to any
 * class, no Reflect metadata is touched, nothing is required() at runtime.
 *
 * This intentionally does not aim for full parity with what `@nestjs/swagger`
 * decorators would produce when actually applied (that's a much larger
 * surface — links, callbacks, etc. that `@nestjs/swagger` itself doesn't
 * expose a decorator option for anyway). It covers the common path: tags,
 * operation summary/description, responses with a status + description +
 * schema (including a `oneOf` when the return type or `@Body()` payload is a
 * union of named DTOs) + example/examples, request bodies, bearer auth, and
 * enum-valued params/headers — enough to validate that statically-computed
 * patches can stand in for runtime decoration where the latter is
 * structurally impossible (see the README's "Not supported: webpack: true"
 * section).
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
          const example = literalValue(arg.example);
          const examples = literalValue(arg.examples);
          const mediaType: MediaTypeContent = {
            ...(schema ? { schema } : {}),
            ...(example !== undefined ? { example } : {}),
            ...(examples !== undefined ? { examples: examples as Record<string, unknown> } : {}),
          };

          op.responses ??= {};
          op.responses[statusKey] = {
            ...(typeof description === 'string' ? { description } : {}),
            ...(Object.keys(mediaType).length > 0 ? { content: { 'application/json': mediaType } } : {}),
          };
          break;
        }

        case 'ApiBody': {
          const arg = asRecord(call.args[0]);
          const fallback = findBodyResponseType(method);
          const schema = resolveSchemaArg(arg.schema ?? arg.type, fallback);
          // @nestjs/swagger's real ApiBodyOptions type only has `examples`
          // (a map), never a singular `example` — unlike ApiResponse, which
          // supports both. Reading `example` here would be dead code: no
          // type-checked docs file could ever legitimately pass it.
          const examples = literalValue(arg.examples);
          const mediaType: MediaTypeContent = {
            ...(schema ? { schema } : {}),
            ...(examples !== undefined ? { examples: examples as Record<string, unknown> } : {}),
          };
          if (Object.keys(mediaType).length > 0) {
            op.requestBody = {
              required: true,
              content: { 'application/json': mediaType },
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
          const enumValues = enumSchemaValues(arg.enum);
          const schemaType = enumValues?.every((v) => typeof v === 'number') ? 'number' : 'string';
          op.parameters = [
            ...(op.parameters ?? []),
            {
              name,
              in: paramIn,
              ...(typeof required === 'boolean' ? { required } : {}),
              schema: { type: schemaType, ...(enumValues ? { enum: enumValues } : {}) },
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
