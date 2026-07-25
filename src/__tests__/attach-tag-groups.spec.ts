import { attachTagGroups } from '../attach-tag-groups';
import { TagGroupRegistry } from '../tag-group-registry';

describe('attachTagGroups()', () => {
  afterEach(() => TagGroupRegistry._reset());

  it('returns the same document reference when no groups are registered', () => {
    const document = { openapi: '3.0.0', paths: {} };
    const result = attachTagGroups(document);

    expect(result).toBe(document);
    expect(result).not.toHaveProperty('x-tagGroups');
  });

  it('adds x-tagGroups built from the registry', () => {
    TagGroupRegistry.register('Administration', ['users', 'roles']);

    const document = { openapi: '3.0.0', paths: {} };
    const result = attachTagGroups(document) as typeof document & {
      'x-tagGroups': { name: string; tags: string[] }[];
    };

    expect(result['x-tagGroups']).toEqual([{ name: 'Administration', tags: ['users', 'roles'] }]);
  });

  it('does not mutate the original document', () => {
    TagGroupRegistry.register('Administration', ['users']);

    const document = { openapi: '3.0.0', paths: {} };
    attachTagGroups(document);

    expect(document).not.toHaveProperty('x-tagGroups');
  });

  it('preserves existing document properties', () => {
    TagGroupRegistry.register('Administration', ['users']);

    const document = { openapi: '3.0.0', paths: { '/users': {} } };
    const result = attachTagGroups(document);

    expect(result.openapi).toBe('3.0.0');
    expect(result.paths).toEqual({ '/users': {} });
  });

  it('includes multiple groups in registration order', () => {
    TagGroupRegistry.register('Administration', ['users']);
    TagGroupRegistry.register('Public', ['health']);

    const document = { openapi: '3.0.0', paths: {} };
    const result = attachTagGroups(document) as typeof document & {
      'x-tagGroups': { name: string; tags: string[] }[];
    };

    expect(result['x-tagGroups']).toHaveLength(2);
  });
});
