import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import { evaluateDecoratorCall, DecoratorCall } from './eval-decorator-args';

export interface ExtractedDocsConfig {
  classDecorators: DecoratorCall[];
  methods: Record<string, DecoratorCall[]>;
}

/**
 * A real, disk-backed project + the docs file's absolute path — when given,
 * `extractDocsConfig` parses the file inside that project instead of an
 * isolated one, so a decorator argument that references a symbol imported
 * from another file (e.g. `enum: Role` where `Role` comes from
 * `./role.enum`) resolves for real. Callers that already scanned the
 * project's controllers (`scanApp`/`scanAllApps`) already have this project
 * sitting around with every relevant file loaded — see
 * `ScanResult.projectsByControllerPath`.
 */
export interface DocsFileProjectContext {
  project: Project;
  absolutePath: string;
}

/**
 * Statically extracts the `docs(ControllerClass, { classDecorators, methods })`
 * call from a `.controller.docs.ts` file's source text — without executing
 * it. Used to compute an OpenAPI patch directly from the file (see
 * build-openapi-patch.ts), bypassing the runtime require()/Reflect-metadata
 * pipeline entirely. That's the whole point: this works under any build
 * mode, including NestJS CLI's `webpack: true`, because it never requires
 * the file, never touches require.cache, and never needs a live reference
 * to the same class object the running app uses (see the README's "Not
 * supported: webpack: true" section for why the runtime pipeline can't).
 *
 * Without `context`, the file is parsed in an isolated in-memory project
 * with nothing else in scope — fine for the `docs(...)` call's own literal
 * structure, but a decorator argument referencing an imported symbol will
 * never resolve (see `DocsFileProjectContext`). Pass `context` to fix that.
 *
 * Returns null if the file can't be parsed or no `docs(...)` call is found.
 */
export function extractDocsConfig(sourceText: string, context?: DocsFileProjectContext): ExtractedDocsConfig | null {
  let project: Project;
  if (context) {
    project = context.project;
  } else {
    try {
      project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
    } catch {
      return null;
    }
  }

  let sf: SourceFile;
  try {
    sf = context
      ? project.createSourceFile(context.absolutePath, sourceText, { overwrite: true })
      : project.createSourceFile('docs.ts', sourceText);
  } catch {
    return null;
  }

  const docsCall = sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => {
    try {
      return call.getExpression().getText() === 'docs';
    } catch {
      return false;
    }
  });
  if (!docsCall) return null;

  const args = docsCall.getArguments();
  if (args.length < 2) return null;

  const configArg = args[1];
  if (configArg.getKind() !== SyntaxKind.ObjectLiteralExpression) return null;
  const configObj = configArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

  const classDecorators: DecoratorCall[] = [];
  const methods: Record<string, DecoratorCall[]> = {};

  for (const prop of configObj.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
    const name = pa.getName();
    const initializer = pa.getInitializer();
    if (!initializer) continue;

    if (name === 'classDecorators' && initializer.getKind() === SyntaxKind.ArrayLiteralExpression) {
      for (const el of initializer.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
        const call = evaluateDecoratorCall(el);
        if (call) classDecorators.push(call);
      }
    }

    if (name === 'methods' && initializer.getKind() === SyntaxKind.ObjectLiteralExpression) {
      for (const methodProp of initializer.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties()) {
        if (methodProp.getKind() !== SyntaxKind.PropertyAssignment) continue;
        const methodPa = methodProp.asKindOrThrow(SyntaxKind.PropertyAssignment);
        const methodName = methodPa.getName();
        const methodInit = methodPa.getInitializer();
        if (!methodInit || methodInit.getKind() !== SyntaxKind.ArrayLiteralExpression) continue;

        const calls: DecoratorCall[] = [];
        for (const el of methodInit.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
          const call = evaluateDecoratorCall(el);
          if (call) calls.push(call);
        }
        methods[methodName] = calls;
      }
    }
  }

  return { classDecorators, methods };
}
