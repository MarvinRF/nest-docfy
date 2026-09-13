import fs from 'fs';
import { deriveDocsFilePath } from './scan-controllers';
import { extractDocsConfig } from './extract-docs-config';
import type { ControllerInfo } from './extract-methods';

export interface CheckIssue {
  controllerClass: string;
  controllerFile: string;
  docsFile: string;
  kind: 'missing-file' | 'undocumented-methods';
  /** Populated when kind === 'undocumented-methods' */
  methods?: string[];
}

/** Only identifiers matching this are ever returned — whitelist against a crafted docs file. */
const IDENTIFIER_RE = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;

/**
 * Extracts the set of method names documented in a docs file.
 *
 * `className`, when given, scopes extraction to that specific class's
 * `docs(ClassName, {...})` call — required as soon as a companion file can
 * hold more than one call (a single source file exporting several
 * `@Controller` classes). Without it, a naive "scan the file's methods
 * block" reads only the FIRST call's methods and silently reports every
 * other class in the file as having zero documented methods, even when each
 * class's own call is complete and correct.
 */
export function getDocumentedMethods(docsFilePath: string, className?: string): Set<string> {
  let content: string;
  try {
    content = fs.readFileSync(docsFilePath, 'utf8');
  } catch {
    return new Set();
  }

  const config = extractDocsConfig(content, undefined, className);
  if (!config) return new Set();

  return new Set(Object.keys(config.methods).filter((name) => IDENTIFIER_RE.test(name)));
}

/**
 * Checks all controllers for documentation drift:
 * - Missing companion docs file
 * - HTTP methods in the controller that are not present in the docs file
 *
 * Returns an array of issues. Empty array means everything is in sync.
 */
export function checkControllers(controllers: ControllerInfo[], format: 'ts' | 'js'): CheckIssue[] {
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

    const documented = getDocumentedMethods(docsFile, ctrl.className);

    const undocumented = ctrl.methods
      .filter((m) => m.httpDecorator !== null) // only HTTP-mapped methods
      .filter((m) => IDENTIFIER_RE.test(m.name)) // only safe identifiers
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
