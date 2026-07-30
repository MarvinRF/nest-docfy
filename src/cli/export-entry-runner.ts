import * as fs from 'fs';
import * as path from 'path';

/**
 * Runs *inside* a spawned child process (see `export-spec.ts`), with
 * `ts-node`/`tsconfig-paths` already registered via `-r` flags so the entry
 * file below can be plain project TypeScript — same as the project's own
 * `main.ts`.
 *
 * Contract: the entry file's default export is an async function that
 * boots the Nest app (via `NestFactory.create`, never `.listen()`) and
 * builds the OpenAPI document (via `SwaggerModule.createDocument()`,
 * optionally patched with `applyDocfyMetadata()`), returning both so this
 * runner can serialize the document and cleanly close the app afterward.
 */
interface EntryResult {
  app: { close: () => Promise<void> };
  document: unknown;
}

async function run(): Promise<void> {
  const [, , entryPath, outPath] = process.argv;
  if (!entryPath || !outPath) {
    throw new Error('export-entry-runner requires <entryPath> <outPath> arguments.');
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod: unknown = require(path.resolve(entryPath));
  const bootstrap =
    typeof mod === 'function'
      ? (mod as () => Promise<EntryResult>)
      : (mod as { default?: () => Promise<EntryResult> }).default;
  if (typeof bootstrap !== 'function') {
    throw new Error(`${entryPath} must have a default export: an async function returning { app, document }.`);
  }

  const { app, document } = await bootstrap();
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2));
  await app.close();
  process.exit(0);
}

run().catch((err: unknown) => {
  process.stderr.write(
    `export-entry-runner failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
