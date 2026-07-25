import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { log } from './logger';
import { assertWithinRoot } from './parse-args';
import { PathTraversalError } from './errors';

export interface WatchOptions {
  root: string;
  pattern: string;
  onRebuild: () => void;
}

const DEBOUNCE_MS = 300;
const CONTROLLER_RE = /\.controller\.[tj]s$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.cache', 'coverage']);

/**
 * Recursively watches a directory tree for controller file changes.
 * Ignores node_modules, dist, and other build artifacts.
 * Debounces rapid sequential changes with a 300ms window.
 * Returns a cleanup function that stops all watchers.
 */
export function watchProject(opts: WatchOptions): () => void {
  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRebuild = (changedFile: string) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      log('info', `${pc.yellow('↺')} Change detected: ${path.relative(opts.root, changedFile)}`);
      opts.onRebuild();
    }, DEBOUNCE_MS);
  };

  const watchDir = (dir: string) => {
    // Safety: every directory we watch must be within root
    try {
      assertWithinRoot(dir, opts.root);
    } catch (e) {
      if (e instanceof PathTraversalError) return;
      throw e;
    }

    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, { recursive: false }, (event, filename) => {
        if (!filename) return;
        const fullPath = path.join(dir, filename);

        // Ignore non-controller files in debounce trigger but still re-watch new dirs
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const base = path.basename(fullPath);
            if (!IGNORED_DIRS.has(base)) {
              watchDir(fullPath);
            }
            return;
          }
        } catch {
          // file may have been deleted — that's a valid change event
        }

        if (CONTROLLER_RE.test(filename) || filename.endsWith('.ts')) {
          scheduleRebuild(fullPath);
        }
      });
    } catch {
      // directory may not be watchable (permissions, etc.) — skip silently
      return;
    }

    watchers.push(watcher);
  };

  // Recursively collect all non-ignored subdirectories and watch them
  const collectDirs = (dir: string) => {
    watchDir(dir);
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;
        const sub = path.join(dir, entry.name);
        try {
          assertWithinRoot(sub, opts.root);
        } catch {
          continue;
        }
        collectDirs(sub);
      }
    } catch {
      // unreadable directory — skip
    }
  };

  collectDirs(opts.root);

  log('info', `${pc.cyan('👁')}  Watching for changes in ${opts.root}…`);
  log('info', `   Press ${pc.gray('Ctrl+C')} to stop.`);

  const cleanup = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
  };

  return cleanup;
}
