import * as fs from 'fs';
import * as path from 'path';
import { Node, Project, SyntaxKind } from 'ts-morph';

export type SecurityFindingCode =
  'proxy-without-authorize' | 'proxy-allowed-in-production' | 'security-headers-disabled' | 'node-version';

export interface SecurityFinding {
  code: SecurityFindingCode;
  /** Project-relative file and 1-based line of the `DocfyUiModule.setup()` call; absent for runtime findings. */
  location?: string;
  message: string;
}

const MIN_NODE = [22, 12] as const;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

/**
 * Static security review of a project's `DocfyUiModule.setup()` calls: flags the setups that are
 * unsafe in production or that turn off a protection. Only object-literal options are inspected
 * (an options object built elsewhere can't be judged statically and is skipped, not guessed at).
 */
export function checkSecurity(root: string, nodeVersion = process.versions.node): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  const [major, minor] = nodeVersion.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    findings.push({
      code: 'node-version',
      message: `Node.js ${nodeVersion} is below 22.12; nestjs-docfy requires 22.12+ and older lines no longer get security patches.`,
    });
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  for (const file of findSetupFiles(root)) {
    const sourceFile = project.addSourceFileAtPath(file);
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== 'DocfyUiModule.setup') continue;
      const options = call.getArguments()[2];
      if (!options || !Node.isObjectLiteralExpression(options)) continue;

      const location = `${path.relative(root, file)}:${call.getStartLineNumber()}`;
      const has = (name: string) => options.getProperty(name) !== undefined;
      const isLiteral = (name: string, text: string) => {
        const prop = options.getProperty(name);
        return prop !== undefined && Node.isPropertyAssignment(prop) && prop.getInitializer()?.getText() === text;
      };

      if ((has('openApiDocument') || has('additionalProxyOrigins')) && !has('proxyAuthorize')) {
        findings.push(
          isLiteral('allowProxyInProduction', 'true')
            ? {
                code: 'proxy-allowed-in-production',
                location,
                message:
                  'allowProxyInProduction is set without proxyAuthorize: in production anyone who can reach the docs mount path can relay requests through the "Try it out" proxy. Make sure something else protects that path.',
              }
            : {
                code: 'proxy-without-authorize',
                location,
                message:
                  'The "Try it out" proxy has no proxyAuthorize hook, so it is disabled with NODE_ENV=production. Add proxyAuthorize to keep it in production.',
              },
        );
      }
      if (isLiteral('securityHeaders', 'false')) {
        findings.push({
          code: 'security-headers-disabled',
          location,
          message: 'securityHeaders: false turns off the Content-Security-Policy and the other headers on the docs UI.',
        });
      }
    }
  }
  return findings;
}

/** `.ts` files under `root` mentioning `DocfyUiModule.setup` — a cheap text prefilter before parsing. */
function findSetupFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        const file = path.join(dir, entry.name);
        if (fs.readFileSync(file, 'utf8').includes('DocfyUiModule.setup')) found.push(file);
      }
    }
  };
  walk(root);
  return found;
}
