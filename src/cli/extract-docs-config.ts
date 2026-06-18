import { Project, SyntaxKind } from 'ts-morph';
import { evaluateDecoratorCall, DecoratorCall } from './eval-decorator-args';

export interface ExtractedDocsConfig {
  classDecorators: DecoratorCall[];
  methods: Record<string, DecoratorCall[]>;
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
 * Returns null if the file can't be parsed or no `docs(...)` call is found.
 */
export function extractDocsConfig(sourceText: string): ExtractedDocsConfig | null {
  let project: Project;
  try {
    project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  } catch {
    return null;
  }

  let sf;
  try {
    sf = project.createSourceFile('docs.ts', sourceText);
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
