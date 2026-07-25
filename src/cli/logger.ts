import pc from 'picocolors';

export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'skip' | 'dry';

let quiet = false;

export function setQuiet(value: boolean): void {
  quiet = value;
}

function prefix(level: LogLevel): string {
  switch (level) {
    case 'success':
      return pc.green('✔');
    case 'warn':
      return pc.yellow('⚠');
    case 'error':
      return pc.red('✖');
    case 'skip':
      return pc.gray('–');
    case 'dry':
      return pc.cyan('~');
    case 'info':
      return pc.blue('ℹ');
  }
}

export function log(level: LogLevel, message: string): void {
  if (quiet && level !== 'error') return;
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(`  ${prefix(level)} ${message}\n`);
}

export function header(message: string): void {
  if (quiet) return;
  process.stdout.write(`\n${pc.bold(message)}\n`);
}

export function summary(created: number, skipped: number, errors: number): void {
  if (quiet) return;
  const parts: string[] = [];
  if (created > 0) parts.push(pc.green(`${created} created`));
  if (skipped > 0) parts.push(pc.gray(`${skipped} skipped`));
  if (errors > 0) parts.push(pc.red(`${errors} error${errors > 1 ? 's' : ''}`));
  process.stdout.write(`\n${pc.bold('Done.')} ${parts.join(' · ')}\n\n`);
}
