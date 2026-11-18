/**
 * Filename the CLI plugin writes into the build output dir, and `applyDocfyMetadata()` reads by default.
 * Lives in its own dependency-free file so the runtime entry can import it without pulling in
 * the build-time scanner (ts-morph and its glob stack).
 */
export const DOCFY_METADATA_FILENAME = 'docfy-metadata.json';
