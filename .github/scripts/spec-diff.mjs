// Diffs two OpenAPI documents (base branch vs. PR head) and writes a JSON
// summary for pr-comment.mjs to render. Uses docfy-core's normalizeDocument +
// diffDocuments — the same document model / diff logic the `docfy-ui`
// "Compare specs" page uses, just run headlessly in CI.
//
// Required env vars: OLD_SPEC_PATH, NEW_SPEC_PATH, DIFF_JSON_PATH.

import { normalizeDocument, diffDocuments } from 'docfy-core';
import { writeFileSync } from 'node:fs';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main() {
  const oldSpecPath = requireEnv('OLD_SPEC_PATH');
  const newSpecPath = requireEnv('NEW_SPEC_PATH');
  const diffJsonPath = requireEnv('DIFF_JSON_PATH');

  const [oldModel, newModel] = await Promise.all([normalizeDocument(oldSpecPath), normalizeDocument(newSpecPath)]);
  const diff = diffDocuments(oldModel, newModel);

  const breakingCount = diff.changed.reduce(
    (n, c) => n + c.changes.filter((ch) => ch.severity === 'breaking').length,
    0,
  );

  writeFileSync(diffJsonPath, JSON.stringify({ ...diff, breakingCount }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
