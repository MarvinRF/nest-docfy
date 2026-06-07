import { DynamicModule, Logger, Module } from '@nestjs/common';
import { DocfyRegistry } from './registry';
import { resolveDocsPath } from './resolve-docs-path';

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

  static forRoot(): DynamicModule {
    DocfyModule.loadAllDocs();
    return { module: DocfyModule };
  }

  // Separated for unit testing
  static loadAllDocs(
    requireFn: (path: string) => void = require,
    cacheReader?: () => Record<string, { exports: Record<string, unknown> } | undefined>,
  ): void {
    for (const controllerClass of DocfyRegistry.getAll()) {
      const docsPath = resolveDocsPath(controllerClass, cacheReader);

      if (!docsPath) {
        DocfyModule.logger.warn(
          `Could not locate source file for ${controllerClass.name}. ` +
            `Make sure the class is exported from its module file.`,
        );
        continue;
      }

      try {
        requireFn(docsPath);
        DocfyModule.logger.log(
          `Loaded docs for ${controllerClass.name} from ${docsPath}`,
        );
      } catch (err: unknown) {
        const isNotFound =
          err instanceof Error &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';

        if (isNotFound) {
          DocfyModule.logger.warn(
            `No docs file found for ${controllerClass.name}. ` +
              `Expected: ${docsPath}`,
          );
        } else {
          DocfyModule.logger.error(
            `Failed to load docs file for ${controllerClass.name}: ${docsPath}`,
            err,
          );
          throw err;
        }
      }
    }
  }
}
