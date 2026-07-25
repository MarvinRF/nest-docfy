import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateDocfyMetadata, DOCFY_METADATA_FILENAME } from '../../plugin/generate-metadata';

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

describe('generateDocfyMetadata()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-plugin-test-'));
    writeFile(
      tmpDir,
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs', experimentalDecorators: true } }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes an empty patch when no controller has a companion docs file', () => {
    writeFile(
      tmpDir,
      'src/users.controller.ts',
      `
      function Controller(path?: string) { return (target: any) => {}; }
      function Get(path?: string) { return (target: any, key?: any, desc?: any) => {}; }

      @Controller('users')
      export class UsersController {
        @Get()
        findAll(): string[] { return []; }
      }
      `,
    );

    const result = generateDocfyMetadata({
      tsConfigFilePath: path.join(tmpDir, 'tsconfig.json'),
      projectRoot: tmpDir,
      outDir: path.join(tmpDir, 'dist'),
    });

    expect(result.controllersWithoutDocs).toEqual(['UsersController']);
    expect(result.outFile).toBe(path.join(tmpDir, 'dist', DOCFY_METADATA_FILENAME));
    const written = JSON.parse(fs.readFileSync(result.outFile, 'utf8'));
    expect(written).toEqual({});
    expect(result.patchedOperationCount).toBe(0);
  });

  it('writes the computed SpecPatch from a companion .docs.ts file', () => {
    writeFile(
      tmpDir,
      'src/users.controller.ts',
      `
      function Controller(path?: string) { return (target: any) => {}; }
      function Get(path?: string) { return (target: any, key?: any, desc?: any) => {}; }
      function WithDocs() { return (target: any) => {}; }

      @WithDocs()
      @Controller('users')
      export class UsersController {
        @Get()
        findAll(): string[] { return []; }
      }
      `,
    );
    writeFile(
      tmpDir,
      'src/users.controller.docs.ts',
      `
      function docs(ctrl: any, config: any) {}
      function ApiOperation(opts: any) { return opts; }
      docs(null, {
        classDecorators: [],
        methods: { findAll: [ApiOperation({ summary: 'List users' })] },
      });
      `,
    );

    const result = generateDocfyMetadata({
      tsConfigFilePath: path.join(tmpDir, 'tsconfig.json'),
      projectRoot: tmpDir,
      outDir: path.join(tmpDir, 'dist'),
    });

    expect(result.controllersWithoutDocs).toEqual([]);
    const written = JSON.parse(fs.readFileSync(result.outFile, 'utf8'));
    expect(written['/users'].get.summary).toBe('List users');
    expect(result.patchedOperationCount).toBe(1);
  });

  it('resolves an enum imported from another file into the docs file (real-world case, not just same-file)', () => {
    // Regression test for the exact scenario examples/basic-nest-app hit:
    // the enum lives in its own file (entities/role.enum.ts, say), not
    // inline in the docs file — generateDocfyMetadata reuses the same
    // scanApp() project across all docs files precisely so this resolves.
    writeFile(tmpDir, 'src/role.enum.ts', `export enum Role { Member = 'member', Admin = 'admin' }`);
    writeFile(
      tmpDir,
      'src/users.controller.ts',
      `
      function Controller(path?: string) { return (target: any) => {}; }
      function Get(path?: string) { return (target: any, key?: any, desc?: any) => {}; }
      function WithDocs() { return (target: any) => {}; }

      @WithDocs()
      @Controller('users')
      export class UsersController {
        @Get()
        findAll(): string[] { return []; }
      }
      `,
    );
    writeFile(
      tmpDir,
      'src/users.controller.docs.ts',
      `
      function docs(ctrl: any, config: any) {}
      function ApiQuery(opts: any) { return opts; }
      import { Role } from './role.enum';
      docs(null, {
        classDecorators: [],
        methods: { findAll: [ApiQuery({ name: 'role', enum: Role })] },
      });
      `,
    );

    const result = generateDocfyMetadata({
      tsConfigFilePath: path.join(tmpDir, 'tsconfig.json'),
      projectRoot: tmpDir,
      outDir: path.join(tmpDir, 'dist'),
    });

    const written = JSON.parse(fs.readFileSync(result.outFile, 'utf8'));
    expect(written['/users'].get.parameters[0].schema.enum).toEqual(['member', 'admin']);
  });

  it('creates the output directory if it does not exist yet', () => {
    writeFile(
      tmpDir,
      'src/users.controller.ts',
      `
      function Controller(path?: string) { return (target: any) => {}; }
      export class UsersController {}
      `,
    );

    const outDir = path.join(tmpDir, 'dist', 'nested', 'output');
    const result = generateDocfyMetadata({
      tsConfigFilePath: path.join(tmpDir, 'tsconfig.json'),
      projectRoot: tmpDir,
      outDir,
    });

    expect(fs.existsSync(result.outFile)).toBe(true);
  });
});
