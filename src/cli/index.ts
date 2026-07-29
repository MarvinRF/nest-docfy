#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import pc from 'picocolors';
import { parseAndValidateOptions, resolveAndValidate, type CliOptions } from './parse-args';
import { setQuiet, log, header, summary } from './logger';
import { CliError, CliExitCode } from './errors';
import { detectProject, hasWebpackWithoutPlugin } from './detect-project';
import { registerWebpackPlugin } from './register-webpack-plugin';
import { scanAllApps } from './scan-controllers';
import { writeAllDocs } from './writer';
import { watchProject } from './watch';
import { checkControllers } from './check';
import { computeCoverage } from './coverage';
import { lintControllers } from './lint';
import { computePatchedDocument } from './patch-spec';
import { exportSpec } from './export-spec';
import { readSpecSource } from './read-spec-source';
import { buildClientFiles } from './generate-client';
import type { OpenApiDocument } from './merge-spec-patch';

const program = new Command();

program
  .name('nestjs-docfy')
  .description('Generate companion docs files for NestJS controllers')
  .version(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      simple: 'Simple project',
      nx: 'NX Monorepo',
      'nest-cli-monorepo': 'Nest CLI Monorepo',
      'generic-monorepo': 'Generic Monorepo',
    };
    log(
      'success',
      `Project type: ${kindLabel[context.kind]} (${context.apps.length} app${context.apps.length !== 1 ? 's' : ''})`,
    );

    if (hasWebpackWithoutPlugin(context.root)) {
      if (options.registerPlugin) {
        const result = registerWebpackPlugin(context.root, options.dryRun);
        if (result?.changed) {
          log(
            options.dryRun ? 'dry' : 'success',
            `${options.dryRun ? 'Would register' : 'Registered'} ${pc.cyan('nestjs-docfy')} under compilerOptions.plugins in ${result.path}`,
          );
        }
      } else {
        log(
          'warn',
          `This project builds with "webpack": true, so @WithDocs()/DocfyModule runtime discovery does not work in that mode. Register ${pc.cyan('nestjs-docfy')} under compilerOptions.plugins in nest-cli.json (see the "webpack-cli-plugin" guide), run ${pc.cyan('generate --register-plugin')} to do it automatically, or use ${pc.cyan('patch-spec')} instead.`,
        );
      }
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
  .option(
    '--register-plugin',
    'If webpack:true is set without the CLI plugin, add nestjs-docfy to nest-cli.json compilerOptions.plugins',
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
      if (options.force) log('warn', 'Force mode: new methods merged, existing decorators preserved.');
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

      if (json) {
        process.stdout.write(
          `${JSON.stringify({
            controllersChecked: scanResult.controllers.length,
            issues,
            passed: issues.length === 0,
          })}\n`,
        );
        process.exit(issues.length === 0 ? CliExitCode.Ok : CliExitCode.PartialError);
        return;
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
    'Boot the project\'s own Nest app (via a small entry file you provide) and write the ' +
      'OpenAPI document it produces, without binding a port. Unlike patch-spec, this generates ' +
      'the base document too (not just patches an existing one) — see README for the entry file contract.',
  )
  .requiredOption('--entry <path>', 'Path to a .ts/.js file whose default export boots the app and returns { app, document }')
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

program.parseAsync(process.argv).catch(() => {
  process.exit(CliExitCode.Fatal);
});
