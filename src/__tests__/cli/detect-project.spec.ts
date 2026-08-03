import path from 'path';
import { detectProject, hasWebpackWithoutPlugin, hasInertSwcPlugin } from '../../cli/detect-project';
import { PathTraversalError } from '../../cli/errors';

const FIXTURES = path.join(__dirname, 'fixtures');
const fix = (name: string) => path.join(FIXTURES, name);

describe('detectProject() — simple project', () => {
  it('detects kind as simple', () => {
    const ctx = detectProject(fix('simple'));
    expect(ctx.kind).toBe('simple');
  });

  it('returns exactly one app', () => {
    const ctx = detectProject(fix('simple'));
    expect(ctx.apps).toHaveLength(1);
  });

  it('resolves tsconfig.json as the tsconfig', () => {
    const ctx = detectProject(fix('simple'));
    expect(ctx.apps[0].tsconfig).toBe(path.join(fix('simple'), 'tsconfig.json'));
  });

  it('app root equals project root', () => {
    const ctx = detectProject(fix('simple'));
    expect(ctx.apps[0].root).toBe(fix('simple'));
  });

  it('resolves entryFile to src/main.ts when it exists', () => {
    const ctx = detectProject(fix('simple'));
    expect(ctx.apps[0].entryFile).toBe(path.join(fix('simple'), 'src/main.ts'));
  });
});

describe('detectProject() — NX monorepo', () => {
  it('detects kind as nx', () => {
    const ctx = detectProject(fix('nx'));
    expect(ctx.kind).toBe('nx');
  });

  it('discovers both apps', () => {
    const ctx = detectProject(fix('nx'));
    const names = ctx.apps.map((a) => a.name).sort();
    expect(names).toEqual(['api', 'worker']);
  });

  it('uses tsConfig from project.json build target when available', () => {
    const ctx = detectProject(fix('nx'));
    const api = ctx.apps.find((a) => a.name === 'api')!;
    expect(api.tsconfig).toBe(path.join(fix('nx'), 'apps/api/tsconfig.app.json'));
  });

  it('falls back to tsconfig.build.json when no build target tsConfig', () => {
    const ctx = detectProject(fix('nx'));
    const worker = ctx.apps.find((a) => a.name === 'worker')!;
    expect(worker.tsconfig).toBe(path.join(fix('nx'), 'apps/worker/tsconfig.build.json'));
  });

  it('all app roots are inside the project root', () => {
    const ctx = detectProject(fix('nx'));
    const root = fix('nx') + path.sep;
    for (const app of ctx.apps) {
      expect(app.root.startsWith(root) || app.root === fix('nx')).toBe(true);
    }
  });

  it('resolves entryFile from the build target main option when present', () => {
    const ctx = detectProject(fix('nx'));
    const api = ctx.apps.find((a) => a.name === 'api')!;
    expect(api.entryFile).toBe(path.join(fix('nx'), 'apps/api/src/main.ts'));
  });

  it('leaves entryFile undefined when neither the main option nor the src/main.ts fallback exists', () => {
    const ctx = detectProject(fix('nx'));
    const worker = ctx.apps.find((a) => a.name === 'worker')!;
    expect(worker.entryFile).toBeUndefined();
  });
});

describe('detectProject() — Nest CLI monorepo', () => {
  it('detects kind as nest-cli-monorepo', () => {
    const ctx = detectProject(fix('nest-cli'));
    expect(ctx.kind).toBe('nest-cli-monorepo');
  });

  it('discovers api and admin apps', () => {
    const ctx = detectProject(fix('nest-cli'));
    const names = ctx.apps.map((a) => a.name).sort();
    expect(names).toEqual(['admin', 'api']);
  });

  it('uses tsConfigPath from compilerOptions when available', () => {
    const ctx = detectProject(fix('nest-cli'));
    const api = ctx.apps.find((a) => a.name === 'api')!;
    expect(api.tsconfig).toBe(path.join(fix('nest-cli'), 'apps/api/tsconfig.app.json'));
  });

  it('falls back to tsconfig.build.json when no compilerOptions.tsConfigPath', () => {
    const ctx = detectProject(fix('nest-cli'));
    const admin = ctx.apps.find((a) => a.name === 'admin')!;
    expect(admin.tsconfig).toBe(path.join(fix('nest-cli'), 'apps/admin/tsconfig.build.json'));
  });

  it('resolves entryFile to src/main.ts (Nest CLI default) when entryFile is not set in nest-cli.json', () => {
    const ctx = detectProject(fix('nest-cli'));
    const api = ctx.apps.find((a) => a.name === 'api')!;
    expect(api.entryFile).toBe(path.join(fix('nest-cli'), 'apps/api/src/main.ts'));
  });

  it('leaves entryFile undefined when src/main.ts does not exist', () => {
    const ctx = detectProject(fix('nest-cli'));
    const admin = ctx.apps.find((a) => a.name === 'admin')!;
    expect(admin.entryFile).toBeUndefined();
  });
});

describe('detectProject() — generic monorepo', () => {
  it('detects kind as generic-monorepo', () => {
    const ctx = detectProject(fix('generic'));
    expect(ctx.kind).toBe('generic-monorepo');
  });

  it('discovers service-a and service-b', () => {
    const ctx = detectProject(fix('generic'));
    const names = ctx.apps.map((a) => a.name).sort();
    expect(names).toEqual(['service-a', 'service-b']);
  });

  it('resolves entryFile to src/main.ts when it exists, leaves it undefined otherwise', () => {
    const ctx = detectProject(fix('generic'));
    const serviceA = ctx.apps.find((a) => a.name === 'service-a')!;
    const serviceB = ctx.apps.find((a) => a.name === 'service-b')!;
    expect(serviceA.entryFile).toBe(path.join(fix('generic'), 'packages/service-a/src/main.ts'));
    expect(serviceB.entryFile).toBeUndefined();
  });

  it('all app roots are inside the project root', () => {
    const ctx = detectProject(fix('generic'));
    const root = fix('generic') + path.sep;
    for (const app of ctx.apps) {
      expect(app.root.startsWith(root)).toBe(true);
    }
  });
});

describe('detectProject() — generic monorepo via package.json "workspaces"', () => {
  it('discovers apps under a custom-named dir declared as "<dir>/*" (array form)', () => {
    const ctx = detectProject(fix('workspaces-custom-name'));
    expect(ctx.kind).toBe('generic-monorepo');
    const names = ctx.apps.map((a) => a.name).sort();
    expect(names).toEqual(['api-svc', 'worker-svc']);
  });

  it('discovers apps under a custom-named dir declared via { packages: [...] } (object form)', () => {
    const ctx = detectProject(fix('workspaces-object-form'));
    expect(ctx.kind).toBe('generic-monorepo');
    expect(ctx.apps.map((a) => a.name)).toEqual(['thing-a']);
  });

  it('still detects packages/apps/services even without a matching "workspaces" field', () => {
    // Regression guard: adding workspaces-derived dir names must not drop
    // the three hardcoded ones the "generic" fixture above relies on.
    const ctx = detectProject(fix('generic'));
    expect(ctx.kind).toBe('generic-monorepo');
  });
});

describe('detectProject() — TS "solution style" tsconfig (project references)', () => {
  it('follows a single reference to the real leaf tsconfig when the root one has no compilerOptions/include of its own', () => {
    const ctx = detectProject(fix('ts-solution-single-ref'));
    expect(ctx.apps[0].tsconfig).toBe(path.join(fix('ts-solution-single-ref'), 'src', 'tsconfig.json'));
  });

  it('follows a reference that points directly at a tsconfig file, not a directory', () => {
    const ctx = detectProject(fix('ts-solution-direct-file-ref'));
    expect(ctx.apps[0].tsconfig).toBe(path.join(fix('ts-solution-direct-file-ref'), 'tsconfig.src.json'));
  });

  it('does not guess when the solution has more than one reference — falls back to the root tsconfig as before', () => {
    // Ambiguous: could be "src" or "test". Guessing either one risks
    // silently missing controllers in the other, the same class of bug
    // this feature fixes for the single-reference case — so it's left
    // unresolved rather than picking one arbitrarily.
    const ctx = detectProject(fix('ts-solution-multi-ref'));
    expect(ctx.apps[0].tsconfig).toBe(path.join(fix('ts-solution-multi-ref'), 'tsconfig.json'));
  });
});

describe('detectProject() — tsconfig override', () => {
  it('uses the override tsconfig for simple projects', () => {
    const override = path.join(fix('simple'), 'tsconfig.json');
    const ctx = detectProject(fix('simple'), override);
    expect(ctx.apps[0].tsconfig).toBe(override);
  });
});

describe('detectProject() — security: path traversal in fixture paths', () => {
  it('does not throw PathTraversalError for valid fixture roots', () => {
    expect(() => detectProject(fix('simple'))).not.toThrow(PathTraversalError);
    expect(() => detectProject(fix('nx'))).not.toThrow(PathTraversalError);
  });
});

describe('hasWebpackWithoutPlugin()', () => {
  it('is true when webpack is true and no plugin is registered', () => {
    expect(hasWebpackWithoutPlugin(fix('webpack-no-plugin'))).toBe(true);
  });

  it('is false when the plugin is registered as a string entry', () => {
    expect(hasWebpackWithoutPlugin(fix('webpack-with-plugin'))).toBe(false);
  });

  it('is false when the plugin is registered as an object entry', () => {
    expect(hasWebpackWithoutPlugin(fix('webpack-with-plugin-object'))).toBe(false);
  });

  it('is false when there is no nest-cli.json at all', () => {
    expect(hasWebpackWithoutPlugin(fix('simple'))).toBe(false);
  });

  it('is false when nest-cli.json has no compilerOptions.webpack', () => {
    expect(hasWebpackWithoutPlugin(fix('nest-cli'))).toBe(false);
  });
});

describe('hasInertSwcPlugin()', () => {
  it('is true when builder is "swc" (string form) and the plugin is registered', () => {
    expect(hasInertSwcPlugin(fix('swc-with-plugin'))).toBe(true);
  });

  it('is true when builder is { type: "swc" } (object form) and the plugin is registered', () => {
    expect(hasInertSwcPlugin(fix('swc-with-plugin-object'))).toBe(true);
  });

  it('is false when builder is "swc" but the plugin is not registered — nothing to warn about', () => {
    expect(hasInertSwcPlugin(fix('swc-no-plugin'))).toBe(false);
  });

  it('is false when the plugin is registered but the builder is not swc', () => {
    expect(hasInertSwcPlugin(fix('webpack-with-plugin'))).toBe(false);
  });

  it('is false when there is no nest-cli.json at all', () => {
    expect(hasInertSwcPlugin(fix('simple'))).toBe(false);
  });

  it('is false when "typeCheck": true is set — the plugin actually works via ReadonlyVisitor then', () => {
    expect(hasInertSwcPlugin(fix('swc-with-plugin-and-typecheck'))).toBe(false);
  });
});
