import type * as ts from 'typescript';
import path from 'path';
import { generateDocfyMetadata } from './generate-metadata';

export { DOCFY_METADATA_FILENAME } from './generate-metadata';

export interface DocfyPluginOptions {
  /** Root directory to scan for controllers. Defaults to the directory containing the resolved tsconfig. */
  projectRoot?: string;
  /** Controller glob override — same convention as the CLI's `--pattern` flag. */
  controllerGlob?: string;
}

/**
 * NestJS CLI "compiler plugin" entry point — register it in `nest-cli.json`:
 * `"compilerOptions": { "plugins": ["nestjs-docfy"] }`. The Nest CLI's plugin
 * loader calls exactly this `before(options, program)` shape for both the
 * `tsc` and the `webpack` builder (see `@nestjs/cli`'s `PluginsLoader` and
 * `ts-loader`'s `getCustomTransformers` wiring) — the same mechanism
 * `@nestjs/swagger/plugin` already relies on to work under `webpack: true`,
 * which is the one thing `DocfyModule`'s `require.cache`-based discovery
 * structurally cannot do (see the README's "Not supported: webpack: true"
 * section).
 *
 * Unlike `@nestjs/swagger/plugin`, this does not rewrite any AST node — it
 * returns an identity transformer. Its only job is a build-time side
 * effect: run the exact same static analysis `generate`/`check`/`patch-spec`
 * already do, once per compilation, and write the resulting patch to a JSON
 * file next to the compiled output. `applyDocfyMetadata()` (exported from
 * the package root) reads that file at runtime and merges it into the
 * document right after `SwaggerModule.createDocument()` — the same merge
 * `patch-spec` does, just automatic on every build instead of a separate
 * manual CLI invocation.
 */
export function before(options: DocfyPluginOptions = {}, program?: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  if (!program) {
    throw new Error(
      'nestjs-docfy plugin: the "program" reference must be provided when using the CLI plugin. ' +
        'This is usually caused by "isolatedModules" being set to true in your tsconfig.',
    );
  }

  const compilerOptions = program.getCompilerOptions() as ts.CompilerOptions & { configFilePath?: string };
  const configFilePath = compilerOptions.configFilePath;
  if (!configFilePath) {
    throw new Error(
      'nestjs-docfy plugin: could not determine the tsconfig path from the TypeScript program. ' +
        'This plugin must be registered via nest-cli.json\'s "compilerOptions.plugins".',
    );
  }

  const projectRoot = options.projectRoot ?? path.dirname(configFilePath);
  const outDir = compilerOptions.outDir ?? path.join(projectRoot, 'dist');

  try {
    generateDocfyMetadata({
      tsConfigFilePath: configFilePath,
      projectRoot,
      outDir,
      controllerGlob: options.controllerGlob,
    });
  } catch (err) {
    // A build-time analysis failure shouldn't be silently swallowed, but it
    // also shouldn't fail the app's entire build — same "loud warning, not a
    // crash" philosophy DocfyModule already follows for a missing docs file.
    console.warn(
      `[nestjs-docfy] Failed to generate build-time metadata: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return () => (sourceFile) => sourceFile;
}
