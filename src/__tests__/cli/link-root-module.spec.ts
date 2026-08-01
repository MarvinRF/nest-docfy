import fs from 'fs';
import os from 'os';
import path from 'path';
import { Project } from 'ts-morph';
import { linkRootModule } from '../../cli/link-root-module';
import type { RootModuleLocation } from '../../cli/find-root-module';

function loadLocation(root: string, fileName: string, content: string, className: string): RootModuleLocation {
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.addSourceFileAtPath(filePath);
  const classDecl = sourceFile.getClassOrThrow(className);
  return { sourceFile, classDecl };
}

describe('linkRootModule()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-link-root-module-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the imports array and adds the import when the module has no imports property', () => {
    const location = loadLocation(
      tmpDir,
      'app.module.ts',
      `import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
`,
      'AppModule',
    );

    const result = linkRootModule(location, false);

    expect(result).toEqual({ path: path.join(tmpDir, 'app.module.ts'), changed: true });
    const written = fs.readFileSync(path.join(tmpDir, 'app.module.ts'), 'utf8');
    expect(written).toContain(`import { DocfyModule } from 'nestjs-docfy';`);
    expect(written).toContain('imports: [DocfyModule.forRoot()]');
  });

  it('inserts into an existing imports array without dropping other entries', () => {
    const location = loadLocation(
      tmpDir,
      'app.module.ts',
      `import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';

@Module({
  imports: [UsersModule],
})
export class AppModule {}
`,
      'AppModule',
    );

    const result = linkRootModule(location, false);

    expect(result?.changed).toBe(true);
    const written = fs.readFileSync(path.join(tmpDir, 'app.module.ts'), 'utf8');
    expect(written).toContain('imports: [DocfyModule.forRoot(), UsersModule]');
  });

  it('merges DocfyModule into an existing nestjs-docfy import instead of duplicating the declaration', () => {
    const location = loadLocation(
      tmpDir,
      'app.module.ts',
      `import { Module } from '@nestjs/common';
import { WithDocs } from 'nestjs-docfy';

@Module({ imports: [] })
export class AppModule {}
`,
      'AppModule',
    );

    linkRootModule(location, false);

    const written = fs.readFileSync(path.join(tmpDir, 'app.module.ts'), 'utf8');
    const importMatches = written.match(/from 'nestjs-docfy'/g) ?? [];
    expect(importMatches).toHaveLength(1);
    expect(written).toContain(`import { WithDocs, DocfyModule } from 'nestjs-docfy';`);
  });

  it('is a no-op when DocfyModule.forRoot() is already present', () => {
    const source = `import { Module } from '@nestjs/common';
import { DocfyModule } from 'nestjs-docfy';

@Module({
  imports: [DocfyModule.forRoot()],
})
export class AppModule {}
`;
    const location = loadLocation(tmpDir, 'app.module.ts', source, 'AppModule');

    const result = linkRootModule(location, false);

    expect(result).toEqual({ path: path.join(tmpDir, 'app.module.ts'), changed: false });
    expect(fs.readFileSync(path.join(tmpDir, 'app.module.ts'), 'utf8')).toBe(source);
  });

  it('reports changed without writing to disk in dry-run mode', () => {
    const source = `import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
`;
    const location = loadLocation(tmpDir, 'app.module.ts', source, 'AppModule');

    const result = linkRootModule(location, true);

    expect(result).toEqual({ path: path.join(tmpDir, 'app.module.ts'), changed: true });
    expect(fs.readFileSync(path.join(tmpDir, 'app.module.ts'), 'utf8')).toBe(source);
  });

  it('returns null when the class has no @Module decorator', () => {
    const location = loadLocation(tmpDir, 'app.module.ts', `export class AppModule {}\n`, 'AppModule');
    expect(linkRootModule(location, false)).toBeNull();
  });

  it('returns null when the @Module argument is not an object literal', () => {
    const location = loadLocation(
      tmpDir,
      'app.module.ts',
      `import { Module } from '@nestjs/common';

const config = {};

@Module(config)
export class AppModule {}
`,
      'AppModule',
    );
    expect(linkRootModule(location, false)).toBeNull();
  });

  it('returns null when imports exists but is not a plain array literal (spread)', () => {
    const location = loadLocation(
      tmpDir,
      'app.module.ts',
      `import { Module } from '@nestjs/common';

const extraImports = [];

@Module({
  imports: extraImports,
})
export class AppModule {}
`,
      'AppModule',
    );
    expect(linkRootModule(location, false)).toBeNull();
  });
});
