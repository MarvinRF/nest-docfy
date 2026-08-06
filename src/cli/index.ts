#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { Project } from 'ts-morph';
import pc from 'picocolors';
import { parseAndValidateOptions, resolveAndValidate, type CliOptions } from './parse-args';
import { setQuiet, log, header, summary } from './logger';
import { CliError, CliExitCode } from './errors';
import { detectProject, projectsWithWebpackWithoutPlugin, projectsWithInertSwcPlugin } from './detect-project';
import { registerWebpackPlugin } from './register-webpack-plugin';
import { linkController } from './link-controller';
import { findRootModule } from './find-root-module';
import { linkRootModule } from './link-root-module';
import { addPackageScripts } from './add-package-scripts';
import { scanAllApps } from './scan-controllers';
import { writeAllDocs } from './writer';
import { watchProject } from './watch';
import { checkControllers } from './check';
import { checkDocfyUiPin } from './docfy-ui-pin-check';
import { computeCoverage } from './coverage';
import { lintControllers } from './lint';
import { computePatchedDocument } from './patch-spec';
import { exportSpec } from './export-spec';
import { readSpecSource } from './read-spec-source';
import type { OpenApiDocument } from './merge-spec-patch';
import { buildMockApp } from './mock';
import { runContractTests } from './contract-test';
import { lintSpec, normalizeDocument } from 'docfy-core';
import { checkDocsVersionDrift } from './docs-version-check';
import { runDoctor, isDoctorReportClean } from './doctor';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PACKAGE_VERSION = (require('../../package.json') as { version: string }).version;

const program = new Command();

program
  .name('nestjs-docfy')
  .description('Generate companion docs files for NestJS controllers')
  .version(PACKAGE_VERSION, '-v, --version');

// ---------------------------------------------------------------------------
// Shared pipeline: detect → scan → write
// Returns number of errors (0 = success).
// ---------------------------------------------------------------------------

function runPipeline(options: CliOptions, silent = false): number {
  const context = detectProject(options.root, options.tsconfig);

  if (!silent) {
    const kindLabel: Record<typeof context.kind, string> = {
      simple: 'Simple project',
      nx: 'NX Monorepo',
      'nest-cli-monorepo': 'Nest CLI Monorepo',
      'generic-monorepo': 'Generic Monorepo',
    };
    log(
      'success',
      `Project type: ${kindLabel[context.kind]} (${context.apps.length} app${context.apps.length !== 1 ? 's' : ''})`,
    );

    const webpackAffected = projectsWithWebpackWithoutPlugin(context.root);
    if (webpackAffected.length > 0) {
      // Per-project compilerOptions overrides (@nestjs/cli monorepos) can't be
      // safely auto-fixed at the root — registerWebpackPlugin() only ever
      // writes the root compilerOptions.plugins array, which wouldn't help a
      // project that overrides "plugins" itself. Only auto-register for the
      // simple, single-config case (the '' sentinel below).
      if (options.registerPlugin && webpackAffected.length === 1 && webpackAffected[0] === '') {
        const result = registerWebpackPlugin(context.root, options.dryRun);
        if (result?.changed) {
          log(
            options.dryRun ? 'dry' : 'success',
            `${options.dryRun ? 'Would register' : 'Registered'} ${pc.cyan('nestjs-docfy')} under compilerOptions.plugins in ${result.path}`,
          );
        }
      } else {
        const where =
          webpackAffected[0] === '' ? '' : ` in project(s) ${webpackAffected.map((n) => pc.cyan(n)).join(', ')}`;
        log(
          'warn',
          `This project builds with "webpack": true${where}, so @WithDocs()/DocfyModule runtime discovery does not work in that mode. Register ${pc.cyan('nestjs-docfy')} under compilerOptions.plugins in nest-cli.json (see the "webpack-cli-plugin" guide)${webpackAffected[0] === '' ? `, run ${pc.cyan('generate --register-plugin')} to do it automatically,` : ''} or use ${pc.cyan('patch-spec')} instead.` +
            (options.linkController
              ? ` Note: ${pc.cyan('--link-controller')} will still add @WithDocs() to your controllers, but it will be inert at runtime until the plugin is registered.`
              : ''),
        );
      }
    }

    const swcAffected = projectsWithInertSwcPlugin(context.root);
    if (swcAffected.length > 0) {
      const where = swcAffected[0] === '' ? '' : ` in project(s) ${swcAffected.map((n) => pc.cyan(n)).join(', ')}`;
      log(
        'warn',
        `This project registers ${pc.cyan('nestjs-docfy')} under compilerOptions.plugins while building with the SWC builder${where} — @nestjs/cli only runs a plugin's build-time metadata generation under SWC when ${pc.cyan('"typeCheck": true')} is also set in compilerOptions (SWC does no type-checking of its own otherwise, so the plugin never gets invoked: silently, no error, no docfy-metadata.json, applyDocfyMetadata() has nothing to merge). This is unrelated to webpack: true. Set ${pc.cyan('"typeCheck": true')} to make the plugin work under SWC (the same setting @nestjs/swagger's own SWC support already requires), or use @WithDocs()/DocfyModule.forRoot() (the runtime discovery mechanism, which works under SWC regardless) instead.`,
      );
    }
  }

  const scanResult = scanAllApps(
    context.apps,
    context.root,
    options.pattern !== '**/*.controller.ts' ? options.pattern : undefined,
    options.format,
  );

  for (const err of scanResult.errors) {
    log('error', `${err.file}: ${err.message}`);
  }

  if (scanResult.controllers.length === 0 && scanResult.errors.length === 0) {
    if (!silent) log('warn', 'No controllers found matching the pattern.');
    return 0;
  }

  const writeResults = writeAllDocs(scanResult.controllers, {
    projectRoot: context.root,
    outDir: options.out,
    force: options.force,
    overwrite: options.overwrite,
    dryRun: options.dryRun,
    format: options.format,
  });

  let created = 0,
    skipped = 0,
    errors = scanResult.errors.length;

  for (const r of writeResults) {
    switch (r.outcome) {
      case 'created':
        log('success', `${r.controllerClass} → ${r.docsFilePath}  ${pc.green('[created]')}`);
        created++;
        break;
      case 'merged':
        log(
          'success',
          `${r.controllerClass} → ${r.docsFilePath}  ${pc.cyan('[merged]')}${r.addedMethods?.length ? ` (+${r.addedMethods.join(', ')})` : ''}`,
        );
        created++;
        break;
      case 'overwritten':
        log('success', `${r.controllerClass} → ${r.docsFilePath}  ${pc.yellow('[overwritten]')}`);
        created++;
        break;
      case 'skipped':
        log('skip', `${r.controllerClass} → ${r.docsFilePath}  ${pc.gray('[skipped: already exists]')}`);
        skipped++;
        break;
      case 'dry':
        break;
      case 'error':
        log('error', `${r.controllerClass}: ${r.error}`);
        errors++;
        break;
    }
  }

  if (options.linkController) {
    for (const ctrl of scanResult.controllers) {
      const project = scanResult.projectsByControllerPath.get(ctrl.filePath);
      if (!project) continue;

      const result = linkController(ctrl, project, options.dryRun);
      if (!result) {
        log('error', `${ctrl.className}: could not locate class in AST to link`);
        errors++;
        continue;
      }

      if (result.changed) {
        log(
          options.dryRun ? 'dry' : 'success',
          `${ctrl.className} → ${pc.cyan('@WithDocs()')} ${options.dryRun ? 'would be added' : 'added'} to ${result.path}`,
        );
      } else {
        log('skip', `${ctrl.className} → ${pc.gray('[already linked]')}`);
      }
    }
  }

  if (!options.dryRun && !silent) {
    summary(created, skipped, errors);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// generate command
// ---------------------------------------------------------------------------

program
  .command('generate')
  .description('Scan controllers and generate *.controller.docs.ts files')
  .option('--root <path>', 'Project root directory', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected if omitted)')
  .option('--pattern <glob>', 'Glob pattern to find controllers', '**/*.controller.ts')
  .option('--out <path>', 'Output directory for generated files (default: alongside each controller)')
  .option('--force', 'Overwrite existing docs files (merges new methods, preserves existing)', false)
  .option(
    '--overwrite',
    'Discard existing docs file content and regenerate it from scratch (takes precedence over --force)',
    false,
  )
  .option('--dry-run', 'Print what would be generated without writing files', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .option('--format <format>', 'Output format: ts or js', 'ts')
  .option('--watch', 'Re-generate on controller file changes', false)
  .option(
    '--register-plugin',
    'If webpack:true is set without the CLI plugin, add nestjs-docfy to nest-cli.json compilerOptions.plugins',
    false,
  )
  .option(
    '--link-controller',
    'Insert @WithDocs() into each controller automatically (opt-in, mutates controller source)',
    false,
  )
  .action(async (rawOpts: Record<string, unknown>) => {
    try {
      const options = parseAndValidateOptions(rawOpts as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(options.quiet);

      if (options.dryRun) {
        header(`${pc.cyan('[DRY RUN]')} nestjs-docfy generate`);
      } else {
        header('nestjs-docfy generate');
      }

      log('info', `Root: ${options.root}`);
      log('info', `Pattern: ${options.pattern}`);
      log('info', `Format: ${options.format}`);
      if (options.tsconfig) log('info', `Tsconfig: ${options.tsconfig}`);
      if (options.overwrite)
        log('warn', 'Overwrite mode: existing docs file content will be discarded and regenerated.');
      else if (options.force) log('warn', 'Force mode: new methods merged, existing decorators preserved.');
      if (options.dryRun) log('dry', 'Dry-run mode: no files will be written.');
      if (options.watch) log('info', 'Watch mode enabled.');

      // Initial run
      const initialErrors = runPipeline(options);

      if (!options.watch) {
        process.exit(initialErrors > 0 ? CliExitCode.PartialError : CliExitCode.Ok);
        return;
      }

      // Watch mode: re-run pipeline on changes, force=true so new methods are merged
      const watchOptions = { ...options, force: true, quiet: true };
      const stopWatching = watchProject({
        root: options.root,
        pattern: options.pattern,
        onRebuild: () => {
          try {
            runPipeline(watchOptions, false);
          } catch (err) {
            if (err instanceof CliError) {
              log('error', err.message);
            } else if (err instanceof Error) {
              log('error', err.message);
            }
          }
        },
      });

      // Graceful shutdown
      const shutdown = () => {
        stopWatching();
        log('info', 'Watch stopped.');
        process.exit(CliExitCode.Ok);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (err) {
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// init command — one-shot onboarding, bundles what generate/--link-controller/
// --register-plugin already do plus the one genuinely new step: wiring
// DocfyModule.forRoot() into each app's root module.
// ---------------------------------------------------------------------------

program
  .command('init')
  .description(
    'One-shot onboarding: wire DocfyModule into the root module, decorate controllers, register the webpack plugin if needed, add package.json scripts, and generate companion docs files',
  )
  .option('--root <path>', 'Project root directory', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected if omitted)')
  .option('--pattern <glob>', 'Glob pattern to find controllers', '**/*.controller.ts')
  .option('--format <format>', 'Output format: ts or js', 'ts')
  .option('--dry-run', 'Print what would change without writing any files', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    try {
      const options = parseAndValidateOptions({
        ...rawOpts,
        out: undefined,
        force: false,
        overwrite: false,
        watch: false,
        registerPlugin: true,
        linkController: true,
      } as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(options.quiet);

      if (options.dryRun) {
        header(`${pc.cyan('[DRY RUN]')} nestjs-docfy init`);
      } else {
        header('nestjs-docfy init');
      }
      log('info', `Root: ${options.root}`);

      // Own detection pass just to get each app's entryFile for root-module
      // wiring below — runPipeline() re-detects internally right after (it
      // owns the "Project type" log + the actual --register-plugin write,
      // both gated together behind its `silent` param, so this can't reuse
      // that call without also silencing the plugin registration).
      const context = detectProject(options.root, options.tsconfig);

      for (const app of context.apps) {
        if (!app.entryFile) {
          log(
            'warn',
            `${app.name}: could not locate a bootstrap file (src/main.ts) — add ${pc.cyan('DocfyModule.forRoot()')} to your root module manually.`,
          );
          continue;
        }

        let rootProject: Project;
        try {
          rootProject = new Project({
            tsConfigFilePath: app.tsconfig,
            skipAddingFilesFromTsConfig: false,
            skipFileDependencyResolution: true,
          });
        } catch {
          log(
            'warn',
            `${app.name}: could not load ${app.tsconfig} to locate the root module — add DocfyModule.forRoot() manually.`,
          );
          continue;
        }

        const location = findRootModule(rootProject, app.entryFile);
        if (!location) {
          log(
            'warn',
            `${app.name}: could not locate the root module from ${app.entryFile} — add ${pc.cyan('DocfyModule.forRoot()')} to your root module manually.`,
          );
          continue;
        }

        const result = linkRootModule(location, options.dryRun);
        if (!result) {
          log(
            'warn',
            `${app.name}: found the root module but couldn't safely edit its @Module({...}) — add ${pc.cyan('DocfyModule.forRoot()')} manually.`,
          );
          continue;
        }

        if (result.changed) {
          log(
            options.dryRun ? 'dry' : 'success',
            `${app.name} → ${pc.cyan('DocfyModule.forRoot()')} ${options.dryRun ? 'would be added' : 'added'} to ${result.path}`,
          );
        } else {
          log('skip', `${app.name} → ${pc.gray('[root module already wired]')}`);
        }
      }

      // Controllers (--link-controller), webpack plugin (--register-plugin),
      // and companion docs files (generate) — all already implemented.
      const errors = runPipeline(options);

      const scriptsResult = addPackageScripts(context.root, options.dryRun);
      if (!scriptsResult) {
        log('warn', 'Could not find/parse package.json — add "docs:generate"/"docs:preview" scripts manually.');
      } else if (scriptsResult.changed) {
        log(
          options.dryRun ? 'dry' : 'success',
          `${options.dryRun ? 'Would add' : 'Added'} script(s) ${scriptsResult.added.map((s) => pc.cyan(s)).join(', ')} to ${scriptsResult.path}`,
        );
      } else {
        log('skip', `package.json scripts ${pc.gray('[already present]')}`);
      }

      process.exit(errors > 0 ? CliExitCode.PartialError : CliExitCode.Ok);
    } catch (err) {
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// check command
// ---------------------------------------------------------------------------

program
  .command('check')
  .description('Verify all controllers are fully documented, exits 1 if any drift is found')
  .option('--root <path>', 'Project root directory', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected if omitted)')
  .option('--pattern <glob>', 'Glob pattern to find controllers', '**/*.controller.ts')
  .option('--format <format>', 'Docs file format to look for: ts or js', 'ts')
  .option('--json', 'Output a single machine-readable JSON object instead of formatted text', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    const json = Boolean(rawOpts.json);
    try {
      const options = parseAndValidateOptions({
        ...rawOpts,
        force: false,
        overwrite: false,
        dryRun: false,
        out: undefined,
        watch: false,
      } as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(json || options.quiet);

      if (!json) {
        header('nestjs-docfy check');
        log('info', `Root: ${options.root}`);
        log('info', `Pattern: ${options.pattern}`);
        log('info', `Format: ${options.format}`);
      }

      const context = detectProject(options.root, options.tsconfig);
      const scanResult = scanAllApps(
        context.apps,
        context.root,
        options.pattern !== '**/*.controller.ts' ? options.pattern : undefined,
        options.format,
      );

      if (!json) {
        for (const err of scanResult.errors) {
          log('error', `${err.file}: ${err.message}`);
        }
      }

      if (scanResult.controllers.length === 0) {
        if (json) {
          process.stdout.write(`${JSON.stringify({ controllersChecked: 0, issues: [], passed: true })}\n`);
        } else {
          log('warn', 'No controllers found matching the pattern.');
        }
        process.exit(CliExitCode.Ok);
        return;
      }

      const issues = checkControllers(scanResult.controllers, options.format);
      const docfyUiPin = checkDocfyUiPin(options.root);
      const versionDrift = checkDocsVersionDrift(scanResult.controllers, options.format, PACKAGE_VERSION);

      if (json) {
        process.stdout.write(
          `${JSON.stringify({
            controllersChecked: scanResult.controllers.length,
            issues,
            docfyUiPin,
            versionDrift,
            passed: issues.length === 0,
          })}\n`,
        );
        process.exit(issues.length === 0 ? CliExitCode.Ok : CliExitCode.PartialError);
        return;
      }

      if (docfyUiPin) {
        log(
          'warn',
          `docfy-ui@${docfyUiPin.appDeclaredRange} is declared in your package.json, but it has no effect on ` +
            `the UI served — nestjs-docfy vendors its own pinned copy (currently docfy-ui@${docfyUiPin.servedVersion}). ` +
            `To get a newer UI, update nestjs-docfy itself.`,
        );
      }

      for (const drift of versionDrift) {
        const generatedBy = drift.stampedVersion ? `nestjs-docfy@${drift.stampedVersion}` : 'an older nestjs-docfy';
        log(
          'warn',
          `${drift.controllerClass}: ${drift.docsFile} was generated by ${generatedBy}, older than the installed ` +
            `nestjs-docfy@${PACKAGE_VERSION} — run ${pc.cyan('generate --overwrite')} to refresh it.`,
        );
      }

      if (issues.length === 0) {
        log('success', `All ${scanResult.controllers.length} controller(s) are fully documented.`);
        process.exit(CliExitCode.Ok);
        return;
      }

      for (const issue of issues) {
        if (issue.kind === 'missing-file') {
          log('error', `${issue.controllerClass}: no companion docs file found at ${issue.docsFile}`);
        } else {
          log('error', `${issue.controllerClass}: undocumented methods: ${issue.methods!.join(', ')}`);
          log('info', `  → run ${pc.cyan('nestjs-docfy generate --force')} to merge new methods`);
        }
      }

      process.stderr.write(`\n${pc.red(`✖ ${issues.length} controller(s) out of sync.`)}\n\n`);
      process.exit(CliExitCode.PartialError);
    } catch (err) {
      if (json && err instanceof CliError) {
        process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// doctor command
// ---------------------------------------------------------------------------

const PROJECT_KIND_LABEL: Record<ReturnType<typeof detectProject>['kind'], string> = {
  simple: 'Simple project',
  nx: 'NX Monorepo',
  'nest-cli-monorepo': 'Nest CLI Monorepo',
  'generic-monorepo': 'Generic Monorepo',
};

program
  .command('doctor')
  .description(
    'Run every nestjs-docfy diagnostic at once: docs drift, docfy-ui pin, version drift, webpack/SWC plugin setup',
  )
  .option('--root <path>', 'Project root directory', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected if omitted)')
  .option('--pattern <glob>', 'Glob pattern to find controllers', '**/*.controller.ts')
  .option('--format <format>', 'Docs file format to look for: ts or js', 'ts')
  .option('--json', 'Output a single machine-readable JSON object instead of formatted text', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    const json = Boolean(rawOpts.json);
    try {
      const options = parseAndValidateOptions({
        ...rawOpts,
        force: false,
        overwrite: false,
        dryRun: false,
        out: undefined,
        watch: false,
      } as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(json || options.quiet);

      const report = runDoctor(options.root, {
        tsconfig: options.tsconfig,
        pattern: options.pattern,
        format: options.format,
        currentVersion: PACKAGE_VERSION,
      });
      const clean = isDoctorReportClean(report);

      if (json) {
        process.stdout.write(`${JSON.stringify({ ...report, passed: clean })}\n`);
        process.exit(CliExitCode.Ok);
        return;
      }

      header('nestjs-docfy doctor');
      log(
        'success',
        `Project type: ${PROJECT_KIND_LABEL[report.project.kind]} (${report.project.apps.length} app${report.project.apps.length !== 1 ? 's' : ''})`,
      );

      for (const err of report.scanErrors) {
        log('error', `${err.file}: ${err.message}`);
      }

      if (report.webpackMissingPlugin.length > 0) {
        const where =
          report.webpackMissingPlugin[0] === ''
            ? ''
            : ` in project(s) ${report.webpackMissingPlugin.map((n) => pc.cyan(n)).join(', ')}`;
        log(
          'warn',
          `Builds with "webpack": true${where}, so @WithDocs()/DocfyModule runtime discovery does not work in that mode. ` +
            `Register ${pc.cyan('nestjs-docfy')} under compilerOptions.plugins (run ${pc.cyan('generate --register-plugin')}) or use ${pc.cyan('patch-spec')} instead.`,
        );
      }

      if (report.inertSwcPlugin.length > 0) {
        const where =
          report.inertSwcPlugin[0] === ''
            ? ''
            : ` in project(s) ${report.inertSwcPlugin.map((n) => pc.cyan(n)).join(', ')}`;
        log(
          'warn',
          `The nestjs-docfy compiler plugin is registered${where} but builds with SWC and no "typeCheck": true, ` +
            `so the plugin never runs. Set ${pc.cyan('"typeCheck": true')} in compilerOptions.`,
        );
      }

      if (report.docfyUiPin) {
        log(
          'warn',
          `docfy-ui@${report.docfyUiPin.appDeclaredRange} is declared in your package.json, but it has no effect on ` +
            `the UI served — nestjs-docfy vendors its own pinned copy (currently docfy-ui@${report.docfyUiPin.servedVersion}). ` +
            `To get a newer UI, update nestjs-docfy itself.`,
        );
      }

      for (const drift of report.versionDrift) {
        const generatedBy = drift.stampedVersion ? `nestjs-docfy@${drift.stampedVersion}` : 'an older nestjs-docfy';
        log(
          'warn',
          `${drift.controllerClass}: ${drift.docsFile} was generated by ${generatedBy}, older than the installed ` +
            `nestjs-docfy@${PACKAGE_VERSION} — run ${pc.cyan('generate --overwrite')} to refresh it.`,
        );
      }

      if (report.controllersScanned === 0) {
        log('warn', 'No controllers found matching the pattern.');
      } else if (report.controllerIssues.length === 0) {
        log('success', `All ${report.controllersScanned} controller(s) are fully documented.`);
      } else {
        for (const issue of report.controllerIssues) {
          if (issue.kind === 'missing-file') {
            log('error', `${issue.controllerClass}: no companion docs file found at ${issue.docsFile}`);
          } else {
            log('error', `${issue.controllerClass}: undocumented methods: ${issue.methods!.join(', ')}`);
            log('info', `  → run ${pc.cyan('nestjs-docfy generate --force')} to merge new methods`);
          }
        }
      }

      if (clean) {
        process.stdout.write(`\n${pc.green('✔ Everything looks good.')}\n\n`);
      } else {
        process.stdout.write(`\n${pc.yellow('⚠ Some diagnostics need attention — see above.')}\n\n`);
      }
      // Diagnostic tool, not a CI gate — `check`/`coverage` own exit-code enforcement.
      process.exit(CliExitCode.Ok);
    } catch (err) {
      if (json && err instanceof CliError) {
        process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// coverage command
// ---------------------------------------------------------------------------

program
  .command('coverage')
  .description('Report the percentage of endpoints with Swagger documentation')
  .option('--root <path>', 'Project root directory', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected if omitted)')
  .option('--pattern <glob>', 'Glob pattern to find controllers', '**/*.controller.ts')
  .option('--format <format>', 'Docs file format to look for: ts or js', 'ts')
  .option('--min <percent>', 'Minimum coverage percentage required, exits 1 if below')
  .option('--json', 'Output a single machine-readable JSON object instead of formatted text', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    const json = Boolean(rawOpts.json);
    try {
      const options = parseAndValidateOptions({
        ...rawOpts,
        force: false,
        overwrite: false,
        dryRun: false,
        out: undefined,
        watch: false,
      } as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(json || options.quiet);

      let min: number | undefined;
      if (rawOpts.min !== undefined) {
        min = Number(rawOpts.min);
        if (!Number.isFinite(min) || min < 0 || min > 100) {
          throw new CliError(
            `Invalid --min value: ${String(rawOpts.min)} (must be a number between 0 and 100)`,
            CliExitCode.Fatal,
          );
        }
      }

      if (!json) {
        header('nestjs-docfy coverage');
        log('info', `Root: ${options.root}`);
        log('info', `Pattern: ${options.pattern}`);
        log('info', `Format: ${options.format}`);
      }

      const context = detectProject(options.root, options.tsconfig);
      const scanResult = scanAllApps(
        context.apps,
        context.root,
        options.pattern !== '**/*.controller.ts' ? options.pattern : undefined,
        options.format,
      );

      if (!json) {
        for (const err of scanResult.errors) {
          log('error', `${err.file}: ${err.message}`);
        }
      }

      if (scanResult.controllers.length === 0) {
        if (json) {
          process.stdout.write(
            `${JSON.stringify({
              totalControllers: 0,
              totalEndpoints: 0,
              documentedEndpoints: 0,
              missingEndpoints: 0,
              coveragePercent: null,
              min: min ?? null,
              passed: true,
            })}\n`,
          );
        } else {
          log('warn', 'No controllers found matching the pattern.');
        }
        process.exit(CliExitCode.Ok);
        return;
      }

      const report = computeCoverage(scanResult.controllers, options.format);
      const pctLabel = Number.isNaN(report.coveragePercent) ? 'n/a' : `${report.coveragePercent}%`;
      const passed = !(min !== undefined && (Number.isNaN(report.coveragePercent) || report.coveragePercent < min));

      if (json) {
        process.stdout.write(
          `${JSON.stringify({
            ...report,
            coveragePercent: Number.isNaN(report.coveragePercent) ? null : report.coveragePercent,
            min: min ?? null,
            passed,
          })}\n`,
        );
        process.exit(passed ? CliExitCode.Ok : CliExitCode.PartialError);
        return;
      }

      process.stdout.write('\n');
      process.stdout.write(`Controllers: ${report.totalControllers}\n`);
      process.stdout.write(`Endpoints: ${report.totalEndpoints}\n\n`);
      process.stdout.write(`Documented: ${report.documentedEndpoints}\n`);
      process.stdout.write(`Missing docs: ${report.missingEndpoints}\n\n`);
      process.stdout.write(`Coverage: ${pctLabel}\n\n`);

      if (!passed) {
        process.stderr.write(`${pc.red(`✖ Coverage ${pctLabel} is below the required minimum of ${min}%.`)}\n\n`);
        process.exit(CliExitCode.PartialError);
        return;
      }

      process.exit(CliExitCode.Ok);
    } catch (err) {
      if (json && err instanceof CliError) {
        process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// lint command
// ---------------------------------------------------------------------------

program
  .command('lint')
  .description('Check documentation quality: missing summaries, error responses, body descriptions')
  .option('--root <path>', 'Project root directory', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected if omitted)')
  .option('--pattern <glob>', 'Glob pattern to find controllers', '**/*.controller.ts')
  .option('--format <format>', 'Docs file format to look for: ts or js', 'ts')
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    try {
      const options = parseAndValidateOptions({
        ...rawOpts,
        force: false,
        overwrite: false,
        dryRun: false,
        out: undefined,
        watch: false,
      } as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(options.quiet);

      header('nestjs-docfy lint');
      log('info', `Root: ${options.root}`);
      log('info', `Pattern: ${options.pattern}`);
      log('info', `Format: ${options.format}`);

      const context = detectProject(options.root, options.tsconfig);
      const scanResult = scanAllApps(
        context.apps,
        context.root,
        options.pattern !== '**/*.controller.ts' ? options.pattern : undefined,
        options.format,
      );

      for (const err of scanResult.errors) {
        log('error', `${err.file}: ${err.message}`);
      }

      if (scanResult.controllers.length === 0) {
        log('warn', 'No controllers found matching the pattern.');
        process.exit(CliExitCode.Ok);
        return;
      }

      const issues = lintControllers(scanResult.controllers, options.format);

      if (issues.length === 0) {
        log('success', 'No documentation quality issues found.');
        process.exit(CliExitCode.Ok);
        return;
      }

      const grouped = new Map<string, typeof issues>();
      for (const issue of issues) {
        const key = `${issue.controllerClass}::${issue.method}`;
        const existing = grouped.get(key);
        if (existing) existing.push(issue);
        else grouped.set(key, [issue]);
      }

      for (const groupIssues of grouped.values()) {
        log('error', groupIssues[0].route);
        for (const issue of groupIssues) {
          log('info', `  ${issue.message}`);
        }
      }

      process.stderr.write(`\n${pc.red(`✖ ${issues.length} issue(s) found.`)}\n\n`);
      process.exit(CliExitCode.PartialError);
    } catch (err) {
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// patch-spec command
// ---------------------------------------------------------------------------

program
  .command('patch-spec')
  .description(
    "Patch an already-built OpenAPI document with every controller's companion docs file, " +
      'using static analysis only. No runtime require(), no decorators applied to any class. ' +
      'Works under any build mode, including NestJS CLI\'s "webpack: true" (see README).',
  )
  .requiredOption(
    '--spec <path-or-url>',
    'Path to a local openapi.json, or a URL (e.g. http://localhost:3000/api-json)',
  )
  .option('--out <path>', 'Where to write the patched document (default: stdout)')
  .option('--root <path>', 'Project root directory', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected if omitted)')
  .option('--pattern <glob>', 'Glob pattern to find controllers', '**/*.controller.ts')
  .option('--format <format>', 'Docs file format to look for: ts or js', 'ts')
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    try {
      const options = parseAndValidateOptions({
        ...rawOpts,
        force: false,
        overwrite: false,
        dryRun: false,
        watch: false,
      } as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(options.quiet);

      header('nestjs-docfy patch-spec');
      log('info', `Root: ${options.root}`);
      log('info', `Spec: ${String(rawOpts.spec)}`);

      const document = await readSpecSource(String(rawOpts.spec), options.root);

      const context = detectProject(options.root, options.tsconfig);
      const scanResult = scanAllApps(
        context.apps,
        context.root,
        options.pattern !== '**/*.controller.ts' ? options.pattern : undefined,
        options.format,
      );

      for (const err of scanResult.errors) {
        log('error', `${err.file}: ${err.message}`);
      }

      const result = computePatchedDocument(
        document,
        scanResult.controllers,
        options.format,
        (absPath) => {
          try {
            return fs.readFileSync(absPath, 'utf8');
          } catch {
            return null;
          }
        },
        scanResult.projectsByControllerPath,
      );

      log('success', `Patched ${result.patchedOperationCount} operation(s).`);
      if (result.controllersWithoutDocs.length > 0) {
        log('info', `No docs file: ${result.controllersWithoutDocs.join(', ')}`);
      }
      if (result.unparseableDocsFiles.length > 0) {
        log('warn', `Could not parse: ${result.unparseableDocsFiles.join(', ')}`);
      }
      if (result.unmatchedRoutes.length > 0) {
        log('warn', `Documented but not present in --spec: ${result.unmatchedRoutes.join(', ')}`);
      }

      const output = JSON.stringify(result.document, null, 2);
      if (options.out) {
        fs.writeFileSync(options.out, output);
        log('success', `Written to ${options.out}`);
      } else {
        process.stdout.write(`${output}\n`);
      }

      process.exit(CliExitCode.Ok);
    } catch (err) {
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// export command
// ---------------------------------------------------------------------------

program
  .command('export')
  .description(
    "Boot the project's own Nest app (via a small entry file you provide) and write the " +
      'OpenAPI document it produces, without binding a port. Unlike patch-spec, this generates ' +
      'the base document too (not just patches an existing one) — see README for the entry file contract.',
  )
  .requiredOption(
    '--entry <path>',
    'Path to a .ts/.js file whose default export boots the app and returns { app, document }',
  )
  .option('--out <path>', 'Where to write the document (default: stdout)')
  .option('--root <path>', 'Project root directory', '.')
  .option('--quiet', 'Suppress all output except errors', false)
  .action((rawOpts: { entry: string; out?: string; root: string; quiet: boolean }) => {
    // Informational messages always go to stderr here, regardless of
    // --quiet/--out: unlike the other commands, this one may print the
    // document itself to stdout, and that has to stay pipeable
    // (`nestjs-docfy export --entry x.ts > openapi.json`) without any
    // chatter mixed in ahead of the JSON.
    const info = (message: string) => {
      if (!rawOpts.quiet) process.stderr.write(`  ${message}\n`);
    };
    try {
      info(`Entry: ${rawOpts.entry}`);

      const { document, outPath } = exportSpec({ entry: rawOpts.entry, root: rawOpts.root, out: rawOpts.out });

      if (outPath) {
        info(`Written to ${outPath}`);
      } else {
        process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
      }
      process.exit(CliExitCode.Ok);
    } catch (err) {
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// generate-client command
// ---------------------------------------------------------------------------

program
  .command('generate-client')
  .description(
    'Generate a typed TypeScript client from an OpenAPI document, a thin wrapper over ' +
      'openapi-typescript (types) and openapi-fetch (runtime client), not a from-scratch generator.',
  )
  .requiredOption(
    '--spec <path-or-url>',
    'Path to a local openapi.json, or a URL (e.g. http://localhost:3000/api-json)',
  )
  .option('--out <path>', 'Output directory for schema.d.ts and client.ts', './generated-client')
  .option('--root <path>', 'Project root directory', '.')
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    try {
      const root = path.resolve(String(rawOpts.root ?? '.'));
      setQuiet(Boolean(rawOpts.quiet));

      header('nestjs-docfy generate-client');
      log('info', `Root: ${root}`);
      log('info', `Spec: ${String(rawOpts.spec)}`);

      const document: OpenApiDocument = await readSpecSource(String(rawOpts.spec), root);
      const outDir = resolveAndValidate(String(rawOpts.out ?? './generated-client'), root, '--out');
      fs.mkdirSync(outDir, { recursive: true });

      // Loaded lazily (not at module top-level): openapi-typescript pulls in
      // parse-json@8, which is ESM-only — eagerly requiring it would crash
      // *every* CLI invocation on Node <22.12 (no native require(esm)
      // interop), not just generate-client's own.
      const { buildClientFiles } = await import('./generate-client');
      const { schema, client } = await buildClientFiles(document);
      fs.writeFileSync(path.join(outDir, 'schema.d.ts'), schema);
      fs.writeFileSync(path.join(outDir, 'client.ts'), client);

      log('success', `Written ${path.join(outDir, 'schema.d.ts')}`);
      log('success', `Written ${path.join(outDir, 'client.ts')}`);
      log(
        'info',
        `Next: npm install openapi-fetch in your project, then import { createApiClient } from '${path.relative(root, outDir) || '.'}/client'.`,
      );

      process.exit(CliExitCode.Ok);
    } catch (err) {
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// mock command
// ---------------------------------------------------------------------------

program
  .command('mock')
  .description(
    'Start a throwaway HTTP server that answers every endpoint in an OpenAPI document with its ' +
      "generated example response (type-token placeholders, same as 'Copy for AI' — not fake data). " +
      'No request validation, no auth, no state. For unblocking a frontend against an API that ' +
      "isn't running yet, not a Swagger UI/Prism replacement.",
  )
  .requiredOption(
    '--spec <path-or-url>',
    'Path to a local openapi.json, or a URL (e.g. http://localhost:3000/api-json)',
  )
  .option('--port <port>', 'Port to listen on', '4010')
  .option('--host <host>', 'Host to bind to', '127.0.0.1')
  .option('--root <path>', 'Project root directory', '.')
  .action(async (rawOpts: Record<string, unknown>) => {
    try {
      const root = path.resolve(String(rawOpts.root ?? '.'));
      const port = Number.parseInt(String(rawOpts.port ?? '4010'), 10);
      const host = String(rawOpts.host ?? '127.0.0.1');

      header('nestjs-docfy mock');
      log('info', `Spec: ${String(rawOpts.spec)}`);

      const document: OpenApiDocument = await readSpecSource(String(rawOpts.spec), root);
      const { app, endpointCount } = await buildMockApp(document);

      const server = app.listen(port, host, () => {
        log('success', `Mocking ${endpointCount} endpoint(s) at http://${host}:${port}`);
        log('info', 'Press Ctrl+C to stop.');
      });

      const shutdown = () => {
        server.close(() => process.exit(CliExitCode.Ok));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (err) {
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// test command
// ---------------------------------------------------------------------------

program
  .command('test')
  .description(
    'Fire a real request at every endpoint in an OpenAPI document (path/query/body filled in ' +
      'with generated examples) and validate the live response against its declared schema — a ' +
      'Postman-collection-runner-equivalent driven straight off the spec, no setup required. A ' +
      'response whose status is undeclared, or declared with no schema, is reported but never ' +
      "counted as a failure — a fabricated ID legitimately 404ing isn't a contract break.",
  )
  .requiredOption(
    '--spec <path-or-url>',
    'Path to a local openapi.json, or a URL (e.g. http://localhost:3000/api-json)',
  )
  .requiredOption('--base-url <url>', 'Base URL of the running server to test against')
  .option(
    '--header <name:value>',
    'Extra header sent with every request (e.g. --header "Authorization:Bearer xyz"), repeatable',
    (value: string, previous: string[]) => previous.concat([value]),
    [] as string[],
  )
  .option('--root <path>', 'Project root directory', '.')
  .option('--json', 'Output a single machine-readable JSON object instead of formatted text', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    const json = Boolean(rawOpts.json);
    try {
      const root = path.resolve(String(rawOpts.root ?? '.'));
      setQuiet(json || Boolean(rawOpts.quiet));

      if (!json) {
        header('nestjs-docfy test');
        log('info', `Spec: ${String(rawOpts.spec)}`);
        log('info', `Base URL: ${String(rawOpts.baseUrl)}`);
      }

      const headers: Record<string, string> = {};
      for (const raw of (rawOpts.header as string[] | undefined) ?? []) {
        const separatorIndex = raw.indexOf(':');
        if (separatorIndex === -1) continue;
        headers[raw.slice(0, separatorIndex).trim()] = raw.slice(separatorIndex + 1).trim();
      }

      const document: OpenApiDocument = await readSpecSource(String(rawOpts.spec), root);
      const results = await runContractTests(document, { baseUrl: String(rawOpts.baseUrl), headers });

      const mismatched = results.filter((r) => r.outcome.kind === 'matched' && r.outcome.mismatches.length > 0);
      const requestFailed = results.filter((r) => r.outcome.kind === 'request-failed');
      const passed = mismatched.length === 0 && requestFailed.length === 0;

      if (json) {
        process.stdout.write(`${JSON.stringify({ endpointsTested: results.length, results, passed })}\n`);
        process.exit(passed ? CliExitCode.Ok : CliExitCode.PartialError);
        return;
      }

      const cleanMatches = results.filter((r) => r.outcome.kind === 'matched' && r.outcome.mismatches.length === 0);
      const undeclaredStatus = results.filter((r) => r.outcome.kind === 'undeclared-status');
      const noSchema = results.filter((r) => r.outcome.kind === 'no-schema');
      const unparseable = results.filter((r) => r.outcome.kind === 'unparseable-body');

      if (cleanMatches.length > 0) log('success', `${cleanMatches.length} endpoint(s) matched their schema cleanly.`);
      if (noSchema.length > 0)
        log('info', `${noSchema.length} endpoint(s) had no schema declared for the live status — nothing to check.`);
      if (undeclaredStatus.length > 0) {
        log(
          'warn',
          `${undeclaredStatus.length} endpoint(s) returned a status not declared in the spec (informational, not a failure).`,
        );
      }
      if (unparseable.length > 0)
        log('warn', `${unparseable.length} endpoint(s) returned a non-JSON body for a status with a declared schema.`);

      for (const result of requestFailed) {
        if (result.outcome.kind !== 'request-failed') continue;
        log('error', `${result.method} ${result.path}: request failed — ${result.outcome.message}`);
      }

      for (const result of mismatched) {
        if (result.outcome.kind !== 'matched') continue;
        log('error', `${result.method} ${result.path}: ${result.outcome.mismatches.length} schema mismatch(es)`);
        for (const mismatch of result.outcome.mismatches) {
          log('info', `  → ${mismatch.path}: ${mismatch.message}`);
        }
      }

      if (passed) {
        process.exit(CliExitCode.Ok);
      } else {
        process.stderr.write(
          `\n${pc.red(`✖ ${mismatched.length} endpoint(s) with schema mismatches, ${requestFailed.length} request failure(s).`)}\n\n`,
        );
        process.exit(CliExitCode.PartialError);
      }
    } catch (err) {
      if (json && err instanceof CliError) {
        process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

// ---------------------------------------------------------------------------
// lint-spec command
// ---------------------------------------------------------------------------

program
  .command('lint-spec')
  .description(
    'Checks OpenAPI spec quality (missing summaries/descriptions, undocumented tags, no ' +
      'error response declared, duplicate operationIds) — a Redocly-CLI/Spectral-style ' +
      "governance check on the document itself, not decorator coverage (see 'check'/'lint' " +
      'for that). Works against any spec, generated by this library or not.',
  )
  .requiredOption(
    '--spec <path-or-url>',
    'Path to a local openapi.json, or a URL (e.g. http://localhost:3000/api-json)',
  )
  .option('--root <path>', 'Project root directory', '.')
  .option('--json', 'Output a single machine-readable JSON object instead of formatted text', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    const json = Boolean(rawOpts.json);
    try {
      const root = path.resolve(String(rawOpts.root ?? '.'));
      setQuiet(json || Boolean(rawOpts.quiet));

      if (!json) {
        header('nestjs-docfy lint-spec');
        log('info', `Spec: ${String(rawOpts.spec)}`);
      }

      const rawDocument: OpenApiDocument = await readSpecSource(String(rawOpts.spec), root);
      const document = await normalizeDocument(rawDocument);
      const issues = lintSpec(document);

      if (json) {
        process.stdout.write(
          `${JSON.stringify({ issuesFound: issues.length, issues, passed: issues.length === 0 })}\n`,
        );
        process.exit(issues.length === 0 ? CliExitCode.Ok : CliExitCode.PartialError);
        return;
      }

      if (issues.length === 0) {
        log('success', 'Spec passed every quality check.');
        process.exit(CliExitCode.Ok);
        return;
      }

      for (const issue of issues) {
        const location = issue.method && issue.path ? `${issue.method} ${issue.path}` : '(document)';
        log('error', `${location}: [${issue.rule}] ${issue.message}`);
      }

      process.stderr.write(`\n${pc.red(`✖ ${issues.length} spec quality issue(s) found.`)}\n\n`);
      process.exit(CliExitCode.PartialError);
    } catch (err) {
      if (json && err instanceof CliError) {
        process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof CliError) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
        process.exit(err.exitCode);
      }
      if (err instanceof Error) {
        process.stderr.write(`\n${pc.red('✖ Error:')} ${err.message}\n\n`);
      } else {
        process.stderr.write(`\n${pc.red('✖ Unknown error')}\n\n`);
      }
      process.exit(CliExitCode.Fatal);
    }
  });

program.parseAsync(process.argv).catch(() => {
  process.exit(CliExitCode.Fatal);
});
