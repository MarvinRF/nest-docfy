#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { parseAndValidateOptions } from './parse-args';
import { setQuiet, log, header, summary } from './logger';
import { CliError, CliExitCode } from './errors';
import { detectProject } from './detect-project';
import { scanAllApps } from './scan-controllers';
import { writeAllDocs } from './writer';

const program = new Command();

program
  .name('nestjs-docfy')
  .description('Generate companion docs files for NestJS controllers')
  .version(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('../../package.json') as { version: string }).version,
    '-v, --version',
  );

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

      // ── Detect project ──────────────────────────────────────────────────
      const context = detectProject(options.root, options.tsconfig);
      const kindLabel: Record<typeof context.kind, string> = {
        'simple':             'Simple project',
        'nx':                 'NX Monorepo',
        'nest-cli-monorepo':  'Nest CLI Monorepo',
        'generic-monorepo':   'Generic Monorepo',
      };
      log('success', `Project type detected: ${kindLabel[context.kind]} (${context.apps.length} app${context.apps.length !== 1 ? 's' : ''})`);
      for (const app of context.apps) {
        log('info', `  App "${app.name}" → ${app.tsconfig}`);
      }

      // ── Scan controllers ────────────────────────────────────────────────
      header('Scanning controllers...');
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
        log('warn', 'No controllers found matching the pattern.');
        summary(0, 0, 0);
        process.exit(CliExitCode.Ok);
      }

      // ── Generate / dry-run ──────────────────────────────────────────────
      header(options.dryRun ? 'Preview (dry-run):' : 'Generating docs files...');

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
            // output already written inline by writer
            break;
          case 'error':
            log('error', `${r.controllerClass}: ${r.error}`);
            errors++;
            break;
        }
      }

      if (!options.dryRun) {
        summary(created, skipped, errors);
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

program.parseAsync(process.argv).catch(() => {
  process.exit(CliExitCode.Fatal);
});
