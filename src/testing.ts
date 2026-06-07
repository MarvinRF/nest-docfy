/**
 * Testing utilities for nestjs-docfy.
 * Import from 'nestjs-docfy/testing' in your test files.
 *
 * @example
 * import { resetDocfyRegistry } from 'nestjs-docfy/testing';
 * beforeEach(() => resetDocfyRegistry());
 */
import { DocfyRegistry } from './registry';

export { DocfyRegistry };

export function resetDocfyRegistry(): void {
  DocfyRegistry._reset();
}
