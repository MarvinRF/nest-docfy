import fs from 'fs';
import path from 'path';
import { Project } from 'ts-morph';
import { assertWithinRoot } from './parse-args';
import { extractMethods, extractControllerPath, ControllerInfo } from './extract-methods';
import type { ProjectApp } from './project-types';

export interface ScanResult {
  controllers: ControllerInfo[];
  errors: ScanError[];
}

export interface ScanError {
  file: string;
  message: string;
}

/**
 * Resolves a real path safely, returning null on any error (broken symlink, etc.).
 */
function safeRealpath(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Returns true if a file path points to a generated/dist file that should
 * be excluded from scanning.
 */
function isGeneratedFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized.includes('/dist/') ||
    normalized.includes('/node_modules/') ||
    filePath.endsWith('.d.ts') ||
    filePath.endsWith('.js')
  );
}

/**
 * Derives the expected docs file path from a controller file path.
 * e.g. users.controller.ts → users.controller.docs.ts
 */
export function deriveDocsFilePath(controllerPath: string, format: 'ts' | 'js'): string {
  const ext = path.extname(controllerPath);
  const base = controllerPath.slice(0, -ext.length);
  return `${base}.docs.${format}`;
}

/**
 * Scans all controllers for a single app using static analysis only (ts-morph).
 * Never executes any user code.
 */
export function scanApp(
  app: ProjectApp,
  projectRoot: string,
  patternOverride: string | undefined,
  format: 'ts' | 'js',
): ScanResult {
  const controllers: ControllerInfo[] = [];
  const errors: ScanError[] = [];

  let project: Project;
  try {
    project = new Project({
      tsConfigFilePath: app.tsconfig,
      skipAddingFilesFromTsConfig: false,
      skipFileDependencyResolution: true,
    });
  } catch (err) {
    errors.push({
      file: app.tsconfig,
      message: `Failed to load tsconfig: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { controllers, errors };
  }

  // Determine which source files to scan
  const glob = patternOverride ?? app.controllerGlob;
  let sourceFiles = project.getSourceFiles();

  // Filter to files matching the controller glob pattern
  sourceFiles = sourceFiles.filter((sf) => {
    const filePath = sf.getFilePath();

    // Skip generated files unconditionally
    if (isGeneratedFile(filePath)) return false;

    // Validate the real path stays within the project root (symlink protection)
    const real = safeRealpath(filePath);
    if (!real) return false;
    try {
      assertWithinRoot(real, projectRoot);
    } catch {
      return false;
    }

    // Match against controller naming convention
    const baseName = path.basename(filePath);
    if (glob === '**/*.controller.ts') {
      return baseName.endsWith('.controller.ts') && !baseName.endsWith('.docs.ts');
    }

    // For custom globs, apply simple basename pattern match
    const pattern = path.basename(glob).replace(/\*/g, '.*');
    return new RegExp(pattern).test(baseName);
  });

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath();

    try {
      const classes = sf.getClasses();

      for (const cls of classes) {
        // Only process classes decorated with @Controller
        const hasController = cls.getDecorators().some((d) => {
          try { return d.getName() === 'Controller'; } catch { return false; }
        });
        if (!hasController) continue;

        const className = cls.getName();
        if (!className) continue;

        const controllerPath = extractControllerPath(cls);
        const methods = extractMethods(cls);

        const docsFilePath = deriveDocsFilePath(filePath, format);
        const hasDocsFile = (() => {
          try { fs.accessSync(docsFilePath); return true; } catch { return false; }
        })();

        controllers.push({
          className,
          filePath,
          controllerPath,
          methods,
          hasDocsFile,
        });
      }
    } catch (err) {
      errors.push({
        file: filePath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { controllers, errors };
}

/**
 * Scans all apps in a project context and merges results.
 */
export function scanAllApps(
  apps: ProjectApp[],
  projectRoot: string,
  patternOverride: string | undefined,
  format: 'ts' | 'js',
): ScanResult {
  const allControllers: ControllerInfo[] = [];
  const allErrors: ScanError[] = [];

  for (const app of apps) {
    const result = scanApp(app, projectRoot, patternOverride, format);
    allControllers.push(...result.controllers);
    allErrors.push(...result.errors);
  }

  return { controllers: allControllers, errors: allErrors };
}
