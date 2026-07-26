import fs from 'fs';
import path from 'path';
import { pluginListHasDocfy } from './detect-project';

export interface RegisterPluginResult {
  /** Absolute path to the nest-cli.json that was read/written. */
  path: string;
  /** False when the plugin was already registered — nothing to do. */
  changed: boolean;
}

/**
 * Adds "nestjs-docfy" to compilerOptions.plugins in the target project's
 * nest-cli.json. Opt-in only (--register-plugin) — some users deliberately
 * prefer patch-spec over a compiler plugin, so this must never run silently.
 *
 * Returns null when nest-cli.json is missing or not valid JSON (nothing we
 * can safely edit). Rewrites the file with 2-space indentation; comments or
 * unusual formatting in the original file are not preserved.
 */
export function registerWebpackPlugin(root: string, dryRun: boolean): RegisterPluginResult | null {
  const nestCliPath = path.join(root, 'nest-cli.json');

  let raw: string;
  try {
    raw = fs.readFileSync(nestCliPath, 'utf8');
  } catch {
    return null;
  }

  let json: { compilerOptions?: { plugins?: unknown[]; [key: string]: unknown }; [key: string]: unknown };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    return null;
  }

  const compilerOptions = json.compilerOptions ?? {};
  const plugins = Array.isArray(compilerOptions.plugins) ? compilerOptions.plugins : [];

  if (pluginListHasDocfy(plugins)) {
    return { path: nestCliPath, changed: false };
  }

  if (!dryRun) {
    json.compilerOptions = { ...compilerOptions, plugins: [...plugins, 'nestjs-docfy'] };
    fs.writeFileSync(nestCliPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  }

  return { path: nestCliPath, changed: true };
}
