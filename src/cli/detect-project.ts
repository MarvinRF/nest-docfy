import fs from 'fs';
import path from 'path';
import { assertWithinRoot } from './parse-args';
import { ConfigNotFoundError } from './errors';
import type { ProjectContext, ProjectApp } from './project-types';

// ---------------------------------------------------------------------------
// Safe JSON reader — never throws on missing file, always validates path
// ---------------------------------------------------------------------------

function safeReadJson<T>(filePath: string, root: string): T | null {
  try {
    assertWithinRoot(filePath, root);
  } catch {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function exists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tsconfig candidate resolution (project-type-agnostic helper)
// ---------------------------------------------------------------------------

const TSCONFIG_CANDIDATES = ['tsconfig.build.json', 'tsconfig.app.json', 'tsconfig.json'];

interface TsConfigLike {
  references?: { path?: string }[];
  include?: unknown;
  files?: unknown[];
}

/**
 * A TS "solution style" config — orchestrates project references but has no
 * `compilerOptions`/source list of its own (`"files": []` or no `include`
 * at all). ts-morph's `Project({ tsConfigFilePath })` loads exactly the
 * files a tsconfig resolves to, same as `tsc` — pointed at one of these, it
 * silently resolves zero source files, so every controller underneath
 * disappears with no error, just an unhelpful "No controllers found".
 * Confirmed by reproduction (2026-08-03): a root `tsconfig.json` with only
 * `references` picked over the real leaf config purely because it's named
 * `tsconfig.json` (the last, most generic candidate above).
 */
function readSolutionTsConfig(tsconfigPath: string): TsConfigLike | undefined {
  let json: TsConfigLike;
  try {
    json = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as TsConfigLike;
  } catch {
    return undefined;
  }
  const hasReferences = Array.isArray(json.references) && json.references.length > 0;
  const hasOwnSourceList = 'include' in json || (Array.isArray(json.files) && json.files.length > 0);
  return hasReferences && !hasOwnSourceList ? json : undefined;
}

function resolveReferencedTsconfig(fromDir: string, referencePath: string): string | undefined {
  const resolved = path.resolve(fromDir, referencePath);
  if (resolved.endsWith('.json')) return exists(resolved) ? resolved : undefined;
  const nested = path.join(resolved, 'tsconfig.json');
  return exists(nested) ? nested : undefined;
}

function findTsconfig(appRoot: string, projectRoot: string): string {
  for (const candidate of TSCONFIG_CANDIDATES) {
    const resolved = path.join(appRoot, candidate);
    try {
      assertWithinRoot(resolved, projectRoot);
      if (!exists(resolved)) continue;

      const solution = readSolutionTsConfig(resolved);
      // Only auto-resolve the unambiguous case (exactly one reference) — a
      // solution fanning out into several real projects needs one ProjectApp
      // per project to scan all of them, a bigger feature than this fixes;
      // silently guessing which single one has the controllers would trade
      // one silent gap for another.
      if (solution?.references?.length === 1) {
        const refPath = solution.references[0].path;
        const leaf = refPath ? resolveReferencedTsconfig(path.dirname(resolved), refPath) : undefined;
        if (leaf) return leaf;
      }

      return resolved;
    } catch {
      continue;
    }
  }
  throw new ConfigNotFoundError(`No tsconfig found in "${appRoot}". Tried: ${TSCONFIG_CANDIDATES.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Strategy: simple project
// ---------------------------------------------------------------------------

function findEntryFile(candidate: string, projectRoot: string): string | undefined {
  try {
    assertWithinRoot(candidate, projectRoot);
  } catch {
    return undefined;
  }
  return exists(candidate) ? candidate : undefined;
}

function detectSimple(root: string, tsconfigOverride?: string): ProjectContext {
  const tsconfig = tsconfigOverride ?? findTsconfig(root, root);
  return {
    kind: 'simple',
    root,
    apps: [
      {
        name: path.basename(root),
        root,
        tsconfig,
        controllerGlob: '**/*.controller.ts',
        entryFile: findEntryFile(path.join(root, 'src/main.ts'), root),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Strategy: NX monorepo
// ---------------------------------------------------------------------------

interface NxProjectJson {
  name?: string;
  targets?: {
    build?: {
      options?: {
        tsConfig?: string;
        main?: string;
      };
    };
  };
  sourceRoot?: string;
}

interface NxWorkspaceJson {
  projects?: Record<string, string | { root: string }>;
}

function detectNx(root: string, tsconfigOverride?: string): ProjectContext {
  // nx.json signals an NX workspace; project roots come from project.json files
  // or workspace.json / nx.json projects map (NX >=14 uses project.json per-project)
  const apps: ProjectApp[] = [];

  // Walk known app/lib dirs: apps/, libs/, packages/
  const scanDirs = ['apps', 'libs', 'packages'].map((d) => path.join(root, d));

  for (const scanDir of scanDirs) {
    if (!exists(scanDir)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(scanDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const appRoot = path.join(scanDir, entry);

      // Validate each resolved path stays within project root
      try {
        assertWithinRoot(appRoot, root);
      } catch {
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(appRoot);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const projectJson = safeReadJson<NxProjectJson>(path.join(appRoot, 'project.json'), root);
      if (!projectJson) continue;

      // Resolve tsconfig: prefer build target tsConfig, then fallback candidates
      let tsconfig: string | undefined;
      const buildTsConfig = projectJson.targets?.build?.options?.tsConfig;
      if (buildTsConfig) {
        const resolved = path.resolve(root, buildTsConfig);
        try {
          assertWithinRoot(resolved, root);
          if (exists(resolved)) tsconfig = resolved;
        } catch {
          // untrusted path — fall through to candidates
        }
      }

      if (!tsconfig) {
        try {
          tsconfig = tsconfigOverride ?? findTsconfig(appRoot, root);
        } catch {
          continue; // skip apps without any tsconfig
        }
      }

      const mainOption = projectJson.targets?.build?.options?.main;
      const entryFile = mainOption
        ? findEntryFile(path.resolve(root, mainOption), root)
        : findEntryFile(path.join(appRoot, 'src/main.ts'), root);

      apps.push({
        name: projectJson.name ?? entry,
        root: appRoot,
        tsconfig,
        controllerGlob: '**/*.controller.ts',
        entryFile,
      });
    }
  }

  // Also check workspace.json for older NX layouts
  if (apps.length === 0) {
    const workspaceJson = safeReadJson<NxWorkspaceJson>(path.join(root, 'workspace.json'), root);
    if (workspaceJson?.projects) {
      for (const [name, value] of Object.entries(workspaceJson.projects)) {
        const appRelRoot = typeof value === 'string' ? value : value.root;
        const appRoot = path.resolve(root, appRelRoot);
        try {
          assertWithinRoot(appRoot, root);
        } catch {
          continue;
        }
        let tsconfig: string;
        try {
          tsconfig = tsconfigOverride ?? findTsconfig(appRoot, root);
        } catch {
          continue;
        }
        apps.push({
          name,
          root: appRoot,
          tsconfig,
          controllerGlob: '**/*.controller.ts',
          entryFile: findEntryFile(path.join(appRoot, 'src/main.ts'), root),
        });
      }
    }
  }

  if (apps.length === 0) {
    // Fallback: treat as simple if NX layout is non-standard
    return detectSimple(root, tsconfigOverride);
  }

  return { kind: 'nx', root, apps };
}

// ---------------------------------------------------------------------------
// Strategy: Nest CLI monorepo
// ---------------------------------------------------------------------------

interface CompilerOptions {
  tsConfigPath?: string;
  webpack?: boolean;
  builder?: string | { type?: string };
  plugins?: unknown[];
  typeCheck?: boolean;
}

interface NestCliJson {
  monorepo?: boolean;
  projects?: Record<
    string,
    {
      type?: string;
      root?: string;
      entryFile?: string;
      compilerOptions?: CompilerOptions;
    }
  >;
  compilerOptions?: CompilerOptions;
}

function detectNestCliMonorepo(root: string, nestCliJson: NestCliJson, tsconfigOverride?: string): ProjectContext {
  const apps: ProjectApp[] = [];

  for (const [name, config] of Object.entries(nestCliJson.projects ?? {})) {
    const appRelRoot = config.root ?? name;
    const appRoot = path.resolve(root, appRelRoot);

    try {
      assertWithinRoot(appRoot, root);
    } catch {
      continue;
    }

    let tsconfig: string | undefined;
    const tsConfigPath = config.compilerOptions?.tsConfigPath;
    if (tsConfigPath) {
      const resolved = path.resolve(root, tsConfigPath);
      try {
        assertWithinRoot(resolved, root);
        if (exists(resolved)) tsconfig = resolved;
      } catch {
        // untrusted — fall through
      }
    }

    if (!tsconfig) {
      try {
        tsconfig = tsconfigOverride ?? findTsconfig(appRoot, root);
      } catch {
        continue;
      }
    }

    apps.push({
      name,
      root: appRoot,
      tsconfig,
      controllerGlob: '**/*.controller.ts',
      entryFile: findEntryFile(path.join(appRoot, `${config.entryFile ?? 'src/main'}.ts`), root),
    });
  }

  if (apps.length === 0) {
    return detectSimple(root, tsconfigOverride);
  }

  return { kind: 'nest-cli-monorepo', root, apps };
}

// ---------------------------------------------------------------------------
// Strategy: generic monorepo (packages/ with sub-package.json)
// ---------------------------------------------------------------------------

const GENERIC_MONOREPO_DIR_NAMES = ['packages', 'apps', 'services'];

interface RootPackageJson {
  workspaces?: string[] | { packages?: string[] };
}

/**
 * Directory names implied by npm/yarn `workspaces` glob patterns in the root
 * package.json (e.g. `"workspaces/*"` → `"workspaces"`) — covers monorepos
 * that don't use one of the three hardcoded names above (Turborepo, Lerna
 * with `useWorkspaces: true`, or a plain custom-named workspace layout).
 * Only the common single-level-wildcard shape is understood, matching how
 * real-world workspaces fields are written in practice — a pattern like
 * `"packages/**"` or a scoped sub-glob is silently skipped rather than
 * guessed at (no full glob engine here; see `docs/compatibility-matrix.md`
 * for the patterns still not covered).
 */
function workspaceScanDirNames(root: string): string[] {
  const pkg = safeReadJson<RootPackageJson>(path.join(root, 'package.json'), root);
  const patterns = Array.isArray(pkg?.workspaces) ? pkg.workspaces : (pkg?.workspaces?.packages ?? []);
  const names = new Set<string>();
  for (const pattern of patterns) {
    const match = /^([^*]+)\/\*$/.exec(pattern);
    if (match) names.add(match[1]);
  }
  return [...names];
}

function monorepoScanDirNames(root: string): string[] {
  return [...new Set([...GENERIC_MONOREPO_DIR_NAMES, ...workspaceScanDirNames(root)])];
}

function detectGenericMonorepo(root: string, tsconfigOverride?: string): ProjectContext {
  const apps: ProjectApp[] = [];
  const scanDirs = monorepoScanDirNames(root).map((d) => path.join(root, d));

  for (const scanDir of scanDirs) {
    if (!exists(scanDir)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(scanDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const appRoot = path.join(scanDir, entry);
      try {
        assertWithinRoot(appRoot, root);
      } catch {
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(appRoot);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      // Only treat as an app if it has its own package.json
      if (!exists(path.join(appRoot, 'package.json'))) continue;

      let tsconfig: string;
      try {
        tsconfig = tsconfigOverride ?? findTsconfig(appRoot, root);
      } catch {
        continue;
      }

      apps.push({
        name: entry,
        root: appRoot,
        tsconfig,
        controllerGlob: '**/*.controller.ts',
        entryFile: findEntryFile(path.join(appRoot, 'src/main.ts'), root),
      });
    }
  }

  if (apps.length === 0) {
    return detectSimple(root, tsconfigOverride);
  }

  return { kind: 'generic-monorepo', root, apps };
}

// ---------------------------------------------------------------------------
// webpack: true without the CLI plugin registered
// ---------------------------------------------------------------------------

export function pluginListHasDocfy(plugins: unknown[]): boolean {
  return plugins.some((p) => {
    if (typeof p === 'string') return p === 'nestjs-docfy';
    if (p && typeof p === 'object' && 'name' in p) return (p as { name?: unknown }).name === 'nestjs-docfy';
    return false;
  });
}

function builderType(builder: string | { type?: string } | undefined): string | undefined {
  if (typeof builder === 'string') return builder;
  return builder?.type;
}

/**
 * `@nestjs/cli` lets each project in a Nest CLI monorepo override
 * `compilerOptions` individually (`projects.<name>.compilerOptions`),
 * falling back to the root `compilerOptions` value when a project doesn't
 * set its own — confirmed by reading `@nestjs/cli`'s own
 * `getValueOrDefault()` (`lib/compiler/helpers/get-value-or-default.js`),
 * which every build-time lookup (`webpack`, `builder`, `plugins`,
 * `typeCheck`) goes through. Reproduced: a two-project monorepo with no
 * root `webpack` setting but `projects.worker.compilerOptions.webpack: true`
 * builds `worker` under webpack for real — while a check that only reads
 * the root `compilerOptions` (as this file used to) sees nothing wrong and
 * never warns, even though that project's runtime discovery is broken.
 */
function effectiveCompilerOptions(nestCli: NestCliJson, projectName: string | undefined): CompilerOptions {
  const root = nestCli.compilerOptions ?? {};
  if (!projectName) return root;
  return { ...root, ...(nestCli.projects?.[projectName]?.compilerOptions ?? {}) };
}

/** Project names to check — each configured project, or `undefined` (meaning "the root itself") when there's no `projects` map at all. */
function projectTargets(nestCli: NestCliJson): (string | undefined)[] {
  const names = Object.keys(nestCli.projects ?? {});
  return names.length > 0 ? names : [undefined];
}

/**
 * Names of every project (or `''` for a non-monorepo root) whose *effective*
 * `compilerOptions` has `webpack: true` but no `nestjs-docfy` registered
 * under `plugins` — the runtime discovery mechanism (`@WithDocs()` +
 * `DocfyModule`) silently does not work in that build mode, and the CLI
 * plugin is the sanctioned fix. Empty array means nothing is wrong.
 */
export function projectsWithWebpackWithoutPlugin(root: string): string[] {
  const nestCli = safeReadJson<NestCliJson>(path.join(root, 'nest-cli.json'), root);
  if (!nestCli) return [];
  const affected: string[] = [];
  for (const name of projectTargets(nestCli)) {
    const opts = effectiveCompilerOptions(nestCli, name);
    if (opts.webpack && !pluginListHasDocfy(opts.plugins ?? [])) affected.push(name ?? '');
  }
  return affected;
}

/**
 * Names of every project (or `''` for a non-monorepo root) whose *effective*
 * `compilerOptions` registers `nestjs-docfy` under `plugins`, builds with
 * the SWC builder (`"builder": "swc"` or `{ "type": "swc" }`), and does NOT
 * have `"typeCheck": true` set — the one remaining condition where this
 * plugin is a no-op under SWC. Confirmed against `@nestjs/cli`'s own
 * compiler sources (`SwcCompiler`/`forked-type-checker`): under this builder
 * the CLI only invokes plugins via `ReadonlyVisitor` (which the plugin now
 * exports, see `src/plugin/index.ts`), and only when `runTypeChecker`
 * actually runs — gated on `compilerOptions.typeCheck` (read via the exact
 * same `getValueOrDefault(configuration, 'compilerOptions.typeCheck', ...)`
 * call `@nestjs/cli`'s own `build.action.js` uses, per-project override
 * included). Without `typeCheck: true`, SWC does no type-checking of its own
 * and neither this plugin's `ReadonlyVisitor` nor `@nestjs/swagger`'s
 * equivalent ever gets invoked — not a new burden this adds, the same
 * condition `@nestjs/swagger`'s own SWC support already requires. The build
 * succeeds silently either way, with zero `docfy-metadata.json` produced
 * and no warning of its own. Empty array means nothing is wrong.
 */
export function projectsWithInertSwcPlugin(root: string): string[] {
  const nestCli = safeReadJson<NestCliJson>(path.join(root, 'nest-cli.json'), root);
  if (!nestCli) return [];
  const affected: string[] = [];
  for (const name of projectTargets(nestCli)) {
    const opts = effectiveCompilerOptions(nestCli, name);
    if (builderType(opts.builder) === 'swc' && opts.typeCheck !== true && pluginListHasDocfy(opts.plugins ?? [])) {
      affected.push(name ?? '');
    }
  }
  return affected;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Detects the project type and returns a ProjectContext with one entry per
 * compilable unit. All paths in the result are absolute and validated to
 * stay within `root`.
 *
 * Detection order (first match wins):
 *   1. nx.json present → NX monorepo
 *   2. nest-cli.json with monorepo:true → Nest CLI monorepo
 *   3. packages/, apps/, services/, or a dir implied by package.json's
 *      "workspaces" field, with sub-package.json → generic monorepo
 *   4. fallback → simple project
 */
export function detectProject(root: string, tsconfigOverride?: string): ProjectContext {
  const absRoot = path.resolve(root);

  // 1. NX
  if (exists(path.join(absRoot, 'nx.json'))) {
    return detectNx(absRoot, tsconfigOverride);
  }

  // 2. Nest CLI monorepo
  const nestCli = safeReadJson<NestCliJson>(path.join(absRoot, 'nest-cli.json'), absRoot);
  if (nestCli?.monorepo === true && nestCli.projects) {
    return detectNestCliMonorepo(absRoot, nestCli, tsconfigOverride);
  }

  // 3. Generic monorepo
  const hasSubPackages = monorepoScanDirNames(absRoot).some((dir) => {
    const d = path.join(absRoot, dir);
    if (!exists(d)) return false;
    try {
      return fs.readdirSync(d).some((entry) => exists(path.join(d, entry, 'package.json')));
    } catch {
      return false;
    }
  });
  if (hasSubPackages) {
    return detectGenericMonorepo(absRoot, tsconfigOverride);
  }

  // 4. Simple
  return detectSimple(absRoot, tsconfigOverride);
}
