/**
 * Testing utilities for nestjs-docfy.
 * Import from 'nestjs-docfy/testing' in your test files.
 *
 * @example
 * import { resetDocfyRegistry } from 'nestjs-docfy/testing';
 * beforeEach(() => resetDocfyRegistry());
 */
export { DocfyRegistry } from './registry';

export function resetDocfyRegistry(): void {
  // Imported lazily to avoid pulling the registry into production bundles
  // when the testing module is tree-shaken.
  const { DocfyRegistry: reg } = require('./registry') as { DocfyRegistry: typeof import('./registry').DocfyRegistry };
  reg._reset();
}
