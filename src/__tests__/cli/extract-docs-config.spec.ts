import fs from 'fs';
import os from 'os';
import path from 'path';
import { Project } from 'ts-morph';
import { extractDocsConfig } from '../../cli/extract-docs-config';

const SAMPLE = `
import { docs } from 'nestjs-docfy';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { UsersController } from './users.controller';
import { CreateUserDto } from './create-user.dto';

docs(UsersController, {
  classDecorators: [
    ApiTags('users'),
  ],
  methods: {
    findAll: [
      ApiOperation({ summary: 'List users' }),
      ApiResponse({ status: 200, description: 'Users found' }),
    ],
    create: [
      ApiOperation({ summary: 'Create user' }),
      ApiBody({ type: CreateUserDto }),
      ApiResponse({ status: 201, description: 'Created' }),
      ApiBearerAuth(),
    ],
  },
});
`;

describe('extractDocsConfig()', () => {
  it('extracts classDecorators with evaluated args', () => {
    const result = extractDocsConfig(SAMPLE);
    expect(result?.classDecorators).toEqual([{ name: 'ApiTags', args: ['users'] }]);
  });

  it('extracts every method key with its decorator calls', () => {
    const result = extractDocsConfig(SAMPLE);
    expect(Object.keys(result!.methods)).toEqual(['findAll', 'create']);
  });

  it('evaluates ApiOperation/ApiResponse object args for a method', () => {
    const result = extractDocsConfig(SAMPLE);
    expect(result!.methods.findAll).toEqual([
      { name: 'ApiOperation', args: [{ summary: 'List users' }] },
      { name: 'ApiResponse', args: [{ status: 200, description: 'Users found' }] },
    ]);
  });

  it('marks ApiBody({ type: SomeDto }) — a class reference — as Unresolved, without throwing', () => {
    const result = extractDocsConfig(SAMPLE);
    const apiBody = result!.methods.create.find((c) => c.name === 'ApiBody');
    expect(apiBody).toBeDefined();
    const typeArg = (apiBody!.args[0] as Record<string, unknown>).type as { __unresolved: boolean };
    expect(typeArg.__unresolved).toBe(true);
  });

  it('extracts a zero-argument decorator call (ApiBearerAuth)', () => {
    const result = extractDocsConfig(SAMPLE);
    expect(result!.methods.create).toContainEqual({ name: 'ApiBearerAuth', args: [] });
  });

  it('returns null when there is no docs(...) call', () => {
    expect(extractDocsConfig('export const x = 1;')).toBeNull();
  });

  it('returns null for unparseable source', () => {
    expect(extractDocsConfig('docs(Foo, ')).toBeNull();
  });

  it('returns empty classDecorators/methods when docs() is called with an empty config', () => {
    const result = extractDocsConfig(`docs(Foo, {});`);
    expect(result).toEqual({ classDecorators: [], methods: {} });
  });
});

describe('extractDocsConfig() — with a real project context (cross-file resolution)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfy-extract-docs-config-test-'));
    fs.writeFileSync(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs' } }),
    );
    fs.writeFileSync(path.join(tmpDir, 'role.enum.ts'), `export enum Role { Member = 'member', Admin = 'admin' }`);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves an enum imported from another file when a project + absolutePath are given', () => {
    const project = new Project({
      tsConfigFilePath: path.join(tmpDir, 'tsconfig.json'),
      skipAddingFilesFromTsConfig: false,
    });
    const docsPath = path.join(tmpDir, 'users.controller.docs.ts');
    const source = `
      import { docs } from 'nestjs-docfy';
      import { ApiQuery } from '@nestjs/swagger';
      import { UsersController } from './users.controller';
      import { Role } from './role.enum';

      docs(UsersController, {
        classDecorators: [],
        methods: { findAll: [ApiQuery({ name: 'role', enum: Role })] },
      });
    `;

    const result = extractDocsConfig(source, { project, absolutePath: docsPath });
    expect(result!.methods.findAll).toEqual([
      { name: 'ApiQuery', args: [{ name: 'role', enum: ['member', 'admin'] }] },
    ]);
  });

  it('falls back to Unresolved for the same import without a project context (the pre-fix behavior)', () => {
    const source = `
      import { docs } from 'nestjs-docfy';
      import { ApiQuery } from '@nestjs/swagger';
      import { UsersController } from './users.controller';
      import { Role } from './role.enum';

      docs(UsersController, {
        classDecorators: [],
        methods: { findAll: [ApiQuery({ name: 'role', enum: Role })] },
      });
    `;

    const result = extractDocsConfig(source);
    const enumArg = (result!.methods.findAll[0].args[0] as { enum: unknown }).enum;
    expect(enumArg).toEqual({ __unresolved: true, text: 'Role' });
  });
});
