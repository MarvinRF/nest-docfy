import { Project } from 'ts-morph';
import { extractMethods } from '../../cli/extract-methods';

const DECORATOR_STUBS = `
function Controller(path?: string) { return (target: any) => {}; }
function Get(path?: string) { return (target: any, key?: any, desc?: any) => {}; }
function Post(path?: string) { return (target: any, key?: any, desc?: any) => {}; }
function Body() { return (target: any, key?: any, idx?: any) => {}; }
`;

function extractFromSource(source: string, className: string) {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sf = project.createSourceFile('controller.ts', `${DECORATOR_STUBS}\n${source}`);
  const cls = sf.getClassOrThrow(className);
  return extractMethods(cls, false);
}

describe('extractMethods() — union return types and @Body() payloads', () => {
  it('resolves a union return type of two interfaces into unionMembers', () => {
    const methods = extractFromSource(
      `
      export interface UserDto { id: string; }
      export interface AdminDto { id: string; role: string; }

      @Controller('users')
      export class UsersController {
        @Get(':id')
        findOne(): Promise<UserDto | AdminDto> {
          return null as any;
        }
      }
      `,
      'UsersController',
    );

    const responseType = methods[0].responseType;
    expect(responseType).not.toBeNull();
    expect(responseType!.name).toBe('UserDto | AdminDto');
    expect(responseType!.isArray).toBe(false);
    expect(responseType!.unionMembers).toHaveLength(2);
    expect(responseType!.unionMembers).toEqual([
      expect.objectContaining({ name: 'UserDto', isInterface: true }),
      expect.objectContaining({ name: 'AdminDto', isInterface: true }),
    ]);
  });

  it('wraps unionMembers in isArray when the return type is an array of the union', () => {
    const methods = extractFromSource(
      `
      export interface UserDto { id: string; }
      export interface AdminDto { id: string; role: string; }

      @Controller('users')
      export class UsersController {
        @Get()
        findAll(): Promise<(UserDto | AdminDto)[]> {
          return null as any;
        }
      }
      `,
      'UsersController',
    );

    const responseType = methods[0].responseType;
    expect(responseType!.isArray).toBe(true);
    expect(responseType!.unionMembers).toHaveLength(2);
  });

  it('resolves a union @Body() payload into bodyType.unionMembers', () => {
    const methods = extractFromSource(
      `
      export interface UserDto { id: string; }
      export interface AdminDto { id: string; role: string; }

      @Controller('users')
      export class UsersController {
        @Post()
        create(@Body() body: UserDto | AdminDto): void {}
      }
      `,
      'UsersController',
    );

    const bodyType = methods[0].params[0].bodyType;
    expect(bodyType).not.toBeNull();
    expect(bodyType!.unionMembers).toHaveLength(2);
  });

  it('bails to null when one union branch is not a nameable type (no partial oneOf)', () => {
    const methods = extractFromSource(
      `
      export interface UserDto { id: string; }

      @Controller('users')
      export class UsersController {
        @Get(':id')
        findOne(): Promise<UserDto | string> {
          return null as any;
        }
      }
      `,
      'UsersController',
    );

    expect(methods[0].responseType).toBeNull();
  });

  it('resolves a nullable single-type union to a plain (non-union) ResponseTypeInfo', () => {
    const methods = extractFromSource(
      `
      export interface UserDto { id: string; }

      @Controller('users')
      export class UsersController {
        @Get(':id')
        findOne(): Promise<UserDto | null> {
          return null as any;
        }
      }
      `,
      'UsersController',
    );

    const responseType = methods[0].responseType;
    expect(responseType).not.toBeNull();
    expect(responseType!.name).toBe('UserDto');
    expect(responseType!.unionMembers).toBeUndefined();
  });
});

describe('extractMethods() — literal union properties on interface DTOs', () => {
  it('collapses a string-literal union property to a string enum', () => {
    const methods = extractFromSource(
      `
      export interface StatusHolder { status: 'active' | 'inactive' | 'banned'; }

      @Controller('users')
      export class UsersController {
        @Get()
        findAll(): Promise<StatusHolder> { return null as any; }
      }
      `,
      'UsersController',
    );

    const schema = methods[0].responseType!.inlineSchema!;
    expect(schema.properties.status).toEqual({ type: 'string', enum: ['active', 'inactive', 'banned'] });
  });

  it('collapses a numeric-literal union property to an integer enum', () => {
    const methods = extractFromSource(
      `
      export interface PriorityHolder { priority: 1 | 2 | 3; }

      @Controller('users')
      export class UsersController {
        @Get()
        findAll(): Promise<PriorityHolder> { return null as any; }
      }
      `,
      'UsersController',
    );

    const schema = methods[0].responseType!.inlineSchema!;
    expect(schema.properties.priority).toEqual({ type: 'integer', enum: [1, 2, 3] });
  });

  it('represents a heterogeneous primitive union property as oneOf', () => {
    const methods = extractFromSource(
      `
      export interface WeirdHolder { weird: string | number; }

      @Controller('users')
      export class UsersController {
        @Get()
        findAll(): Promise<WeirdHolder> { return null as any; }
      }
      `,
      'UsersController',
    );

    const schema = methods[0].responseType!.inlineSchema!;
    expect(schema.properties.weird).toEqual({ oneOf: [{ type: 'string' }, { type: 'number' }] });
  });
});
