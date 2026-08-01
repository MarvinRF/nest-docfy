import fs from 'fs';
import path from 'path';

export interface AddScriptsResult {
  /** Absolute path to the package.json that was read/written. */
  path: string;
  /** False when every desired script key was already present — nothing to do. */
  changed: boolean;
  /** Script keys actually added (empty when changed is false). */
  added: string[];
}

const DESIRED_SCRIPTS: Record<string, string> = {
  'docs:generate': 'nestjs-docfy generate',
  'docs:preview': 'nestjs-docfy generate --dry-run',
};

/**
 * Adds the `docs:generate`/`docs:preview` convenience scripts (same block
 * suggested in the README) to the workspace root's package.json. Opt-in
 * only (via `init`). Only inserts keys that don't already exist — never
 * overwrites a script the user already defined under the same name, even if
 * its command differs from ours.
 *
 * Returns null when package.json is missing or not valid JSON (nothing we
 * can safely edit). Scoped to the root package.json only — Nx/generic
 * monorepos with a per-app package.json are left for the user to wire by
 * hand, same scoping choice as `registerWebpackPlugin`'s root-only nest-cli.json edit.
 */
export function addPackageScripts(root: string, dryRun: boolean): AddScriptsResult | null {
  const pkgPath = path.join(root, 'package.json');

  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
  } catch {
    return null;
  }

  let json: { scripts?: Record<string, string>; [key: string]: unknown };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    return null;
  }

  const scripts = json.scripts ?? {};
  const added = Object.keys(DESIRED_SCRIPTS).filter((key) => !(key in scripts));

  if (added.length === 0) {
    return { path: pkgPath, changed: false, added: [] };
  }

  if (!dryRun) {
    const nextScripts = { ...scripts };
    for (const key of added) {
      nextScripts[key] = DESIRED_SCRIPTS[key];
    }
    json.scripts = nextScripts;
    fs.writeFileSync(pkgPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  }

  return { path: pkgPath, changed: true, added };
}
