/**
 * Integration test against the real `typescript` compiler API — not a mock.
 * `before()`'s core assumption is that `ts.Program.getCompilerOptions()`
 * exposes a `configFilePath`/`outDir` the same way `ts-loader`/`@nestjs/cli`
 * construct the Program passed into a registered `compilerOptions.plugins`
 * entry (see `@nestjs/cli`'s `PluginsLoader` + webpack `getCustomTransformers`
 * wiring, and `@nestjs/swagger/plugin`'s `before(options, program)` for the
 * precedent). This test builds a real `ts.Program` from an on-disk tsconfig,
 * the same way `ts.parseJsonConfigFileContent` + `ts.createProgram` do it
 * internally, instead of asserting against a hand-shaped fake object.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as ts from 'typescript';
import { before, DOCFY_METADATA_FILENAME } from '../../plugin';

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function createRealProgram(projectRoot: string, configPath: string): ts.Program {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot, undefined, configPath);
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}

describe('before() — against a real ts.Program', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-plugin-integration-'));
    writeFile(
      tmpDir,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'commonjs', outDir: './dist', experimentalDecorators: true },
        include: ['src'],
      }),
    );
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
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('derives configFilePath/outDir from a real Program and writes the metadata file into it', () => {
    const configPath = path.join(tmpDir, 'tsconfig.json');
    const program = createRealProgram(tmpDir, configPath);

    const transformerFactory = before({}, program);

    const outFile = path.join(tmpDir, 'dist', DOCFY_METADATA_FILENAME);
    expect(fs.existsSync(outFile)).toBe(true);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(written['/users'].get.summary).toBe('List users');

    // And the transformer itself is a real identity pass — no AST mutated.
    const sourceFile = program.getSourceFile(path.join(tmpDir, 'src/users.controller.ts'))!;
    const ctx = { factory: ts.factory } as unknown as ts.TransformationContext;
    expect(transformerFactory(ctx)(sourceFile)).toBe(sourceFile);
  });
});
