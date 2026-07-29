import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CliError, CliExitCode } from './errors';

export interface ExportSpecOptions {
  /** Path to the user-authored entry file (see export-entry-runner.ts's contract). */
  entry: string;
  /** Project root — where `ts-node`/`tsconfig-paths` are resolved from. */
  root: string;
  /** Where to write the OpenAPI document. Written to a temp file and read back when omitted. */
  out?: string;
}

export interface ExportSpecResult {
  document: unknown;
  outPath: string | undefined;
}

/**
 * Boots the target project's own Nest app (via a small entry file the user
 * writes, mirroring their `main.ts` minus `.listen()`) in a child process
 * and captures the OpenAPI document it produces.
 *
 * This needs an actual `NestFactory.create()` — `SwaggerModule.createDocument()`
 * introspects real controller/DTO metadata, which only exists once Nest's DI
 * container has resolved everything. It does *not* need `.listen()` (no port
 * bound), and in practice doesn't need live infrastructure either as long as
 * the project's external clients (DB/Redis/Kafka/...) connect lazily rather
 * than blocking bootstrap — most NestJS setups do. Projects with an eager,
 * hard-failing connection in a provider's constructor/`onModuleInit` won't
 * benefit from skipping infra this way; nothing here can fix that from the
 * outside.
 *
 * Runs in a spawned child process (not spawned from PARENT `dist/cli/index.js`
 * directly) because it needs `ts-node`/`tsconfig-paths` registered via `-r`
 * flags before the entry file loads — that has to happen before any module
 * resolution in that process, which isn't possible by `require()`-ing into
 * the current one.
 */
export function exportSpec(options: ExportSpecOptions): ExportSpecResult {
  const entryPath = path.resolve(options.root, options.entry);
  if (!fs.existsSync(entryPath)) {
    throw new CliError(`--entry file not found: ${entryPath}`, CliExitCode.Fatal);
  }

  const isTs = entryPath.endsWith('.ts');
  const registerFlags: string[] = [];
  if (isTs) {
    const tsNodePath = resolveFromProject('ts-node/register/transpile-only', options.root);
    if (!tsNodePath) {
      throw new CliError(
        'A .ts --entry file requires ts-node as a devDependency of your project (npm i -D ts-node).',
        CliExitCode.Fatal,
      );
    }
    registerFlags.push('-r', tsNodePath);

    const tsconfigPathsPath = resolveFromProject('tsconfig-paths/register', options.root);
    if (tsconfigPathsPath) registerFlags.push('-r', tsconfigPathsPath);
  }

  // Resolved from package.json rather than __dirname: __dirname tracks the
  // *calling* file's own location, which is `dist/cli` for the real,
  // installed CLI but `src/cli` under ts-jest (this file's tests run
  // against TS source directly) — the runner only ever exists compiled, in
  // dist/cli, regardless of which one is running.
  const packageRoot = path.dirname(require.resolve('../../package.json'));
  const runnerPath = path.join(packageRoot, 'dist', 'cli', 'export-entry-runner.js');
  const outPath = options.out ? path.resolve(options.root, options.out) : tempOutPath();

  // stdout is deliberately NOT inherited: the document itself may be printed
  // to *this* process's stdout afterward (when --out is omitted), and
  // anything the child's own Nest app logs (even with `logger: false` —
  // DocfyModule logs some things unconditionally) would otherwise corrupt
  // that output for anyone piping it straight to a file.
  const result = spawnSync(process.execPath, [...registerFlags, runnerPath, entryPath, outPath], {
    cwd: options.root,
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error) {
    throw new CliError(`export --entry ${options.entry} failed to start: ${result.error.message}`, CliExitCode.Fatal);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim();
    throw new CliError(
      `export --entry ${options.entry} exited with code ${result.status ?? result.signal ?? 'unknown'}.` +
        (detail ? `\n${detail}` : ''),
      CliExitCode.Fatal,
    );
  }

  const raw = fs.readFileSync(outPath, 'utf8');
  if (!options.out) fs.rmSync(outPath, { force: true });

  return { document: JSON.parse(raw) as unknown, outPath: options.out ? outPath : undefined };
}

function resolveFromProject(specifier: string, root: string): string | undefined {
  try {
    return require.resolve(specifier, { paths: [root] });
  } catch {
    return undefined;
  }
}

function tempOutPath(): string {
  return path.join(os.tmpdir(), `nestjs-docfy-export-${process.pid}-${Date.now()}.json`);
}
