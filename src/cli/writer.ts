import fs from 'fs';
import path from 'path';
import { assertWithinRoot } from './parse-args';
import { renderDocsFile } from './generate-file';
import { mergeDocsFile } from './merge-docs';
import { deriveDocsFilePath } from './scan-controllers';
import type { ControllerInfo } from './extract-methods';

export type WriteOutcome = 'created' | 'skipped' | 'merged' | 'dry' | 'error';

export interface WriteResult {
  controllerClass: string;
  docsFilePath: string;
  outcome: WriteOutcome;
  addedMethods?: string[];
  error?: string;
}

export interface WriterOptions {
  projectRoot: string;
  outDir?: string;
  force: boolean;
  dryRun: boolean;
  format: 'ts' | 'js';
}

/**
 * Resolves the output path for a docs file, applying --out dir override
 * when present, and validating the result stays within the project root.
 */
function resolveOutputPath(
  ctrl: ControllerInfo,
  opts: WriterOptions,
): string {
  const derived = deriveDocsFilePath(ctrl.filePath, opts.format);

  if (!opts.outDir) return derived;

  // --out: place the file in the specified directory, keeping only the basename
  const outPath = path.join(opts.outDir, path.basename(derived));
  assertWithinRoot(outPath, opts.projectRoot);
  return outPath;
}


/**
 * Writes (or previews) the docs file for a single controller.
 * Handles: create, skip, merge (--force), dry-run.
 */
export function writeDocsFile(
  ctrl: ControllerInfo,
  opts: WriterOptions,
): WriteResult {
  let docsFilePath: string;
  try {
    docsFilePath = resolveOutputPath(ctrl, opts);
    assertWithinRoot(docsFilePath, opts.projectRoot);
  } catch (err) {
    return {
      controllerClass: ctrl.className,
      docsFilePath: ctrl.filePath,
      outcome: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const exists = (() => {
    try { fs.accessSync(docsFilePath); return true; } catch { return false; }
  })();

  // --- DRY RUN ---
  if (opts.dryRun) {
    const content = renderDocsFile(ctrl, docsFilePath, opts.format);
    process.stdout.write(`\n${'─'.repeat(60)}\n`);
    process.stdout.write(`[dry-run] ${docsFilePath}\n`);
    process.stdout.write(`${'─'.repeat(60)}\n`);
    process.stdout.write(content);
    return { controllerClass: ctrl.className, docsFilePath, outcome: 'dry' };
  }

  // --- SKIP (file exists, no --force) ---
  if (exists && !opts.force) {
    return { controllerClass: ctrl.className, docsFilePath, outcome: 'skipped' };
  }

  // --- MERGE (file exists + --force) ---
  if (exists && opts.force) {
    try {
      const existingContent = fs.readFileSync(docsFilePath, 'utf8');
      const merged = mergeDocsFile(existingContent, ctrl);

      if (merged) {
        fs.writeFileSync(docsFilePath, merged.content, 'utf8');
        return {
          controllerClass: ctrl.className,
          docsFilePath,
          outcome: 'merged',
          addedMethods: merged.addedMethods,
        };
      }
      // Merge failed (unparseable file) — fall through to full overwrite
    } catch (err) {
      return {
        controllerClass: ctrl.className,
        docsFilePath,
        outcome: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // --- CREATE (new file, or full overwrite after failed merge) ---
  try {
    const dir = path.dirname(docsFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const content = renderDocsFile(ctrl, docsFilePath, opts.format);
    fs.writeFileSync(docsFilePath, content, 'utf8');
    return { controllerClass: ctrl.className, docsFilePath, outcome: 'created' };
  } catch (err) {
    return {
      controllerClass: ctrl.className,
      docsFilePath,
      outcome: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Writes docs files for all controllers and returns aggregated results.
 */
export function writeAllDocs(
  controllers: ControllerInfo[],
  opts: WriterOptions,
): WriteResult[] {
  return controllers.map((ctrl) => writeDocsFile(ctrl, opts));
}
