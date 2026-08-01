import path from 'path';
import { PathTraversalError } from './errors';

export type OutputFormat = 'ts' | 'js';

export interface CliOptions {
  root: string;
  tsconfig: string | undefined;
  pattern: string;
  out: string | undefined;
  force: boolean;
  overwrite: boolean;
  dryRun: boolean;
  quiet: boolean;
  format: OutputFormat;
  watch: boolean;
  registerPlugin: boolean;
  linkController: boolean;
}

const ALLOWED_GLOB_CHARS = /^[a-zA-Z0-9_\-./\\*?[\]{}!@# ]+$/;
const VALID_FORMATS: OutputFormat[] = ['ts', 'js'];

/**
 * Validates that a resolved path stays inside the project root.
 * Prevents path traversal via relative segments or symlink tricks.
 */
export function assertWithinRoot(resolvedPath: string, root: string): void {
  const normalRoot = path.resolve(root) + path.sep;
  const normalTarget = path.resolve(resolvedPath);
  if (!normalTarget.startsWith(normalRoot) && normalTarget !== path.resolve(root)) {
    throw new PathTraversalError(resolvedPath);
  }
}

/**
 * Validates and normalizes the glob pattern supplied via --pattern.
 * Rejects patterns with characters that could cause shell injection or
 * path traversal outside the root.
 */
export function validateGlob(pattern: string): string {
  if (!ALLOWED_GLOB_CHARS.test(pattern)) {
    throw new Error(
      `Invalid --pattern: "${pattern}". Only alphanumeric characters, path separators, and glob wildcards are allowed.`,
    );
  }
  // Reject attempts to escape the root via relative segments
  const normalized = path.normalize(pattern.replace(/\*/g, '_'));
  if (normalized.startsWith('..')) {
    throw new Error(`Invalid --pattern: "${pattern}" resolves outside the project root.`);
  }
  return pattern;
}

/**
 * Resolves and validates a path option (--root, --tsconfig, --out)
 * against the declared root to prevent traversal.
 * Returns the resolved absolute path.
 */
export function resolveAndValidate(value: string, root: string, optionName: string): string {
  let resolved: string;
  try {
    resolved = path.resolve(root, value);
  } catch {
    throw new Error(`Invalid value for ${optionName}: "${value}"`);
  }
  assertWithinRoot(resolved, root);
  return resolved;
}

/**
 * Parses and validates the raw CLI option object produced by Commander.
 * Returns a strongly-typed, safe CliOptions struct.
 */
export function parseAndValidateOptions(raw: {
  root?: string;
  tsconfig?: string;
  pattern?: string;
  out?: string;
  force?: boolean;
  overwrite?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
  format?: string;
  watch?: boolean;
  registerPlugin?: boolean;
  linkController?: boolean;
}): CliOptions {
  const root = path.resolve(raw.root ?? '.');

  const pattern = validateGlob(raw.pattern ?? '**/*.controller.ts');

  const tsconfig = raw.tsconfig ? resolveAndValidate(raw.tsconfig, root, '--tsconfig') : undefined;

  const out = raw.out ? resolveAndValidate(raw.out, root, '--out') : undefined;

  const format = raw.format ?? 'ts';
  if (!VALID_FORMATS.includes(format as OutputFormat)) {
    throw new Error(`Invalid --format: "${format}". Allowed values: ${VALID_FORMATS.join(', ')}.`);
  }

  return {
    root,
    tsconfig,
    pattern,
    out,
    force: raw.force ?? false,
    overwrite: raw.overwrite ?? false,
    dryRun: raw.dryRun ?? false,
    quiet: raw.quiet ?? false,
    format: format as OutputFormat,
    watch: raw.watch ?? false,
    registerPlugin: raw.registerPlugin ?? false,
    linkController: raw.linkController ?? false,
  };
}
