import { Project, SyntaxKind, ObjectLiteralExpression } from 'ts-morph';
import type { ControllerInfo } from './extract-methods';

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

  // Find: docs(ClassName, { ... })
  const docsCall = sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => {
    try {
      const expr = call.getExpression();
      return expr.getText() === 'docs';
    } catch {
      return false;
    }
  });

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
