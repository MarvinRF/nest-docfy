import fs from 'fs';
import os from 'os';
import path from 'path';
import { Project } from 'ts-morph';
import { linkController } from '../../cli/link-controller';
import type { ControllerInfo } from '../../cli/extract-methods';

function makeController(filePath: string, className: string): ControllerInfo {
  return {
    className,
    filePath,
    controllerPath: null,
    methods: [],
    hasDocsFile: false,
    controllerRequiresAuth: false,
  };
}

function loadProject(root: string, fileName: string, content: string): { project: Project; filePath: string } {
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFileAtPath(filePath);
  return { project, filePath };
}

describe('linkController()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-link-controller-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds import and @WithDocs() when neither is present', () => {
    const { project, filePath } = loadProject(
      tmpDir,
      'users.controller.ts',
      `import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`,
    );

    const ctrl = makeController(filePath, 'UsersController');
    const result = linkController(ctrl, project, false);

    expect(result).toEqual({ path: filePath, changed: true });
    const written = fs.readFileSync(filePath, 'utf8');
    expect(written).toContain(`import { WithDocs } from 'nestjs-docfy';`);
    expect(written).toContain('@WithDocs()');
    expect(written).toMatch(/@WithDocs\(\)\s*\n@Controller\('users'\)/);
  });

  it('merges WithDocs into an existing nestjs-docfy import instead of duplicating the declaration', () => {
    const { project, filePath } = loadProject(
      tmpDir,
      'users.controller.ts',
      `import { Controller } from '@nestjs/common';
import { DocfyModule } from 'nestjs-docfy';

@Controller('users')
export class UsersController {}
`,
    );

    const ctrl = makeController(filePath, 'UsersController');
    const result = linkController(ctrl, project, false);

    expect(result?.changed).toBe(true);
    const written = fs.readFileSync(filePath, 'utf8');
    const importMatches = written.match(/from 'nestjs-docfy'/g) ?? [];
    expect(importMatches).toHaveLength(1);
    expect(written).toContain(`import { DocfyModule, WithDocs } from 'nestjs-docfy';`);
  });

  it('is a no-op when @WithDocs() is already present', () => {
    const source = `import { Controller } from '@nestjs/common';
import { WithDocs } from 'nestjs-docfy';

@WithDocs()
@Controller('users')
export class UsersController {}
`;
    const { project, filePath } = loadProject(tmpDir, 'users.controller.ts', source);

    const ctrl = makeController(filePath, 'UsersController');
    const result = linkController(ctrl, project, false);

    expect(result).toEqual({ path: filePath, changed: false });
    expect(fs.readFileSync(filePath, 'utf8')).toBe(source);
  });

  it('reports changed without writing to disk in dry-run mode', () => {
    const source = `import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`;
    const { project, filePath } = loadProject(tmpDir, 'users.controller.ts', source);

    const ctrl = makeController(filePath, 'UsersController');
    const result = linkController(ctrl, project, true);

    expect(result).toEqual({ path: filePath, changed: true });
    expect(fs.readFileSync(filePath, 'utf8')).toBe(source);
  });

  it('returns null when the class cannot be found in the project', () => {
    const { project, filePath } = loadProject(
      tmpDir,
      'users.controller.ts',
      `import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`,
    );

    const ctrl = makeController(filePath, 'DoesNotExistController');
    expect(linkController(ctrl, project, false)).toBeNull();
  });

  it('returns null when the source file is not part of the project', () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const ctrl = makeController(path.join(tmpDir, 'missing.controller.ts'), 'MissingController');
    expect(linkController(ctrl, project, false)).toBeNull();
  });
});
