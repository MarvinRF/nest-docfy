import fs from 'fs';
import os from 'os';
import path from 'path';
import { Project } from 'ts-morph';
import { findRootModule } from '../../cli/find-root-module';

function writeFile(root: string, relPath: string, content: string): void {
  const filePath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function loadProject(root: string): Project {
  writeFile(
    root,
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: { module: 'commonjs', target: 'es2020', experimentalDecorators: true, strict: false },
      include: ['**/*.ts'],
    }),
  );
  return new Project({
    tsConfigFilePath: path.join(root, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
    skipFileDependencyResolution: true,
  });
}

describe('findRootModule()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-find-root-module-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds the module class passed to NestFactory.create(AppModule)', () => {
    writeFile(
      tmpDir,
      'src/main.ts',
      `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
`,
    );
    writeFile(
      tmpDir,
      'src/app.module.ts',
      `import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
`,
    );
    const project = loadProject(tmpDir);

    const location = findRootModule(project, path.join(tmpDir, 'src/main.ts'));

    expect(location).not.toBeNull();
    expect(location!.classDecl.getName()).toBe('AppModule');
    expect(location!.sourceFile.getFilePath()).toBe(path.join(tmpDir, 'src/app.module.ts'));
  });

  it('finds the module when NestFactory.create has a generic type argument', () => {
    writeFile(
      tmpDir,
      'src/main.ts',
      `import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  await app.listen(3000);
}
bootstrap();
`,
    );
    writeFile(
      tmpDir,
      'src/app.module.ts',
      `import { Module } from '@nestjs/common';\n\n@Module({})\nexport class AppModule {}\n`,
    );
    const project = loadProject(tmpDir);

    const location = findRootModule(project, path.join(tmpDir, 'src/main.ts'));

    expect(location).not.toBeNull();
    expect(location!.classDecl.getName()).toBe('AppModule');
  });

  it('returns null when the entry file is not part of the project', () => {
    const project = loadProject(tmpDir);
    expect(findRootModule(project, path.join(tmpDir, 'src/does-not-exist.ts'))).toBeNull();
  });

  it('returns null when there is no NestFactory.create call', () => {
    writeFile(tmpDir, 'src/main.ts', `console.log('no bootstrap here');\n`);
    const project = loadProject(tmpDir);
    expect(findRootModule(project, path.join(tmpDir, 'src/main.ts'))).toBeNull();
  });

  it('returns null when the NestFactory.create argument is not a simple identifier', () => {
    writeFile(
      tmpDir,
      'src/main.ts',
      `import { NestFactory } from '@nestjs/core';
import { createAppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(createAppModule());
  await app.listen(3000);
}
bootstrap();
`,
    );
    writeFile(tmpDir, 'src/app.module.ts', `export function createAppModule() { return class {}; }\n`);
    const project = loadProject(tmpDir);
    expect(findRootModule(project, path.join(tmpDir, 'src/main.ts'))).toBeNull();
  });

  it('returns null when the import for the module class cannot be found', () => {
    writeFile(
      tmpDir,
      'src/main.ts',
      `import { NestFactory } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
`,
    );
    const project = loadProject(tmpDir);
    expect(findRootModule(project, path.join(tmpDir, 'src/main.ts'))).toBeNull();
  });

  it('returns null when the resolved class has no @Module decorator', () => {
    writeFile(
      tmpDir,
      'src/main.ts',
      `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
`,
    );
    writeFile(tmpDir, 'src/app.module.ts', `export class AppModule {}\n`);
    const project = loadProject(tmpDir);
    expect(findRootModule(project, path.join(tmpDir, 'src/main.ts'))).toBeNull();
  });
});
