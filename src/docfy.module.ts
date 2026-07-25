import { DynamicModule, Logger, Module } from '@nestjs/common';
import { DocfyRegistry } from './registry';
import { resolveDocsPath } from './resolve-docs-path';

export interface DocfyModuleOptions {
  /**
   * When true, a controller marked with @WithDocs() that has no companion docs
   * file throws an error at startup instead of emitting a warning.
   * Useful for CI environments to catch missing docs files early.
   * @default false
   */
  strict?: boolean;
}

/**
 * Import once in your root AppModule — before any module that declares controllers
 * marked with @WithDocs().
 *
 * @example
 * @Module({
 *   imports: [DocfyModule.forRoot(), UsersModule],
 * })
 * export class AppModule {}
 */
@Module({})
export class DocfyModule {
  private static readonly logger = new Logger(DocfyModule.name);

  static forRoot(options: DocfyModuleOptions = {}): DynamicModule {
    DocfyModule._loadAllDocs(options);
    return { module: DocfyModule };
  }

  /**
   * @internal Exposed for unit testing only. Do not call from application code.
   */
  static _loadAllDocs(
    options: DocfyModuleOptions = {},
    requireFn: (path: string) => void = require,
    cacheReader?: () => Record<string, { exports: Record<string, unknown> } | undefined>,
  ): void {
    const { strict = false } = options;

    for (const controllerClass of DocfyRegistry.getAll()) {
      const callSiteStack = DocfyRegistry.getCallSite(controllerClass);
      const docsPath = resolveDocsPath(controllerClass, cacheReader, callSiteStack);

      if (!docsPath) {
        const message =
          `Could not locate source file for ${controllerClass.name}. ` +
          `Make sure the class is exported directly from its own module file ` +
          `(not only via a barrel index.ts).`;
        if (strict) throw new Error(`[nestjs-docfy] ${message}`);
        DocfyModule.logger.warn(message);
        continue;
      }

      try {
        requireFn(docsPath);
        DocfyModule.logger.log(`Loaded docs for ${controllerClass.name} from ${docsPath}`);
      } catch (err: unknown) {
        if (isMissingDocsFile(err, docsPath)) {
          // The docs file simply doesn't exist — allowed unless strict mode
          const message = `No docs file found for ${controllerClass.name}. Expected: ${docsPath}`;
          if (strict) throw new Error(`[nestjs-docfy] ${message}`, { cause: err });
          DocfyModule.logger.warn(message);
        } else {
          // Unexpected error (syntax error inside the docs file, missing dependency, etc.)
          DocfyModule.logger.error(`Failed to load docs file for ${controllerClass.name}: ${docsPath}`, err);
          throw err;
        }
      }
    }
  }
}

/**
 * Returns true only if the error means the docs file itself does not exist,
 * not if a dependency inside the docs file is missing.
 */
function isMissingDocsFile(err: unknown, docsPath: string): boolean {
  if (!(err instanceof Error)) return false;
  if (!('code' in err) || (err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') return false;
  // Node's MODULE_NOT_FOUND message is "Cannot find module 'X'\nRequire stack:\n- ...".
  // Only the first line names the actual missing module — docsPath legitimately
  // also appears further down in the "Require stack" list whenever a *dependency*
  // inside an existing docs file is missing (docsPath required it, so it's in the
  // chain), which would otherwise false-positive as "the docs file doesn't exist".
  const firstLine = err.message.split('\n', 1)[0];
  return firstLine.includes(docsPath);
}
