export const enum CliExitCode {
  Ok = 0,
  PartialError = 1,
  Fatal = 2,
}

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: CliExitCode = CliExitCode.Fatal,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export class PathTraversalError extends CliError {
  constructor(offendingPath: string) {
    super(`Path traversal detected: "${offendingPath}" resolves outside the project root.`, CliExitCode.Fatal);
    this.name = 'PathTraversalError';
  }
}

export class ConfigNotFoundError extends CliError {
  constructor(detail: string) {
    super(`Could not resolve tsconfig: ${detail}`, CliExitCode.Fatal);
    this.name = 'ConfigNotFoundError';
  }
}
