import { TagGroupRegistry } from '../tag-group-registry';

describe('TagGroupRegistry', () => {
  afterEach(() => TagGroupRegistry._reset());

  it('returns an empty array when nothing was registered', () => {
    expect(TagGroupRegistry.getAll()).toEqual([]);
  });

  it('registers a group with its tags', () => {
    TagGroupRegistry.register('Administration', ['users', 'roles']);
    expect(TagGroupRegistry.getAll()).toEqual([
      { name: 'Administration', tags: ['users', 'roles'] },
    ]);
  });

  it('merges tags across multiple register calls for the same group', () => {
    TagGroupRegistry.register('Administration', ['users']);
    TagGroupRegistry.register('Administration', ['roles']);

    expect(TagGroupRegistry.getAll()).toEqual([
      { name: 'Administration', tags: ['users', 'roles'] },
    ]);
  });

  it('deduplicates repeated tags within the same group', () => {
    TagGroupRegistry.register('Administration', ['users']);
    TagGroupRegistry.register('Administration', ['users']);

    expect(TagGroupRegistry.getAll()).toEqual([
      { name: 'Administration', tags: ['users'] },
    ]);
  });

  it('keeps multiple groups independent', () => {
    TagGroupRegistry.register('Administration', ['users']);
    TagGroupRegistry.register('Public', ['health']);

    const groups = TagGroupRegistry.getAll();
    expect(groups).toHaveLength(2);
    expect(groups).toEqual(
      expect.arrayContaining([
        { name: 'Administration', tags: ['users'] },
        { name: 'Public', tags: ['health'] },
      ]),
    );
  });

  it('ignores a register call with an empty group name', () => {
    TagGroupRegistry.register('', ['users']);
    expect(TagGroupRegistry.getAll()).toEqual([]);
  });

  it('ignores non-string and empty-string tags (security/robustness)', () => {
    TagGroupRegistry.register('Administration', ['', 'users', null as unknown as string, undefined as unknown as string]);
    expect(TagGroupRegistry.getAll()).toEqual([
      { name: 'Administration', tags: ['users'] },
    ]);
  });

  it('_reset() clears all registered groups', () => {
    TagGroupRegistry.register('Administration', ['users']);
    TagGroupRegistry._reset();
    expect(TagGroupRegistry.getAll()).toEqual([]);
  });
});
