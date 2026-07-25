import fs from 'fs';
import path from 'path';
import { scanApp } from '../cli/scan-controllers';
import { computeSpecPatch } from '../cli/patch-spec';
import type { ProjectApp } from '../cli/project-types';

/** Filename the CLI plugin writes into the build output dir, and `applyDocfyMetadata()` reads by default. */
export const DOCFY_METADATA_FILENAME = 'docfy-metadata.json';

export interface GenerateMetadataOptions {
  /** Absolute path to the project's tsconfig — the same one the build is using. */
  tsConfigFilePath: string;
  /** Absolute path to the project root, used for the same symlink/path-traversal safety check `scanApp` always applies. */
  projectRoot: string;
  /** Absolute path to the directory the metadata file should be written into (typically the build's outDir). */
  outDir: string;
  /** Controller glob override — same convention as the CLI's `--pattern` flag. Defaults to `**\/*.controller.ts`. */
  controllerGlob?: string;
}

export interface GenerateMetadataResult {
  /** Absolute path the metadata file was written to. */
  outFile: string;
  /** How many "METHOD /path" operations the generated patch touches. */
  patchedOperationCount: number;
  controllersWithoutDocs: string[];
  unparseableDocsFiles: string[];
  scanErrors: { file: string; message: string }[];
}

/**
 * Scans every controller in the project via static analysis (ts-morph — the
 * same engine `generate`/`check`/`patch-spec` already use) and writes the
 * resulting SpecPatch to a JSON file in the build output directory.
 *
 * This is the piece the CLI plugin (`src/plugin/index.ts`) calls once per
 * compilation. Unlike the `patch-spec` CLI command, it needs no base OpenAPI
 * document — `applyDocfyMetadata()` reads the written file at runtime and
 * merges it into whatever `SwaggerModule.createDocument()` produces then.
 */
export function generateDocfyMetadata(options: GenerateMetadataOptions): GenerateMetadataResult {
  const app: ProjectApp = {
    name: 'app',
    root: options.projectRoot,
    tsconfig: options.tsConfigFilePath,
    controllerGlob: options.controllerGlob ?? '**/*.controller.ts',
  };

  const { controllers, errors: scanErrors } = scanApp(app, options.projectRoot, options.controllerGlob, 'ts');
  const { patch, controllersWithoutDocs, unparseableDocsFiles } = computeSpecPatch(controllers, 'ts', (absolutePath) => {
    try {
      return fs.readFileSync(absolutePath, 'utf8');
    } catch {
      return null;
    }
  });

  fs.mkdirSync(options.outDir, { recursive: true });
  const outFile = path.join(options.outDir, DOCFY_METADATA_FILENAME);
  fs.writeFileSync(outFile, JSON.stringify(patch, null, 2), 'utf8');

  const patchedOperationCount = Object.values(patch).reduce(
    (count, methods) => count + Object.keys(methods).length,
    0,
  );

  return { outFile, patchedOperationCount, controllersWithoutDocs, unparseableDocsFiles, scanErrors };
}
