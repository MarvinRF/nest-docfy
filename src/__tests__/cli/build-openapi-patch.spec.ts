import { buildOpenApiPatch } from '../../cli/build-openapi-patch';
import type { ControllerInfo, MethodInfo } from '../../cli/extract-methods';
import type { ExtractedDocsConfig } from '../../cli/extract-docs-config';

function makeMethod(overrides: Partial<MethodInfo> = {}): MethodInfo {
  return {
    name: 'findAll',
    httpDecorator: 'Get',
    httpPath: '',
    httpStatusCode: null,
    params: [],
    returnType: 'unknown',
    responseType: null,
    isAsync: true,
    isInherited: false,
    inheritedFrom: null,
    requiresAuth: false,
    ...overrides,
  };
}

function makeCtrl(overrides: Partial<ControllerInfo> = {}): ControllerInfo {
  return {
    className: 'UsersController',
    filePath: '/project/src/users/users.controller.ts',
    controllerPath: 'users',
    hasDocsFile: true,
    controllerRequiresAuth: false,
    methods: [makeMethod()],
    ...overrides,
  };
}

describe('buildOpenApiPatch()', () => {
  it('computes the route by joining controllerPath and httpPath', () => {
    const ctrl = makeCtrl({ methods: [makeMethod({ httpPath: 'active' })] });
    const config: ExtractedDocsConfig = { classDecorators: [], methods: {} };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(Object.keys(patch)).toEqual(['/users/active']);
  });

  it('converts Express-style route params (:id) to OpenAPI path templating ({id})', () => {
    // @nestjs/swagger's generated base document keys its `paths` by the
    // OpenAPI convention ({id}), not NestJS's own Express-style route syntax
    // (:id) — a patch keyed the wrong way would never match any
    // parameterized route in a real document (see mergeSpecPatch tests for
    // the end-to-end regression this guards against).
    const ctrl = makeCtrl({ methods: [makeMethod({ httpPath: ':id/:action' })] });
    const config: ExtractedDocsConfig = { classDecorators: [], methods: {} };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(Object.keys(patch)).toEqual(['/users/{id}/{action}']);
  });

  it('lowercases the HTTP method as the OpenAPI key', () => {
    const ctrl = makeCtrl({ methods: [makeMethod({ httpDecorator: 'Post', httpPath: '' })] });
    const config: ExtractedDocsConfig = { classDecorators: [], methods: {} };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(Object.keys(patch['/users'])).toEqual(['post']);
  });

  it('skips methods with no HTTP decorator (not real endpoints)', () => {
    const ctrl = makeCtrl({ methods: [makeMethod({ httpDecorator: null })] });
    const config: ExtractedDocsConfig = { classDecorators: [], methods: {} };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch).toEqual({});
  });

  it('applies ApiTags from classDecorators to every method', () => {
    const ctrl = makeCtrl();
    const config: ExtractedDocsConfig = {
      classDecorators: [{ name: 'ApiTags', args: ['users'] }],
      methods: {},
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.tags).toEqual(['users']);
  });

  it('applies ApiOperation summary/description/deprecated', () => {
    const ctrl = makeCtrl();
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        findAll: [
          { name: 'ApiOperation', args: [{ summary: 'List users', description: 'Returns all', deprecated: true }] },
        ],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get).toMatchObject({
      summary: 'List users',
      description: 'Returns all',
      deprecated: true,
    });
  });

  it('applies ApiResponse with an explicit inline schema', () => {
    const ctrl = makeCtrl();
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        findAll: [
          {
            name: 'ApiResponse',
            args: [{ status: 200, description: 'OK', schema: { type: 'array', items: { type: 'string' } } }],
          },
        ],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.responses).toEqual({
      '200': {
        description: 'OK',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
      },
    });
  });

  it('applies ApiResponse example and examples into the media type content', () => {
    const ctrl = makeCtrl();
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        findAll: [
          {
            name: 'ApiResponse',
            args: [
              {
                status: 200,
                example: { id: 1, name: 'Alice' },
                examples: { basic: { summary: 'Basic', value: { id: 1 } } },
              },
            ],
          },
        ],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.responses!['200'].content).toEqual({
      'application/json': {
        example: { id: 1, name: 'Alice' },
        examples: { basic: { summary: 'Basic', value: { id: 1 } } },
      },
    });
  });

  it('applies ApiBody examples alongside an explicit schema', () => {
    const ctrl = makeCtrl({ methods: [makeMethod({ name: 'create', httpDecorator: 'Post', httpPath: '' })] });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        create: [
          {
            name: 'ApiBody',
            args: [{ schema: { type: 'object' }, examples: { basic: { value: { name: 'Alice' } } } }],
          },
        ],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].post.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object' },
          examples: { basic: { value: { name: 'Alice' } } },
        },
      },
    });
  });

  it('drops an example containing an unresolved (non-literal) value rather than leaking the internal marker', () => {
    const ctrl = makeCtrl();
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        findAll: [
          {
            name: 'ApiResponse',
            args: [{ status: 200, example: { id: 1, ownerId: { __unresolved: true, text: 'CURRENT_USER_ID' } } }],
          },
        ],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.responses!['200'].content).toBeUndefined();
  });

  it('drops an inline schema containing a nested unresolved value instead of embedding the marker shape', () => {
    const ctrl = makeCtrl();
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        findAll: [
          {
            name: 'ApiResponse',
            args: [
              {
                status: 200,
                schema: { type: 'object', properties: { id: { __unresolved: true, text: 'SOME_TYPE' } } },
              },
            ],
          },
        ],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    // No responseType fallback is set on this method either, so the schema field is entirely absent.
    expect(patch['/users'].get.responses!['200'].content).toBeUndefined();
  });

  it("falls back to the method's resolved return-type schema when ApiResponse({ type }) is an unresolved class reference", () => {
    const ctrl = makeCtrl({
      methods: [
        makeMethod({
          responseType: {
            name: 'UserDto',
            absolutePath: '/project/src/users/user.dto.ts',
            isArray: false,
            isInterface: false,
            classSchema: { properties: { id: { type: 'string' } }, required: ['id'] },
          },
        }),
      ],
    });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        findAll: [{ name: 'ApiResponse', args: [{ status: 200, type: { __unresolved: true, text: 'UserDto' } }] }],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.responses!['200'].content).toEqual({
      'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    });
  });

  it('applies ApiBody, resolving the DTO schema from the @Body() parameter already extracted by extract-methods', () => {
    const ctrl = makeCtrl({
      methods: [
        makeMethod({
          name: 'create',
          httpDecorator: 'Post',
          httpPath: '',
          params: [
            {
              name: 'dto',
              type: 'CreateUserDto',
              nestDecorator: '@Body',
              nestDecoratorArg: null,
              bodyType: {
                name: 'CreateUserDto',
                absolutePath: '/project/src/users/create-user.dto.ts',
                isArray: false,
                isInterface: false,
                classSchema: { properties: { name: { type: 'string' } }, required: ['name'] },
              },
            },
          ],
        }),
      ],
    });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        create: [{ name: 'ApiBody', args: [{ type: { __unresolved: true, text: 'CreateUserDto' } }] }],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].post.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
    });
  });

  it('uses a $ref when the response type has no inline schema (relies on @ApiProperty / components.schemas)', () => {
    const ctrl = makeCtrl({
      methods: [
        makeMethod({
          responseType: { name: 'UserDto', absolutePath: '/x/user.dto.ts', isArray: false, isInterface: false },
        }),
      ],
    });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: { findAll: [{ name: 'ApiResponse', args: [{ status: 200 }] }] },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.responses!['200'].content).toEqual({
      'application/json': { schema: { $ref: '#/components/schemas/UserDto' } },
    });
  });

  it('wraps the schema in an array when the response type is an array', () => {
    const ctrl = makeCtrl({
      methods: [
        makeMethod({
          responseType: { name: 'UserDto', absolutePath: '/x/user.dto.ts', isArray: true, isInterface: false },
        }),
      ],
    });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: { findAll: [{ name: 'ApiResponse', args: [{ status: 200 }] }] },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.responses!['200'].content).toEqual({
      'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/UserDto' } } },
    });
  });

  it('emits a oneOf of $refs when the response type is a union of named DTOs', () => {
    const ctrl = makeCtrl({
      methods: [
        makeMethod({
          responseType: {
            name: 'UserDto | AdminDto',
            absolutePath: '/x/user.dto.ts',
            isArray: false,
            isInterface: false,
            unionMembers: [
              { name: 'UserDto', absolutePath: '/x/user.dto.ts', isArray: false, isInterface: false },
              { name: 'AdminDto', absolutePath: '/x/admin.dto.ts', isArray: false, isInterface: false },
            ],
          },
        }),
      ],
    });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: { findAll: [{ name: 'ApiResponse', args: [{ status: 200 }] }] },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.responses!['200'].content).toEqual({
      'application/json': {
        schema: { oneOf: [{ $ref: '#/components/schemas/UserDto' }, { $ref: '#/components/schemas/AdminDto' }] },
      },
    });
  });

  it('wraps a union oneOf in an array schema when the response type is an array of the union', () => {
    const ctrl = makeCtrl({
      methods: [
        makeMethod({
          responseType: {
            name: 'UserDto | AdminDto',
            absolutePath: '/x/user.dto.ts',
            isArray: true,
            isInterface: false,
            unionMembers: [
              { name: 'UserDto', absolutePath: '/x/user.dto.ts', isArray: false, isInterface: false },
              { name: 'AdminDto', absolutePath: '/x/admin.dto.ts', isArray: false, isInterface: false },
            ],
          },
        }),
      ],
    });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: { findAll: [{ name: 'ApiResponse', args: [{ status: 200 }] }] },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.responses!['200'].content).toEqual({
      'application/json': {
        schema: {
          type: 'array',
          items: { oneOf: [{ $ref: '#/components/schemas/UserDto' }, { $ref: '#/components/schemas/AdminDto' }] },
        },
      },
    });
  });

  it('accumulates ApiBearerAuth into the security array', () => {
    const ctrl = makeCtrl();
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: { findAll: [{ name: 'ApiBearerAuth', args: [] }] },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users'].get.security).toEqual([{ bearer: [] }]);
  });

  it('collects ApiParam/ApiQuery/ApiHeader into the parameters array with the right "in"', () => {
    const ctrl = makeCtrl({ methods: [makeMethod({ httpPath: ':id' })] });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        findAll: [
          { name: 'ApiParam', args: [{ name: 'id', required: true }] },
          { name: 'ApiQuery', args: [{ name: 'search' }] },
          { name: 'ApiHeader', args: [{ name: 'x-request-id', required: true }] },
        ],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users/{id}'].get.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'search', in: 'query', schema: { type: 'string' } },
      { name: 'x-request-id', in: 'header', required: true, schema: { type: 'string' } },
    ]);
  });

  it('puts a resolved enum array into the parameter schema, inferring number type', () => {
    const ctrl = makeCtrl({ methods: [makeMethod({ httpPath: ':id' })] });
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: {
        findAll: [
          { name: 'ApiQuery', args: [{ name: 'status', enum: ['active', 'inactive'] }] },
          { name: 'ApiQuery', args: [{ name: 'level', enum: [0, 1, 2] }] },
        ],
      },
    };
    const patch = buildOpenApiPatch(ctrl, config);
    expect(patch['/users/{id}'].get.parameters).toEqual([
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } },
      { name: 'level', in: 'query', schema: { type: 'number', enum: [0, 1, 2] } },
    ]);
  });

  it('silently ignores unrecognized decorator names instead of throwing', () => {
    const ctrl = makeCtrl();
    const config: ExtractedDocsConfig = {
      classDecorators: [],
      methods: { findAll: [{ name: 'SomeCustomDecorator', args: [{ x: 1 }] }] },
    };
    expect(() => buildOpenApiPatch(ctrl, config)).not.toThrow();
  });
});
