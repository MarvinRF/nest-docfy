import { deriveDocsFilePath } from './scan-controllers';
import { getDocumentedMethods } from './check';
import type { ControllerInfo } from './extract-methods';

export interface CoverageReport {
  totalControllers: number;
  /** HTTP-mapped methods across all controllers */
  totalEndpoints: number;
  documentedEndpoints: number;
  missingEndpoints: number;
  /** Percentage 0–100, one decimal place. NaN when totalEndpoints === 0. */
  coveragePercent: number;
}

/**
 * Computes documentation coverage across all scanned controllers.
 * Only HTTP-mapped methods (those with an httpDecorator) are counted.
 */
export function computeCoverage(controllers: ControllerInfo[], format: 'ts' | 'js'): CoverageReport {
  let totalEndpoints = 0;
  let documentedEndpoints = 0;

  for (const ctrl of controllers) {
    const httpMethods = ctrl.methods.filter((m) => m.httpDecorator !== null);
    totalEndpoints += httpMethods.length;

    if (ctrl.hasDocsFile) {
      const docsFile = deriveDocsFilePath(ctrl.filePath, format);
      const documented = getDocumentedMethods(docsFile);
      documentedEndpoints += httpMethods.filter((m) => documented.has(m.name)).length;
    }
  }

  const missingEndpoints = totalEndpoints - documentedEndpoints;
  const coveragePercent = totalEndpoints === 0 ? NaN : Math.round((documentedEndpoints / totalEndpoints) * 1000) / 10;

  return {
    totalControllers: controllers.length,
    totalEndpoints,
    documentedEndpoints,
    missingEndpoints,
    coveragePercent,
  };
}
