import fs from 'fs';
import path from 'path';
import { assertWithinRoot } from './parse-args';
import { renderDocsFile } from './generate-file';
import { mergeDocsFile, classHasDocsCall, hasOtherClassDocsCall, appendDocsCall, replaceDocsCall } from './merge-docs';
import { deriveDocsFilePath } from './scan-controllers';
import type { ControllerInfo } from './extract-methods';

export type WriteOutcome = 'created' | 'appended' | 'skipped' | 'merged' | 'overwritten' | 'dry' | 'error';

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
  /** Discards existing docs file content and regenerates it from scratch, instead of merging
   * new methods into it (--force's behavior). Takes precedence over --force when both are set. */
  overwrite: boolean;
  dryRun: boolean;
  format: 'ts' | 'js';
}

/**
 * Resolves the output path for a docs file, applying --out dir override
 * when present, and validating the result stays within the project root.
 */
function resolveOutputPath(ctrl: ControllerInfo, opts: WriterOptions): string {
  const derived = deriveDocsFilePath(ctrl.filePath, opts.format);

  if (!opts.outDir) return derived;

  // --out: place the file in the specified directory, keeping only the basename
  const outPath = path.join(opts.outDir, path.basename(derived));
  assertWithinRoot(outPath, opts.projectRoot);
  return outPath;
}

/**
 * Writes (or previews) the docs file for a single controller.
 * Handles: create, append, skip, merge (--force), overwrite, dry-run.
 *
 * "Exists" is tracked per-CLASS, not per-file: a companion file can hold one
 * `docs(Class, {...})` call per `@Controller` class in the source file it
 * mirrors (a single file exporting several controllers is a normal
 * pattern), so a file that's on disk but doesn't yet document THIS class is
 * treated the same as a brand-new file for this class — new content gets
 * appended alongside whatever the file already documents, never dropped via
 * a full-file overwrite. Without this distinction, the 2nd/3rd controller in
 * a shared file used to be reported "already exists" the moment the 1st
 * controller's own write created the file, and `--force` would then merge
 * that controller's methods into the FIRST class's `docs()` call instead of
 * creating its own.
 */
export function writeDocsFile(ctrl: ControllerInfo, opts: WriterOptions): WriteResult {
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

  // --- DRY RUN ---
  if (opts.dryRun) {
    const content = renderDocsFile(ctrl, docsFilePath, opts.format);
    process.stdout.write(`\n${'─'.repeat(60)}\n`);
    process.stdout.write(`[dry-run] ${docsFilePath}\n`);
    process.stdout.write(`${'─'.repeat(60)}\n`);
    process.stdout.write(content);
    return { controllerClass: ctrl.className, docsFilePath, outcome: 'dry' };
  }

  let existingContent: string | null;
  try {
    existingContent = fs.readFileSync(docsFilePath, 'utf8');
  } catch {
    existingContent = null;
  }

  const classDocumented = existingContent !== null && classHasDocsCall(existingContent, ctrl.className);

  const fail = (err: unknown): WriteResult => ({
    controllerClass: ctrl.className,
    docsFilePath,
    outcome: 'error',
    error: err instanceof Error ? err.message : String(err),
  });

  // --- SKIP (this class is already documented, neither --force nor --overwrite) ---
  if (classDocumented && !opts.force && !opts.overwrite) {
    return { controllerClass: ctrl.className, docsFilePath, outcome: 'skipped' };
  }

  // --- APPEND (file exists but doesn't document this class yet — nothing to
  //     merge/overwrite FOR THIS CLASS, and a full-file overwrite here would
  //     destroy every other class already documented in the file) ---
  if (existingContent !== null && !classDocumented) {
    try {
      const appended = appendDocsCall(existingContent, ctrl, docsFilePath, opts.format);
      if (appended !== null) {
        fs.writeFileSync(docsFilePath, appended, 'utf8');
        return { controllerClass: ctrl.className, docsFilePath, outcome: 'appended' };
      }
      // Existing content unparseable — fall through to full create/overwrite below.
    } catch (err) {
      return fail(err);
    }
  }

  // --- OVERWRITE (file exists, --overwrite, this class already has a call) ---
  // A file shared with OTHER classes must only have THIS class's call
  // replaced (replaceDocsCall) — a plain full-file regenerate would destroy
  // every sibling class's docs(). A single-class file has no such risk, so
  // it keeps the simpler "regenerate the whole file from scratch" behavior
  // (including dropping any stray content outside the docs() call itself,
  // which --overwrite has always promised).
  if (existingContent !== null && classDocumented && opts.overwrite) {
    try {
      if (hasOtherClassDocsCall(existingContent, ctrl.className)) {
        const replaced = replaceDocsCall(existingContent, ctrl, docsFilePath, opts.format);
        if (replaced !== null) {
          fs.writeFileSync(docsFilePath, replaced, 'utf8');
          return { controllerClass: ctrl.className, docsFilePath, outcome: 'overwritten' };
        }
        // Existing content unparseable — fall through to full create/overwrite below.
      } else {
        const dir = path.dirname(docsFilePath);
        fs.mkdirSync(dir, { recursive: true });
        const content = renderDocsFile(ctrl, docsFilePath, opts.format);
        fs.writeFileSync(docsFilePath, content, 'utf8');
        return { controllerClass: ctrl.className, docsFilePath, outcome: 'overwritten' };
      }
    } catch (err) {
      return fail(err);
    }
  }

  // --- MERGE (file exists, --force, this class already has a call) ---
  if (existingContent !== null && classDocumented && opts.force) {
    try {
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
      return fail(err);
    }
  }

  // --- CREATE (new file, or fallback after a failed append/merge/replace) ---
  try {
    const dir = path.dirname(docsFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const content = renderDocsFile(ctrl, docsFilePath, opts.format);
    fs.writeFileSync(docsFilePath, content, 'utf8');
    return { controllerClass: ctrl.className, docsFilePath, outcome: 'created' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Writes docs files for all controllers and returns aggregated results.
 */
export function writeAllDocs(controllers: ControllerInfo[], opts: WriterOptions): WriteResult[] {
  return controllers.map((ctrl) => writeDocsFile(ctrl, opts));
}
