import { mergeSpecPatch, mergeOperation, OpenApiDocument, OpenApiOperation } from '../../cli/merge-spec-patch';
import type { SpecPatch } from '../../cli/build-openapi-patch';

/** `OpenApiDocument.paths` is `unknown` (see merge-spec-patch.ts for why) — this narrows it for test assertions. */
function paths(doc: OpenApiDocument): Record<string, Record<string, unknown>> {
  return doc.paths as Record<string, Record<string, unknown>>;
}

describe('mergeOperation()', () => {
  it('overwrites scalar fields', () => {
    const existing: OpenApiOperation = { summary: 'old' };
    const result = mergeOperation(existing, { summary: 'new' });
    expect(result.summary).toBe('new');
  });

  it('leaves scalar fields untouched when the patch does not set them', () => {
    const existing: OpenApiOperation = { summary: 'kept', description: 'also kept' };
    const result = mergeOperation(existing, { tags: ['x'] });
    expect(result.summary).toBe('kept');
    expect(result.description).toBe('also kept');
  });

  it('unions tags without duplicates', () => {
    const existing: OpenApiOperation = { tags: ['a', 'b'] };
    const result = mergeOperation(existing, { tags: ['b', 'c'] });
    expect(result.tags).toEqual(['a', 'b', 'c']);
  });

  it("treats tags differing only by case as the same tag, keeping the base document's casing", () => {
    // Real-world case this reproduces: @nestjs/swagger auto-tags a controller
    // as "Auth" (from the class name) while a docs file's ApiTags('auth')
    // uses lowercase — same logical group, would otherwise render as two
    // separate sidebar sections in a UI that groups by tag.
    const existing: OpenApiOperation = { tags: ['Auth'] };
    const result = mergeOperation(existing, { tags: ['auth'] });
    expect(result.tags).toEqual(['Auth']);
  });

  it('merges responses per status code, not wholesale', () => {
    const existing: OpenApiOperation = { responses: { '200': { description: 'OK' }, '404': { description: 'gone' } } };
    const result = mergeOperation(existing, { responses: { '200': { description: 'Found' } } });
    expect(result.responses).toEqual({
      '200': { description: 'Found' },
      '404': { description: 'gone' },
    });
  });

  it('dedupes parameters by name+in', () => {
    const existing: OpenApiOperation = { parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }] };
    const result = mergeOperation(existing, {
      parameters: [
        { name: 'id', in: 'path', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ],
    });
    expect(result.parameters).toHaveLength(2);
  });

  it('enriches an already-existing parameter instead of discarding the patch for it', () => {
    // Real-world shape this reproduces: @nestjs/swagger auto-generates a bare
    // parameter entry (required: true, no enum) from reflection alone for
    // any @Query()-decorated handler argument, even with zero @Api*
    // decorators on it. A docs file's ApiQuery({ enum, required: false })
    // for that same parameter must enrich it, not be silently dropped
    // because "a parameter with this name+location already exists".
    const existing: OpenApiOperation = {
      parameters: [{ name: 'role', in: 'query', required: true, schema: { type: 'string' } }],
    };
    const result = mergeOperation(existing, {
      parameters: [
        { name: 'role', in: 'query', required: false, schema: { type: 'string', enum: ['member', 'admin'] } },
      ],
    });
    expect(result.parameters).toEqual([
      { name: 'role', in: 'query', required: false, schema: { type: 'string', enum: ['member', 'admin'] } },
    ]);
  });

  it('dedupes security entries by their key set', () => {
    const existing: OpenApiOperation = { security: [{ bearer: [] }] };
    const result = mergeOperation(existing, { security: [{ bearer: [] }] });
    expect(result.security).toEqual([{ bearer: [] }]);
  });
});

describe('mergeSpecPatch()', () => {
  const baseDocument: OpenApiDocument = {
    openapi: '3.0.0',
    paths: {
      '/users': {
        get: { operationId: 'UsersController_findAll', responses: { '200': { description: '' } } },
        post: { operationId: 'UsersController_create', responses: { '201': { description: '' } } },
      },
    },
  };

  it('merges a matching patch into the base document operation', () => {
    const patch: SpecPatch = {
      '/users': { get: { summary: 'List users', tags: ['users'] } },
    };
    const { document } = mergeSpecPatch(baseDocument, patch);
    expect(paths(document)['/users'].get).toMatchObject({
      operationId: 'UsersController_findAll',
      summary: 'List users',
      tags: ['users'],
    });
  });

  it('does not mutate the input document', () => {
    const patch: SpecPatch = { '/users': { get: { summary: 'List users' } } };
    mergeSpecPatch(baseDocument, patch);
    expect((paths(baseDocument)['/users'].get as OpenApiOperation).summary).toBeUndefined();
  });

  it('leaves operations the patch does not touch completely unchanged', () => {
    const patch: SpecPatch = { '/users': { get: { summary: 'List users' } } };
    const { document } = mergeSpecPatch(baseDocument, patch);
    expect(paths(document)['/users'].post).toEqual(paths(baseDocument)['/users'].post);
  });

  it('reports a patch route+method with no matching base operation as unmatched, without throwing', () => {
    const patch: SpecPatch = { '/ghost': { delete: { summary: 'does not exist in base' } } };
    const { document, unmatchedRoutes } = mergeSpecPatch(baseDocument, patch);
    expect(unmatchedRoutes).toEqual(['DELETE /ghost']);
    expect(paths(document)['/ghost']).toBeUndefined();
  });

  it('preserves unrelated top-level document fields (info, components, etc.)', () => {
    const docWithComponents: OpenApiDocument = {
      ...baseDocument,
      info: { title: 'My API', version: '1.0' },
      components: { schemas: { User: { type: 'object' } } },
    };
    const { document } = mergeSpecPatch(docWithComponents, {});
    expect(document.info).toEqual({ title: 'My API', version: '1.0' });
    expect(document.components).toEqual({ schemas: { User: { type: 'object' } } });
  });
});
