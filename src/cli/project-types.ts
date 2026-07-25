export type ProjectKind = 'simple' | 'nx' | 'nest-cli-monorepo' | 'generic-monorepo';

export interface ProjectApp {
  /** Human-readable name of the app/lib */
  name: string;
  /** Absolute path to the app/lib root */
  root: string;
  /** Absolute path to the resolved tsconfig for this app */
  tsconfig: string;
  /** Glob pattern to find controllers within this app */
  controllerGlob: string;
}

export interface ProjectContext {
  kind: ProjectKind;
  /** Absolute path to the workspace root */
  root: string;
  /** One entry per compilable unit (app or lib). Simple projects have exactly one entry. */
  apps: ProjectApp[];
}
