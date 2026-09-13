import { CallExpression, SourceFile, SyntaxKind } from 'ts-morph';

/**
 * A companion `.docs.ts` file may hold more than one `docs(Class, {...})`
 * call — one per `@Controller` class declared in the source file it mirrors
 * (a single file exporting several controllers is a common pattern, e.g. an
 * api-gateway grouping proxy controllers by domain). Every consumer that
 * parses a docs file needs to find the call for ONE specific class, not just
 * "the docs() call" (singular) — locating the first one found and assuming
 * it's the only one silently mismatches classes once a file has more than
 * one, corrupting merges and hiding real methods from `check`/`doctor`.
 *
 * Returns the call whose first argument is the identifier `className`, or
 * undefined if none matches.
 */
export function findDocsCallForClass(sf: SourceFile, className: string): CallExpression | undefined {
  return sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => {
    try {
      if (call.getExpression().getText() !== 'docs') return false;
      const args = call.getArguments();
      return args.length > 0 && args[0].getText() === className;
    } catch {
      return false;
    }
  });
}

/** The first `docs(Class, {...})` call in the file, regardless of class — used only where no specific class is known. */
export function findFirstDocsCall(sf: SourceFile): CallExpression | undefined {
  return sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => {
    try {
      return call.getExpression().getText() === 'docs';
    } catch {
      return false;
    }
  });
}

/** Every `docs(Class, {...})` call in the file, keyed by class name (first argument's text). */
export function findAllDocsCalls(sf: SourceFile): Map<string, CallExpression> {
  const result = new Map<string, CallExpression>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    try {
      if (call.getExpression().getText() !== 'docs') continue;
      const args = call.getArguments();
      if (args.length === 0) continue;
      const name = args[0].getText();
      if (!result.has(name)) result.set(name, call);
    } catch {
      continue;
    }
  }
  return result;
}
