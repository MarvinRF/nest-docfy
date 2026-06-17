import { TagGroupRegistry } from './tag-group-registry';

/**
 * Adds the `x-tagGroups` extension (read by ReDoc to group tags in its
 * sidebar) to a Swagger document, built from groups registered via
 * `docs({ group, tags })`.
 *
 * Call after `SwaggerModule.createDocument()` and before `SwaggerModule.setup()`:
 *
 * @example
 * const document = SwaggerModule.createDocument(app, config);
 * SwaggerModule.setup('api', app, attachTagGroups(document));
 *
 * Returns the document unchanged (same reference) if no groups were registered.
 */
export function attachTagGroups<T extends object>(document: T): T {
  const groups = TagGroupRegistry.getAll();
  if (groups.length === 0) return document;
  return Object.assign({}, document, { 'x-tagGroups': groups }) as T;
}
