import fs from 'fs';
import path from 'path';

export interface DocfyUiPinInfo {
  /** The version range the consuming app declares for `docfy-ui` in its own package.json. */
  appDeclaredRange: string;
  /** The version of `docfy-ui` that nestjs-docfy actually vendors and serves (its own private, pinned dependency). */
  servedVersion: string;
}

/**
 * Detects the case documented in friccao-backlog.md item 8: the app declares
 * `docfy-ui` directly in its own package.json, which has zero effect on the UI
 * actually served — DocfyUiModule always resolves its own pinned, private copy
 * via `require.resolve('docfy-ui/...')`. Returns null when the app doesn't
 * declare `docfy-ui` itself (nothing to warn about) or when the served version
 * can't be determined.
 */
export function checkDocfyUiPin(projectRoot: string): DocfyUiPinInfo | null {
  let appPkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    appPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch {
    return null;
  }

  const appDeclaredRange = appPkg.dependencies?.['docfy-ui'] ?? appPkg.devDependencies?.['docfy-ui'];
  if (!appDeclaredRange) return null;

  let servedVersion: string;
  try {
    // Resolves nestjs-docfy's own vendored copy — the same resolution DocfyUiModule uses.
    const pkgPath = require.resolve('docfy-ui/package.json');
    servedVersion = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  } catch {
    return null;
  }

  return { appDeclaredRange, servedVersion };
}
