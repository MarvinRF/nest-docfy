#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { parseAndValidateOptions, type CliOptions } from './parse-args';
import { setQuiet, log, header, summary } from './logger';
import { CliError, CliExitCode } from './errors';
import { detectProject } from './detect-project';
import { scanAllApps } from './scan-controllers';
import { writeAllDocs } from './writer';
import { watchProject } from './watch';
import { checkControllers } from './check';
import { computeCoverage } from './coverage';
import { lintControllers } from './lint';

const program = new Command();

program
  .name('nestjs-docfy')
  .description('Generate companion docs files for NestJS controllers')
  .version(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('../../package.json') as { version: string }).version,
    '-v, --version',
  );

// ---------------------------------------------------------------------------
// Shared pipeline: detect → scan → write
// Returns number of errors (0 = success).
// ---------------------------------------------------------------------------

function runPipeline(options: CliOptions, silent = false): number {
  const context = detectProject(options.root, options.tsconfig);

  if (!silent) {
    const kindLabel: Record<typeof context.kind, string> = {
      'simple':            'Simple project',
      'nx':                'NX Monorepo',
      'nest-cli-monorepo': 'Nest CLI Monorepo',
      'generic-monorepo':  'Generic Monorepo',
    };
    log('success', `Project type: ${kindLabel[context.kind]} (${context.apps.length} app${context.apps.length !== 1 ? 's' : ''})`);
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
    dryRun: options.dryRun,
    format: options.format,
  });

  let created = 0, skipped = 0, errors = scanResult.errors.length;

  for (const r of writeResults) {
    switch (r.outcome) {
      case 'created':
        log('success', `${r.controllerClass} → ${r.docsFilePath}  ${pc.green('[created]')}`);
        created++;
        break;
      case 'merged':
        log('success', `${r.controllerClass} → ${r.docsFilePath}  ${pc.cyan('[merged]')}${r.addedMethods?.length ? ` (+${r.addedMethods.join(', ')})` : ''}`);
        created++;
        break;
      case 'skipped':
        log('skip', `${r.controllerClass} → ${r.docsFilePath}  ${pc.gray('[skipped — already exists]')}`);
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
  .option('--dry-run', 'Print what would be generated without writing files', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .option('--format <format>', 'Output format: ts or js', 'ts')
  .option('--watch', 'Re-generate on controller file changes', false)
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
      if (options.force)    log('warn', 'Force mode — new methods merged, existing decorators preserved.');
      if (options.dryRun)   log('dry',  'Dry-run mode — no files will be written.');
      if (options.watch)    log('info', 'Watch mode enabled.');

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
// check command
// ---------------------------------------------------------------------------

program
  .command('check')
  .description('Verify all controllers are fully documented — exits 1 if any drift is found')
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
        dryRun: false,
        out: undefined,
        watch: false,
      } as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(options.quiet);

      header('nestjs-docfy check');
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

      const issues = checkControllers(scanResult.controllers, options.format);

      if (issues.length === 0) {
        log('success', `All ${scanResult.controllers.length} controller(s) are fully documented.`);
        process.exit(CliExitCode.Ok);
        return;
      }

      for (const issue of issues) {
        if (issue.kind === 'missing-file') {
          log('error', `${issue.controllerClass} — no companion docs file found at ${issue.docsFile}`);
        } else {
          log('error', `${issue.controllerClass} — undocumented methods: ${issue.methods!.join(', ')}`);
          log('info',  `  → run ${pc.cyan('nestjs-docfy generate --force')} to merge new methods`);
        }
      }

      process.stderr.write(`\n${pc.red(`✖ ${issues.length} controller(s) out of sync.`)}\n\n`);
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
// coverage command
// ---------------------------------------------------------------------------

program
  .command('coverage')
  .description('Report the percentage of endpoints with Swagger documentation')
  .option('--root <path>', 'Project root directory', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected if omitted)')
  .option('--pattern <glob>', 'Glob pattern to find controllers', '**/*.controller.ts')
  .option('--format <format>', 'Docs file format to look for: ts or js', 'ts')
  .option('--min <percent>', 'Minimum coverage percentage required — exits 1 if below')
  .option('--quiet', 'Suppress all output except errors', false)
  .action(async (rawOpts: Record<string, unknown>) => {
    try {
      const options = parseAndValidateOptions({
        ...rawOpts,
        force: false,
        dryRun: false,
        out: undefined,
        watch: false,
      } as Parameters<typeof parseAndValidateOptions>[0]);
      setQuiet(options.quiet);

      let min: number | undefined;
      if (rawOpts.min !== undefined) {
        min = Number(rawOpts.min);
        if (!Number.isFinite(min) || min < 0 || min > 100) {
          throw new CliError(`Invalid --min value: ${String(rawOpts.min)} (must be a number between 0 and 100)`, CliExitCode.Fatal);
        }
      }

      header('nestjs-docfy coverage');
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

      const report = computeCoverage(scanResult.controllers, options.format);
      const pctLabel = Number.isNaN(report.coveragePercent) ? 'n/a' : `${report.coveragePercent}%`;

      process.stdout.write('\n');
      process.stdout.write(`Controllers: ${report.totalControllers}\n`);
      process.stdout.write(`Endpoints: ${report.totalEndpoints}\n\n`);
      process.stdout.write(`Documented: ${report.documentedEndpoints}\n`);
      process.stdout.write(`Missing docs: ${report.missingEndpoints}\n\n`);
      process.stdout.write(`Coverage: ${pctLabel}\n\n`);

      if (min !== undefined && (Number.isNaN(report.coveragePercent) || report.coveragePercent < min)) {
        process.stderr.write(`${pc.red(`✖ Coverage ${pctLabel} is below the required minimum of ${min}%.`)}\n\n`);
        process.exit(CliExitCode.PartialError);
        return;
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
// lint command
// ---------------------------------------------------------------------------

program
  .command('lint')
  .description('Check documentation quality — missing summaries, error responses, body descriptions')
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

program.parseAsync(process.argv).catch(() => {
  process.exit(CliExitCode.Fatal);
});
