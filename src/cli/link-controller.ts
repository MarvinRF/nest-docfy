import fs from 'fs';
import { QuoteKind, type Project } from 'ts-morph';
import type { ControllerInfo } from './extract-methods';

export interface LinkControllerResult {
  /** Absolute path to the controller file that was read/written. */
  path: string;
  /** False when @WithDocs() was already present — nothing to do. */
  changed: boolean;
}

const WITH_DOCS_MODULE = 'nestjs-docfy';
const WITH_DOCS_NAME = 'WithDocs';

/**
 * Adds `import { WithDocs } from 'nestjs-docfy'` and `@WithDocs()` to a
 * controller class. Opt-in only (--link-controller) — mutating a user's
 * controller source is a bigger deal than writing a companion .docs.ts file,
 * so this must never run silently.
 *
 * Reuses the ts-morph `Project` that already scanned this controller (see
 * `ScanResult.projectsByControllerPath`) instead of reparsing — the edit
 * happens on the exact same AST that produced `ControllerInfo`.
 *
 * Returns null when the source file or class can't be located in the
 * project (nothing we can safely edit).
 */
export function linkController(ctrl: ControllerInfo, project: Project, dryRun: boolean): LinkControllerResult | null {
  try {
    const sourceFile = project.getSourceFile(ctrl.filePath);
    if (!sourceFile) return null;

    const classDecl = sourceFile.getClass(ctrl.className);
    if (!classDecl) return null;

    const alreadyLinked = classDecl.getDecorators().some((d) => d.getName() === WITH_DOCS_NAME);
    if (alreadyLinked) {
      return { path: ctrl.filePath, changed: false };
    }

    const existingImport = sourceFile
      .getImportDeclarations()
      .find((imp) => imp.getModuleSpecifierValue() === WITH_DOCS_MODULE);

    if (existingImport) {
      const hasNamedImport = existingImport.getNamedImports().some((n) => n.getName() === WITH_DOCS_NAME);
      if (!hasNamedImport) {
        existingImport.addNamedImport(WITH_DOCS_NAME);
      }
    } else {
      // Match the codebase's single-quote convention for newly inserted nodes;
      // ts-morph defaults to double quotes otherwise.
      project.manipulationSettings.set({ quoteKind: QuoteKind.Single });
      sourceFile.addImportDeclaration({
        moduleSpecifier: WITH_DOCS_MODULE,
        namedImports: [WITH_DOCS_NAME],
      });
    }

    classDecl.insertDecorator(0, { name: WITH_DOCS_NAME, arguments: [] });

    if (!dryRun) {
      fs.writeFileSync(ctrl.filePath, sourceFile.getFullText(), 'utf8');
    }

    return { path: ctrl.filePath, changed: true };
  } catch {
    return null;
  }
}
