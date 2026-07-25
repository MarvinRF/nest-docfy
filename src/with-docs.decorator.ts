import { SetMetadata } from '@nestjs/common';
import { DocfyRegistry } from './registry';

/**
 * Metadata key set on every class decorated with @WithDocs().
 * The lib itself uses the global DocfyRegistry (not this metadata) for discovery.
 * Exposed for external introspection — e.g. guards, interceptors, or tooling
 * that need to check whether a controller has a companion docs file:
 *
 * @example
 * const hasDocs = Reflect.getMetadata(DOCFY_MARKER, MyController) === true;
 */
export const DOCFY_MARKER = 'docfy:with_docs';

/**
 * Marks a NestJS controller so that DocfyModule will load its companion
 * docs file (*.controller.docs.ts / *.controller.docs.js) at startup.
 *
 * @example
 * @WithDocs()
 * @Controller('users')
 * export class UsersController { ... }
 */
export function WithDocs(): ClassDecorator {
  // Captured here, not inside the returned decorator, so the stack's frame
  // right under this function's own is the line `@WithDocs()` is written on
  // (the controller's own file) — used by resolve-source-from-stack.ts as a
  // fallback when require.cache has no per-file entry for the controller
  // (e.g. the app is bundled by webpack; see DocfyModule's README section).
  const callSiteStack = new Error().stack;

  return (target: NewableFunction) => {
    SetMetadata(DOCFY_MARKER, true)(target);
    DocfyRegistry.add(target, callSiteStack);
  };
}
