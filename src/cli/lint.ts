import { Project, SyntaxKind } from 'ts-morph';
import type { CallExpression, ObjectLiteralExpression, PropertyAssignment, ArrayLiteralExpression } from 'ts-morph';
import { deriveDocsFilePath } from './scan-controllers';
import type { ControllerInfo } from './extract-methods';

const IDENTIFIER_RE = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;

export type LintRule = 'missing-summary' | 'missing-400-response' | 'missing-body-description';

export interface LintIssue {
  controllerClass: string;
  controllerFile: string;
  method: string;
  route: string;
  rule: LintRule;
  message: string;
}

interface MethodDocsInfo {
  hasSummary: boolean;
  responseStatuses: Set<number>;
  hasApiBody: boolean;
  hasBodyDescription: boolean;
}

function getObjectLiteralArgAt(call: CallExpression, index: number): ObjectLiteralExpression | null {
  try {
    const args = call.getArguments();
    if (args.length <= index) return null;
    const arg = args[index];
    if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) return arg as ObjectLiteralExpression;
    return null;
  } catch {
    return null;
  }
}

function getNumericProperty(obj: ObjectLiteralExpression, name: string): number | null {
  try {
    const prop = obj.getProperty(name);
    if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) return null;
    const init = (prop as PropertyAssignment).getInitializer();
    if (!init) return null;
    const val = Number(init.getText());
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

/**
 * Parses a docs file's `docs(Controller, { methods: { ... } })` call via AST
 * (not regex) to inspect actual decorator arguments — needed to check for
 * `summary`, `status`, and `description` properties rather than just names.
 */
export function parseDocsFileMethods(docsFilePath: string): Map<string, MethodDocsInfo> {
  const result = new Map<string, MethodDocsInfo>();

  let project: Project;
  try {
    project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
    });
  } catch {
    return result;
  }

  let sourceFile;
  try {
    sourceFile = project.addSourceFileAtPath(docsFilePath);
  } catch {
    return result;
  }

  try {
    const docsCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
      try {
        return c.getExpression().getText() === 'docs';
      } catch {
        return false;
      }
    });

    for (const docsCall of docsCalls) {
      const configArg = getObjectLiteralArgAt(docsCall, 1);
      if (!configArg) continue;

      const methodsProp = configArg.getProperty('methods');
      if (!methodsProp || methodsProp.getKind() !== SyntaxKind.PropertyAssignment) continue;

      const methodsInit = (methodsProp as PropertyAssignment).getInitializer();
      if (!methodsInit || methodsInit.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

      for (const prop of (methodsInit as ObjectLiteralExpression).getProperties()) {
        if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
        const pa = prop as PropertyAssignment;

        let name: string;
        try {
          name = pa.getName();
        } catch {
          continue;
        }
        if (!IDENTIFIER_RE.test(name)) continue;

        const init = pa.getInitializer();
        if (!init || init.getKind() !== SyntaxKind.ArrayLiteralExpression) continue;

        const info: MethodDocsInfo = {
          hasSummary: false,
          responseStatuses: new Set(),
          hasApiBody: false,
          hasBodyDescription: false,
        };

        for (const el of (init as ArrayLiteralExpression).getElements()) {
          if (el.getKind() !== SyntaxKind.CallExpression) continue;
          const callEl = el as CallExpression;

          let calleeName: string;
          try {
            calleeName = callEl.getExpression().getText();
          } catch {
            continue;
          }

          const objArg = getObjectLiteralArgAt(callEl, 0);

          if (calleeName === 'ApiOperation') {
            if (objArg?.getProperty('summary')) info.hasSummary = true;
          } else if (calleeName === 'ApiResponse') {
            if (objArg) {
              const status = getNumericProperty(objArg, 'status');
              if (status !== null) info.responseStatuses.add(status);
            }
          } else if (calleeName === 'ApiBody') {
            info.hasApiBody = true;
            if (objArg?.getProperty('description')) info.hasBodyDescription = true;
          }
        }

        result.set(name, info);
      }
    }
  } catch {
    // best-effort — return whatever was collected before the failure
  }

  return result;
}

function buildRoute(httpDecorator: string, controllerPath: string | null, httpPath: string | null): string {
  const base = controllerPath ? controllerPath.replace(/^\/+|\/+$/g, '') : '';
  const sub = httpPath ? httpPath.replace(/^\/+|\/+$/g, '') : '';
  const combined = [base, sub].filter(Boolean).join('/');
  return `${httpDecorator.toUpperCase()} /${combined}`;
}

/**
 * Checks documentation quality for already-documented HTTP methods:
 * - Missing `summary` in `ApiOperation`
 * - Missing `400` response for endpoints that accept a request body
 * - Missing `description` on `ApiBody` for endpoints that accept a request body
 *
 * Controllers with no companion docs file, and methods not yet present in
 * the docs file, are skipped — those are reported by the `check` command.
 */
export function lintControllers(controllers: ControllerInfo[], format: 'ts' | 'js'): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const ctrl of controllers) {
    if (!ctrl.hasDocsFile) continue;

    const docsFile = deriveDocsFilePath(ctrl.filePath, format);
    const docsInfo = parseDocsFileMethods(docsFile);

    for (const m of ctrl.methods) {
      if (m.httpDecorator === null) continue;
      if (!IDENTIFIER_RE.test(m.name)) continue;

      const info = docsInfo.get(m.name);
      if (!info) continue;

      const route = buildRoute(m.httpDecorator, ctrl.controllerPath, m.httpPath);
      const hasBody = m.params.some((p) => p.nestDecorator === '@Body');

      if (!info.hasSummary) {
        issues.push({
          controllerClass: ctrl.className,
          controllerFile: ctrl.filePath,
          method: m.name,
          route,
          rule: 'missing-summary',
          message: 'Missing operation summary',
        });
      }

      if (hasBody) {
        if (!info.responseStatuses.has(400)) {
          issues.push({
            controllerClass: ctrl.className,
            controllerFile: ctrl.filePath,
            method: m.name,
            route,
            rule: 'missing-400-response',
            message: 'Missing 400 response',
          });
        }

        if (!info.hasApiBody || !info.hasBodyDescription) {
          issues.push({
            controllerClass: ctrl.className,
            controllerFile: ctrl.filePath,
            method: m.name,
            route,
            rule: 'missing-body-description',
            message: 'Missing request body description',
          });
        }
      }
    }
  }

  return issues;
}
