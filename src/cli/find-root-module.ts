import { Node, SyntaxKind, type ClassDeclaration, type Project, type SourceFile } from 'ts-morph';

export interface RootModuleLocation {
  sourceFile: SourceFile;
  classDecl: ClassDeclaration;
}

/**
 * Locates the class passed to `NestFactory.create(...)` in the app's entry
 * file and resolves it back to its own source file. Static analysis only —
 * never executes the entry file. Returns null at the first point it can't
 * follow the trail with certainty (no entry file, no `NestFactory.create`
 * call, a non-identifier argument, an unresolvable import, or a resolved
 * class without `@Module`) rather than guessing.
 */
export function findRootModule(project: Project, entryFile: string): RootModuleLocation | null {
  try {
    const mainFile = project.getSourceFile(entryFile);
    if (!mainFile) return null;

    const call = mainFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((c) => c.getExpression().getText() === 'NestFactory.create');
    if (!call) return null;

    const [firstArg] = call.getArguments();
    if (!firstArg || !Node.isIdentifier(firstArg)) return null;

    const className = firstArg.getText();
    const importDecl = mainFile
      .getImportDeclarations()
      .find((imp) => imp.getNamedImports().some((n) => n.getName() === className));
    if (!importDecl) return null;

    const targetFile = importDecl.getModuleSpecifierSourceFile();
    if (!targetFile) return null;

    const classDecl = targetFile.getClass(className);
    if (!classDecl || !classDecl.getDecorator('Module')) return null;

    return { sourceFile: targetFile, classDecl };
  } catch {
    return null;
  }
}
