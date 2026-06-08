import fs from 'fs';
import path from 'path';
import { assertWithinRoot } from './parse-args';
import { ConfigNotFoundError } from './errors';

const CANDIDATES = [
  'tsconfig.build.json',
  'tsconfig.app.json',
  'tsconfig.json',
];

/**
 * Resolves the best tsconfig for a given app root, validating the result
 * stays within the project root. Throws ConfigNotFoundError if none found.
 */
export function resolveTsconfig(appRoot: string, projectRoot: string): string {
  for (const candidate of CANDIDATES) {
    const resolved = path.join(appRoot, candidate);
    try {
      assertWithinRoot(resolved, projectRoot);
    } catch {
      continue;
    }
    try {
      fs.accessSync(resolved);
      return resolved;
    } catch {
      continue;
    }
  }
  throw new ConfigNotFoundError(
    `No tsconfig found in "${appRoot}". Tried: ${CANDIDATES.join(', ')}`,
  );
}
