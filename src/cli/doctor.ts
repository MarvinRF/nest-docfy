import { detectProject, projectsWithWebpackWithoutPlugin, projectsWithInertSwcPlugin } from './detect-project';
import { scanAllApps, type ScanError } from './scan-controllers';
import { checkControllers, type CheckIssue } from './check';
import { checkDocfyUiPin, type DocfyUiPinInfo } from './docfy-ui-pin-check';
import { checkDocsVersionDrift, type DocsVersionDrift } from './docs-version-check';
import type { ProjectContext } from './project-types';

export interface DoctorReport {
  project: ProjectContext;
  controllersScanned: number;
  scanErrors: ScanError[];
  controllerIssues: CheckIssue[];
  docfyUiPin: DocfyUiPinInfo | null;
  versionDrift: DocsVersionDrift[];
  webpackMissingPlugin: string[];
  inertSwcPlugin: string[];
}

export interface RunDoctorOptions {
  tsconfig?: string;
  pattern: string;
  format: 'ts' | 'js';
  currentVersion: string;
}

/**
 * Runs every diagnostic nestjs-docfy knows how to run, across all of them at once.
 * Consolidates checks otherwise split between `check` (controller/docs drift,
 * docfy-ui pin, version drift) and the `generate`/`init` pipeline (webpack/SWC
 * plugin misconfiguration) — the latter two are otherwise invisible to a user
 * who only runs `check`. Pure — does not print anything, callers own the report.
 */
export function runDoctor(root: string, options: RunDoctorOptions): DoctorReport {
  const project = detectProject(root, options.tsconfig);
  const scanResult = scanAllApps(
    project.apps,
    project.root,
    options.pattern !== '**/*.controller.ts' ? options.pattern : undefined,
    options.format,
  );

  return {
    project,
    controllersScanned: scanResult.controllers.length,
    scanErrors: scanResult.errors,
    controllerIssues: checkControllers(scanResult.controllers, options.format),
    docfyUiPin: checkDocfyUiPin(root),
    versionDrift: checkDocsVersionDrift(scanResult.controllers, options.format, options.currentVersion),
    webpackMissingPlugin: projectsWithWebpackWithoutPlugin(project.root),
    inertSwcPlugin: projectsWithInertSwcPlugin(project.root),
  };
}

/** True when none of the diagnostics found anything to report. */
export function isDoctorReportClean(report: DoctorReport): boolean {
  return (
    report.scanErrors.length === 0 &&
    report.controllerIssues.length === 0 &&
    report.docfyUiPin === null &&
    report.versionDrift.length === 0 &&
    report.webpackMissingPlugin.length === 0 &&
    report.inertSwcPlugin.length === 0
  );
}
