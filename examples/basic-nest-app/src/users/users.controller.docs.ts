import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { docs } from 'nestjs-docfy';
import { UsersController } from './users.controller';

docs(UsersController, {
  classDecorators: [ApiTags('users')],
  methods: {
    findAll: [
      ApiOperation({ summary: 'List users', description: 'Optionally filter by role.' }),
      // Array literal, not `enum: UserRole` — a TS enum *imported from
      // another file* doesn't resolve today: the static extractor parses
      // each docs file in an isolated in-memory project with no real
      // filesystem/cross-file symbol resolution, so an imported enum
      // reference silently falls back to no `enum` at all. Only an enum
      // declared in the very same docs file would resolve. Tracked as a
      // known limitation — see the README/roadmap notes.
      ApiQuery({ name: 'role', required: false, enum: ['member', 'admin'] }),
      ApiResponse({
        status: 200,
        description: 'OK',
        examples: {
          allUsers: { summary: 'Unfiltered', value: [{ id: '1', name: 'Ada Lovelace', role: 'member' }] },
        },
      }),
    ],

    // No `schema`/`type` given here at all — the 200 response falls back to
    // findOne()'s own resolved return type, Promise<UserEntity |
    // AdminUserEntity>, which patch-spec/the CLI plugin turn into a `oneOf`
    // of the two named schemas automatically.
    findOne: [
      ApiOperation({ summary: 'Find a user by id' }),
      ApiResponse({ status: 200, description: 'A member or admin user' }),
      // An explicit schema here, instead of leaving it to fall back to
      // findOne()'s return type — that fallback applies to *every* response
      // status without an explicit schema/type, which would otherwise put
      // the same "member or admin user" oneOf on a 404 too.
      ApiResponse({
        status: 404,
        description: 'Not found',
        schema: { type: 'object', properties: { message: { type: 'string' }, statusCode: { type: 'number' } } },
      }),
    ],

    create: [
      ApiOperation({ summary: 'Create a user' }),
      // No `schema`/`type` given — falls back to CreateUserDto's own
      // class-validator decorators (@IsString/@IsEmail), inferred into a
      // JSON Schema automatically. See the "class-validator inference"
      // section of the README.
      ApiBody({ description: 'New user payload' }),
      ApiResponse({ status: 201, description: 'Created' }),
    ],
  },
});
