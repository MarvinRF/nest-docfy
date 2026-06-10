import fs from 'fs';
import { deriveDocsFilePath } from './scan-controllers';
import type { ControllerInfo } from './extract-methods';

export interface CheckIssue {
  controllerClass: string;
  controllerFile: string;
  docsFile: string;
  kind: 'missing-file' | 'undocumented-methods';
  /** Populated when kind === 'undocumented-methods' */
  methods?: string[];
}

/**
 * Extracts the set of method names that are present in a docs file.
 * Matches the pattern used by generate-file: two-space indented keys followed by `: [`.
 * e.g.   findAll: [
 * Only identifiers matching /^[$_a-zA-Z][$_a-zA-Z0-9]*$/ are accepted.
 */
const IDENTIFIER_RE = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;
const METHOD_BLOCK_RE = /^\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s*:\s*\[/gm;

/**
 * Extracts the text inside the `methods: { ... }` block of a docs file.
 * Returns an empty string if the block is not found.
 * Uses a simple brace-counter — does not parse TypeScript, but is sufficient
 * for the generated format produced by nestjs-docfy.
 */
function extractMethodsSection(content: string): string {
  const methodsIdx = content.indexOf('methods:');
  if (methodsIdx === -1) return '';

  const braceStart = content.indexOf('{', methodsIdx);
  if (braceStart === -1) return '';

  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.slice(braceStart + 1, i);
    }
  }
  return '';
}

export function getDocumentedMethods(docsFilePath: string): Set<string> {
  let content: string;
  try {
    content = fs.readFileSync(docsFilePath, 'utf8');
  } catch {
    return new Set();
  }

  // Only scan the methods block — avoids false positives from classDecorators, etc.
  const methodsSection = extractMethodsSection(content);
  const documented = new Set<string>();
  let match: RegExpExecArray | null;
  METHOD_BLOCK_RE.lastIndex = 0;
  while ((match = METHOD_BLOCK_RE.exec(methodsSection)) !== null) {
    const name = match[1];
    // Whitelist: only valid identifiers — prevents any crafted file from
    // injecting unexpected names into the result set
    if (IDENTIFIER_RE.test(name)) {
      documented.add(name);
    }
  }
  return documented;
}

/**
 * Checks all controllers for documentation drift:
 * - Missing companion docs file
 * - HTTP methods in the controller that are not present in the docs file
 *
 * Returns an array of issues. Empty array means everything is in sync.
 */
export function checkControllers(
  controllers: ControllerInfo[],
  format: 'ts' | 'js',
): CheckIssue[] {
  const issues: CheckIssue[] = [];

  for (const ctrl of controllers) {
    const docsFile = deriveDocsFilePath(ctrl.filePath, format);

    if (!ctrl.hasDocsFile) {
      // Only report as an issue if the controller has HTTP methods worth documenting
      const hasHttpMethods = ctrl.methods.some((m) => m.httpDecorator !== null);
      if (hasHttpMethods) {
        issues.push({
          controllerClass: ctrl.className,
          controllerFile: ctrl.filePath,
          docsFile,
          kind: 'missing-file',
        });
      }
      continue;
    }

    const documented = getDocumentedMethods(docsFile);

    const undocumented = ctrl.methods
      .filter((m) => m.httpDecorator !== null)       // only HTTP-mapped methods
      .filter((m) => IDENTIFIER_RE.test(m.name))     // only safe identifiers
      .filter((m) => !documented.has(m.name))
      .map((m) => m.name);

    if (undocumented.length > 0) {
      issues.push({
        controllerClass: ctrl.className,
        controllerFile: ctrl.filePath,
        docsFile,
        kind: 'undocumented-methods',
        methods: undocumented,
      });
    }
  }

  return issues;
}
