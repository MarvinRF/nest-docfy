import { Project, SourceFile, SyntaxKind, ObjectLiteralExpression, VariableStatement } from 'ts-morph';
import type { ControllerInfo } from './extract-methods';
import { findDocsCallForClass, findAllDocsCalls } from './find-docs-call';
import { renderDocsCallBlock, type RequiredImport } from './generate-file';

export interface MergeResult {
  content: string;
  addedMethods: string[];
}

/**
 * Merges newly discovered controller methods into an existing docs file.
 *
 * Strategy:
 *   - Parse the existing file via ts-morph (AST, no execution).
 *   - Find the `docs(ControllerName, { methods: { ... } })` call.
 *   - Add entries for methods that are present in `ctrl.methods` but
 *     absent as keys in the existing `methods` object.
 *   - Leave everything else untouched — user-edited decorators are preserved.
 *
 * If the existing file cannot be parsed or the `docs()` call cannot be
 * located, returns null so the caller can fall back to overwrite.
 */
export function mergeDocsFile(existingContent: string, ctrl: ControllerInfo): MergeResult | null {
  let project: Project;
  try {
    project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  } catch {
    return null;
  }

  const sf = project.createSourceFile('existing.docs.ts', existingContent);
  const addedMethods: string[] = [];

  // Find: docs(ctrl.className, { ... }) — NOT just any docs() call. A file can
  // hold one call per class (multiple @Controller classes sharing a source
  // file); matching the first one found regardless of class used to inject
  // this class's methods into a DIFFERENT class's `methods` object, which
  // then fails to type-check (see findDocsCallForClass's docstring).
  const docsCall = findDocsCallForClass(sf, ctrl.className);

  if (!docsCall) return null;

  const args = docsCall.getArguments();
  if (args.length < 2) return null;

  const configArg = args[1];
  if (configArg.getKind() !== SyntaxKind.ObjectLiteralExpression) return null;

  const configObj = configArg as ObjectLiteralExpression;

  // Find or create the `methods` property
  let methodsProp = configObj.getProperty('methods');

  if (!methodsProp) {
    // Add methods: {} if not present
    configObj.addPropertyAssignment({ name: 'methods', initializer: '{}' });
    methodsProp = configObj.getProperty('methods');
    if (!methodsProp) return null;
  }

  // Get the methods object literal
  const methodsValue = methodsProp.getChildrenOfKind(SyntaxKind.ObjectLiteralExpression)[0] as
    ObjectLiteralExpression | undefined;

  if (!methodsValue) return null;

  // Collect existing method keys (already documented)
  const existingKeys = new Set(
    methodsValue.getProperties().map((p) => {
      try {
        return p.getFirstChildByKind(SyntaxKind.Identifier)?.getText() ?? '';
      } catch {
        return '';
      }
    }),
  );

  // Add missing methods
  for (const method of ctrl.methods) {
    // Validate identifier before touching the AST
    if (!/^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(method.name)) continue;
    if (existingKeys.has(method.name)) continue;

    methodsValue.addPropertyAssignment({
      name: method.name,
      initializer: `[\n    // ApiOperation({ summary: '' }),\n    // ApiResponse({ status: 200 }),\n  ]`,
    });

    addedMethods.push(method.name);
  }

  return {
    content: sf.getFullText(),
    addedMethods,
  };
}

/**
 * True when the file has at least one `docs(...)` call for a class OTHER
 * than `className` — the condition under which a full-file overwrite would
 * destroy content that doesn't belong to the class being regenerated.
 */
export function hasOtherClassDocsCall(content: string, className: string): boolean {
  const sf = parseExistingDocsFile(content);
  if (!sf) return false;
  const calls = findAllDocsCalls(sf);
  return [...calls.keys()].some((name) => name !== className);
}

/** True when the file already has a `docs(ClassName, {...})` call for this class. */
export function classHasDocsCall(content: string, className: string): boolean {
  let project: Project;
  try {
    project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  } catch {
    return false;
  }
  try {
    const sf = project.createSourceFile('existing.docs.ts', content);
    return findDocsCallForClass(sf, className) !== undefined;
  } catch {
    return false;
  }
}

function requireSpecifierMatches(stmt: VariableStatement, moduleSpecifier: string): boolean {
  try {
    const init = stmt.getDeclarations()[0]?.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.CallExpression) return false;
    const call = init.asKindOrThrow(SyntaxKind.CallExpression);
    if (call.getExpression().getText() !== 'require') return false;
    const arg = call.getArguments()[0];
    if (!arg) return false;
    return arg.getText().replace(/^['"`]|['"`]$/g, '') === moduleSpecifier;
  } catch {
    return false;
  }
}

/** Merges the imports a new docs() call needs into `sf`'s existing ones (no duplicate named imports/requires), then appends the call text at the end. */
function insertDocsCall(
  sf: SourceFile,
  ctrl: ControllerInfo,
  docsFilePath: string,
  format: 'ts' | 'js',
): string | null {
  const { call, imports }: { call: string; imports: RequiredImport[] } = renderDocsCallBlock(ctrl, docsFilePath);

  try {
    if (format === 'ts') {
      for (const imp of imports) {
        const existing = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === imp.moduleSpecifier);
        if (existing) {
          const existingNames = new Set(existing.getNamedImports().map((ni) => ni.getName()));
          for (const name of imp.names) {
            if (!existingNames.has(name)) existing.addNamedImport(name);
          }
        } else {
          sf.addImportDeclaration({ moduleSpecifier: imp.moduleSpecifier, namedImports: imp.names });
        }
      }
    } else {
      let insertIndex = 0;
      for (const imp of imports) {
        const existing = sf.getVariableStatements().find((s) => requireSpecifierMatches(s, imp.moduleSpecifier));
        if (existing) {
          const nameNode = existing.getDeclarations()[0]?.getNameNode();
          if (nameNode?.getKind() === SyntaxKind.ObjectBindingPattern) {
            const pattern = nameNode.asKindOrThrow(SyntaxKind.ObjectBindingPattern);
            const existingNames = pattern.getElements().map((el) => el.getName());
            const missing = imp.names.filter((name) => !existingNames.includes(name));
            // ObjectBindingPattern has no element-mutation API in ts-morph —
            // rewrite the destructuring pattern's text directly instead.
            if (missing.length > 0) pattern.replaceWithText(`{ ${[...existingNames, ...missing].join(', ')} }`);
          }
        } else {
          sf.insertStatements(insertIndex, `const { ${imp.names.join(', ')} } = require('${imp.moduleSpecifier}');`);
          insertIndex++;
        }
      }
    }

    sf.addStatements(`\n${call}\n`);
    return sf.getFullText();
  } catch {
    return null;
  }
}

function parseExistingDocsFile(existingContent: string): SourceFile | null {
  let project: Project;
  try {
    project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  } catch {
    return null;
  }
  try {
    return project.createSourceFile('existing.docs.ts', existingContent);
  } catch {
    return null;
  }
}

/**
 * Appends a brand-new `docs(ctrl.className, {...})` call to a companion file
 * that already documents OTHER classes, merging the needed imports into the
 * file's existing ones instead of duplicating them (a duplicate named import
 * of the same binding, e.g. two `import { docs } from 'nestjs-docfy'`
 * statements, is a TS "Duplicate identifier" build error).
 *
 * This is what a multi-class companion file needs on its FIRST `generate`/
 * `init` run for its 2nd/3rd/... controller: that class has no docs() call
 * yet, so there's nothing to merge into (mergeDocsFile correctly returns
 * null), but the right move is adding a new call, not discarding the
 * classes already documented in the file via a full-file overwrite.
 *
 * Returns null if the existing content can't be parsed, or the class
 * already has a call (callers should check `classHasDocsCall` first).
 */
export function appendDocsCall(
  existingContent: string,
  ctrl: ControllerInfo,
  docsFilePath: string,
  format: 'ts' | 'js',
): string | null {
  const sf = parseExistingDocsFile(existingContent);
  if (!sf) return null;
  if (findDocsCallForClass(sf, ctrl.className)) return null;
  return insertDocsCall(sf, ctrl, docsFilePath, format);
}

/**
 * Regenerates ONE class's `docs(...)` call from scratch (`--overwrite`'s
 * per-class equivalent of `mergeDocsFile`'s per-class merge), leaving any
 * OTHER class's call in the same companion file untouched. Without this, a
 * plain full-file `renderDocsFile` overwrite — correct for a single-class
 * file — silently destroys every sibling class's docs() call the moment a
 * companion file documents more than one controller.
 */
export function replaceDocsCall(
  existingContent: string,
  ctrl: ControllerInfo,
  docsFilePath: string,
  format: 'ts' | 'js',
): string | null {
  const sf = parseExistingDocsFile(existingContent);
  if (!sf) return null;

  const existingCall = findDocsCallForClass(sf, ctrl.className);
  if (existingCall) {
    const stmt = existingCall.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
    if (!stmt) return null; // not a plain top-level `docs(...)` statement — unsafe to remove
    try {
      stmt.remove();
    } catch {
      return null;
    }
  }

  return insertDocsCall(sf, ctrl, docsFilePath, format);
}
