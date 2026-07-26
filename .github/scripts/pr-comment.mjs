// Posts (or updates) a single PR comment summarizing `check --json` and
// `coverage --json` results. Plain Node + native fetch — no @actions/github
// dependency, so this workflow doesn't need its own npm install.
//
// Required env vars: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo), PR_NUMBER,
// CHECK_JSON_PATH, COVERAGE_JSON_PATH.

import { readFileSync } from 'node:fs';

const MARKER = '<!-- nestjs-docfy-pr-check -->';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function formatIssue(issue) {
  if (issue.kind === 'missing-file') {
    return `- ❌ **${issue.controllerClass}** — no companion docs file (\`${issue.docsFile}\`)`;
  }
  return `- ❌ **${issue.controllerClass}** — undocumented methods: ${issue.methods.join(', ')}`;
}

export function buildBody(check, coverage) {
  const lines = [MARKER, '## 📋 nestjs-docfy PR check', ''];

  lines.push(check.passed ? '✅ **check** — all controllers fully documented.' : '❌ **check** — drift found:');
  if (!check.passed) {
    lines.push('', ...check.issues.map(formatIssue));
  }

  lines.push('');

  const pct = coverage.coveragePercent === null ? 'n/a' : `${coverage.coveragePercent}%`;
  const minLabel = coverage.min === null ? '' : ` (min: ${coverage.min}%)`;
  lines.push(
    coverage.passed ? `✅ **coverage** — ${pct}${minLabel}` : `❌ **coverage** — ${pct}${minLabel} — below minimum.`,
  );
  lines.push(
    '',
    `<sub>${coverage.documentedEndpoints}/${coverage.totalEndpoints} endpoints documented across ${coverage.totalControllers} controller(s).</sub>`,
  );

  return lines.join('\n');
}

async function githubRequest(path, token, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  const token = requireEnv('GITHUB_TOKEN');
  const repo = requireEnv('GITHUB_REPOSITORY');
  const prNumber = requireEnv('PR_NUMBER');
  const checkPath = requireEnv('CHECK_JSON_PATH');
  const coveragePath = requireEnv('COVERAGE_JSON_PATH');

  const check = readJson(checkPath);
  const coverage = readJson(coveragePath);
  const body = buildBody(check, coverage);

  const comments = await githubRequest(`/repos/${repo}/issues/${prNumber}/comments`, token);
  const existing = comments.find((c) => c.body?.includes(MARKER));

  if (existing) {
    await githubRequest(`/repos/${repo}/issues/comments/${existing.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
    console.log(`Updated comment ${existing.id}`);
  } else {
    await githubRequest(`/repos/${repo}/issues/${prNumber}/comments`, token, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    console.log('Created new comment');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
