export interface TagGroup {
  name: string;
  tags: string[];
}

// Global registry of tag groups declared via docs({ group, tags }).
// Populated at module-load time, same lifecycle as DocfyRegistry.
const groups = new Map<string, Set<string>>();

export const TagGroupRegistry = {
  register(group: string, tags: string[]): void {
    if (!group) return;
    let set = groups.get(group);
    if (!set) {
      set = new Set<string>();
      groups.set(group, set);
    }
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.length > 0) set.add(tag);
    }
  },

  getAll(): TagGroup[] {
    return Array.from(groups.entries()).map(([name, tagSet]) => ({
      name,
      tags: Array.from(tagSet),
    }));
  },

  // For testing only — resets the registry between test runs.
  _reset(): void {
    groups.clear();
  },
};
