import fs from 'fs';
import path from 'path';
import { mergeSpecPatch, OpenApiDocument } from './cli/merge-spec-patch';
import type { SpecPatch } from './cli/build-openapi-patch';
import { DOCFY_METADATA_FILENAME } from './plugin/generate-metadata';

export interface ApplyDocfyMetadataOptions {
  /** Absolute path to the metadata file. Defaults to `docfy-metadata.json` next to the running entry file. */
  metadataPath?: string;
  /** Throw instead of warning when the metadata file is missing or unparseable — mirrors `DocfyModule.forRoot({ strict })`. */
  strict?: boolean;
}

/**
 * Merges the build-time metadata produced by the `nestjs-docfy` CLI plugin
 * (`nest-cli.json`'s `compilerOptions.plugins`) into an already-built OpenAPI
 * document. Call this right after `SwaggerModule.createDocument()` — the
 * same lifecycle point a manually-run `patch-spec` output would be merged
 * at, except this runs automatically on every build instead of requiring a
 * separate CLI step.
 *
 * This is the path that actually works under NestJS CLI's `webpack: true`
 * build mode — see the README's "Not supported: webpack: true" section for
 * why `DocfyModule`'s `require.cache`-based discovery structurally cannot.
 */
export function applyDocfyMetadata(
  document: OpenApiDocument,
  options: ApplyDocfyMetadataOptions = {},
): OpenApiDocument {
  const metadataPath =
    options.metadataPath ?? path.join(path.dirname(require.main?.filename ?? process.cwd()), DOCFY_METADATA_FILENAME);

  let raw: string;
  try {
    raw = fs.readFileSync(metadataPath, 'utf8');
  } catch {
    const message =
      `[nestjs-docfy] No build-time metadata found at ${metadataPath}. Did you register the CLI plugin in ` +
      'nest-cli.json (`"compilerOptions": { "plugins": ["nestjs-docfy"] }`)?';
    if (options.strict) throw new Error(message);
    // eslint-disable-next-line no-console
    console.warn(message);
    return document;
  }

  let patch: SpecPatch;
  try {
    patch = JSON.parse(raw) as SpecPatch;
  } catch (err) {
    const message = `[nestjs-docfy] Failed to parse build-time metadata at ${metadataPath}: ${err instanceof Error ? err.message : String(err)}`;
    if (options.strict) throw new Error(message);
    // eslint-disable-next-line no-console
    console.warn(message);
    return document;
  }

  return mergeSpecPatch(document, patch).document;
}
