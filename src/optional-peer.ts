/**
 * Loads an optional peer dependency, turning a bare MODULE_NOT_FOUND into an error that names
 * the feature that needs it and the exact install command. Build-time tooling (CLI, plugin) and
 * framework-specific code (express) are optional peers so that an app using only the runtime
 * module never installs them into production.
 */
export function requireOptionalPeer<T>(name: string, feature: string, dev = true): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name) as T;
  } catch (err) {
    if (isMissing(err, name)) throw new Error(missingPeerMessage([name], feature, dev), { cause: err });
    throw err;
  }
}

/** Names from `names` that cannot be resolved from this package. */
export function findMissingPeers(names: readonly string[]): string[] {
  return names.filter((name) => {
    try {
      require.resolve(name);
      return false;
    } catch {
      return true;
    }
  });
}

export function missingPeerMessage(names: readonly string[], feature: string, dev = true): string {
  const list = names.map((n) => `"${n}"`).join(', ');
  return (
    `[nestjs-docfy] ${feature} needs the optional peer ${names.length > 1 ? 'dependencies' : 'dependency'} ${list}. ` +
    `Install with: npm install ${dev ? '--save-dev ' : ''}${names.join(' ')}\n` +
    'Since 0.19 these are no longer installed automatically, so apps that only use the runtime module ' +
    "don't ship build tooling to production. See https://github.com/MarvinRF/nest-docfy#security"
  );
}

/** True only when `name` itself is missing — not when it is installed but one of its own dependencies is. */
function isMissing(err: unknown, name: string): boolean {
  // Duck-typed: errors thrown across realms (e.g. by a test runner's module loader) fail `instanceof Error`.
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.startsWith(`Cannot find module '${name}'`);
}

/** Peers every CLI command and the build plugin load. `openapi-typescript` is loaded only by `generate-client`. */
export const BUILD_TOOLING_PEERS = ['ts-morph', 'commander', 'picocolors'] as const;
