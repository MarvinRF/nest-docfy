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

const TSCONFIG_CANDIDATES = [
  'tsconfig.build.json',
  'tsconfig.app.json',
  'tsconfig.json',
];

function findTsconfig(appRoot: string, projectRoot: string): string {
  for (const candidate of TSCONFIG_CANDIDATES) {
    const resolved = path.join(appRoot, candidate);
    try {
      assertWithinRoot(resolved, projectRoot);
      if (exists(resolved)) return resolved;
    } catch {
      continue;
    }
  }
  throw new ConfigNotFoundError(
    `No tsconfig found in "${appRoot}". Tried: ${TSCONFIG_CANDIDATES.join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
// Strategy: simple project
// ---------------------------------------------------------------------------

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

      const projectJson = safeReadJson<NxProjectJson>(
        path.join(appRoot, 'project.json'),
        root,
      );
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

      apps.push({
        name: projectJson.name ?? entry,
        root: appRoot,
        tsconfig,
        controllerGlob: '**/*.controller.ts',
      });
    }
  }

  // Also check workspace.json for older NX layouts
  if (apps.length === 0) {
    const workspaceJson = safeReadJson<NxWorkspaceJson>(
      path.join(root, 'workspace.json'),
      root,
    );
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
        apps.push({ name, root: appRoot, tsconfig, controllerGlob: '**/*.controller.ts' });
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

interface NestCliJson {
  monorepo?: boolean;
  projects?: Record<
    string,
    {
      type?: string;
      root?: string;
      entryFile?: string;
      compilerOptions?: { tsConfigPath?: string };
    }
  >;
}

function detectNestCliMonorepo(
  root: string,
  nestCliJson: NestCliJson,
  tsconfigOverride?: string,
): ProjectContext {
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

function detectGenericMonorepo(
  root: string,
  tsconfigOverride?: string,
): ProjectContext {
  const apps: ProjectApp[] = [];
  const scanDirs = ['packages', 'apps', 'services'].map((d) => path.join(root, d));

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
      });
    }
  }

  if (apps.length === 0) {
    return detectSimple(root, tsconfigOverride);
  }

  return { kind: 'generic-monorepo', root, apps };
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
 *   3. packages/ or apps/ with sub-package.json → generic monorepo
 *   4. fallback → simple project
 */
export function detectProject(
  root: string,
  tsconfigOverride?: string,
): ProjectContext {
  const absRoot = path.resolve(root);

  // 1. NX
  if (exists(path.join(absRoot, 'nx.json'))) {
    return detectNx(absRoot, tsconfigOverride);
  }

  // 2. Nest CLI monorepo
  const nestCli = safeReadJson<NestCliJson>(
    path.join(absRoot, 'nest-cli.json'),
    absRoot,
  );
  if (nestCli?.monorepo === true && nestCli.projects) {
    return detectNestCliMonorepo(absRoot, nestCli, tsconfigOverride);
  }

  // 3. Generic monorepo
  const hasSubPackages = ['packages', 'apps', 'services'].some((dir) => {
    const d = path.join(absRoot, dir);
    if (!exists(d)) return false;
    try {
      return fs.readdirSync(d).some((entry) =>
        exists(path.join(d, entry, 'package.json')),
      );
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
