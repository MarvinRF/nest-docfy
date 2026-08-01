import fs from 'fs';
import { Node, QuoteKind } from 'ts-morph';
import type { RootModuleLocation } from './find-root-module';

export interface LinkRootModuleResult {
  /** Absolute path to the root module file that was read/written. */
  path: string;
  /** False when `DocfyModule.forRoot()` was already present — nothing to do. */
  changed: boolean;
}

const DOCFY_MODULE_SPECIFIER = 'nestjs-docfy';
const DOCFY_MODULE_NAME = 'DocfyModule';

/**
 * Adds `import { DocfyModule } from 'nestjs-docfy'` and `DocfyModule.forRoot()`
 * to the app's root module's `@Module({ imports: [...] })`. Opt-in only (via
 * `init`) — mutating the user's root module is a bigger deal than writing a
 * companion .docs.ts file, so this must never run silently.
 *
 * Bails out (returns null) instead of guessing whenever the `@Module`
 * argument or its `imports` property isn't a plain object/array literal it
 * can safely edit (e.g. a spread or a conditional expression).
 *
 * Note: the import-merge-or-create logic below duplicates a few lines from
 * `link-controller.ts` rather than sharing a helper — with only two call
 * sites, the project's DRY threshold ("3+ occurrences before extracting")
 * isn't met yet.
 */
export function linkRootModule(location: RootModuleLocation, dryRun: boolean): LinkRootModuleResult | null {
  try {
    const { sourceFile, classDecl } = location;
    const moduleDecorator = classDecl.getDecorator('Module');
    if (!moduleDecorator) return null;

    const [arg] = moduleDecorator.getArguments();
    if (!arg || !Node.isObjectLiteralExpression(arg)) return null;

    const importsProp = arg.getProperty('imports');

    if (importsProp) {
      if (!Node.isPropertyAssignment(importsProp)) return null;
      const initializer = importsProp.getInitializer();
      if (!initializer || !Node.isArrayLiteralExpression(initializer)) return null;

      const alreadyPresent = initializer.getElements().some((el) => el.getText().includes(`${DOCFY_MODULE_NAME}.`));
      if (alreadyPresent) {
        return { path: sourceFile.getFilePath(), changed: false };
      }

      ensureDocfyModuleImport(sourceFile);
      initializer.insertElement(0, `${DOCFY_MODULE_NAME}.forRoot()`);
    } else {
      ensureDocfyModuleImport(sourceFile);
      arg.addPropertyAssignment({ name: 'imports', initializer: `[${DOCFY_MODULE_NAME}.forRoot()]` });
    }

    if (!dryRun) {
      fs.writeFileSync(sourceFile.getFilePath(), sourceFile.getFullText(), 'utf8');
    }

    return { path: sourceFile.getFilePath(), changed: true };
  } catch {
    return null;
  }
}

function ensureDocfyModuleImport(sourceFile: RootModuleLocation['sourceFile']): void {
  const existingImport = sourceFile
    .getImportDeclarations()
    .find((imp) => imp.getModuleSpecifierValue() === DOCFY_MODULE_SPECIFIER);

  if (existingImport) {
    const hasNamedImport = existingImport.getNamedImports().some((n) => n.getName() === DOCFY_MODULE_NAME);
    if (!hasNamedImport) {
      existingImport.addNamedImport(DOCFY_MODULE_NAME);
    }
  } else {
    sourceFile.getProject().manipulationSettings.set({ quoteKind: QuoteKind.Single });
    sourceFile.addImportDeclaration({
      moduleSpecifier: DOCFY_MODULE_SPECIFIER,
      namedImports: [DOCFY_MODULE_NAME],
    });
  }
}
