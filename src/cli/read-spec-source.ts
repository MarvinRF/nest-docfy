import * as fs from 'fs';
import { resolveAndValidate } from './parse-args';
import { CliError, CliExitCode } from './errors';
import type { OpenApiDocument } from './merge-spec-patch';

/**
 * Resolves `--spec` — a local file path or an `http(s)://` URL — into a
 * parsed OpenAPI document. Shared by `patch-spec` and `generate-client` so
 * both accept the exact same "path-or-url" convention.
 */
export async function readSpecSource(source: string, root: string): Promise<OpenApiDocument> {
  let text: string;
  if (/^https?:\/\//.test(source)) {
    const fetchFn = (globalThis as any).fetch as
      undefined | ((url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>);
    if (!fetchFn) {
      throw new CliError(
        'Fetching --spec from a URL requires a Node version with global fetch (Node 18+).',
        CliExitCode.Fatal,
      );
    }
    const res = await fetchFn(source);
    if (!res.ok) {
      throw new CliError(`Failed to fetch --spec from ${source}: HTTP ${res.status}`, CliExitCode.Fatal);
    }
    text = await res.text();
  } else {
    const resolved = resolveAndValidate(source, root, '--spec');
    try {
      text = fs.readFileSync(resolved, 'utf8');
    } catch (err) {
      throw new CliError(
        `Could not read --spec file at ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
        CliExitCode.Fatal,
      );
    }
  }

  try {
    return JSON.parse(text) as OpenApiDocument;
  } catch (err) {
    throw new CliError(
      `--spec did not contain valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      CliExitCode.Fatal,
    );
  }
}
