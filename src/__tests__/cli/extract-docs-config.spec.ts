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
