# nestjs-docfy

Keep your NestJS controllers clean. Swagger documentation lives in a dedicated companion file — by naming convention, zero boilerplate.

```ts
// users.controller.ts — no Swagger decorators at all
@WithDocs()
@Controller('users')
export class UsersController {
  @Get()
  findAll(): Promise<UserEntity[]> { ... }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserEntity> { ... }
}
```

```ts
// users.controller.docs.ts — all documentation in one place
docs(UsersController, {
  classDecorators: [ApiTags('users')],
  methods: {
    findAll: [
      ApiOperation({ summary: 'List all users' }),
      ApiResponse({ status: 200, type: [UserEntity] }),
    ],
    create: [
      ApiOperation({ summary: 'Create a user' }),
      ApiBody({ type: CreateUserDto }),
      ApiResponse({ status: 201, type: UserEntity }),
      ApiResponse({ status: 400, description: 'Invalid input' }),
    ],
  },
});
```

## Why

Swagger decorators are documentation. They have nothing to do with routing logic, validation, or business rules — yet they end up mixed into the same file, doubling its length and burying the code that actually matters.

`nestjs-docfy` enforces a clean boundary: controllers express behavior, docs files express documentation. The convention (`*.controller.docs.ts`) mirrors how NestJS already organizes specs (`*.controller.spec.ts`), so it feels natural from day one.

## Installation

```bash
npm install nestjs-docfy
```

**Peer dependencies** (already in your project):

```bash
npm install @nestjs/common @nestjs/swagger reflect-metadata
```

## Setup

### 1. Import `DocfyModule` in your root module

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { DocfyModule } from 'nestjs-docfy';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    DocfyModule.forRoot(),
    UsersModule,
  ],
})
export class AppModule {}
```

### 2. Mark your controllers with `@WithDocs()`

```ts
// users.controller.ts
import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { WithDocs } from 'nestjs-docfy';

@WithDocs()
@Controller('users')
export class UsersController {
  // ... your route handlers, nothing else
}
```

### 3. Create the companion docs file

Name it exactly like the controller, replacing `.controller.ts` with `.controller.docs.ts`:

```
src/users/users.controller.ts       ← your controller
src/users/users.controller.docs.ts  ← documentation goes here
```

```ts
// users.controller.docs.ts
import { HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { UsersController } from './users.controller';
import { UserEntity } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { docs } from 'nestjs-docfy';

docs(UsersController, {
  classDecorators: [ApiTags('users')],
  methods: {
    findAll: [
      ApiOperation({ summary: 'List all users' }),
      ApiResponse({ status: HttpStatus.OK, type: [UserEntity] }),
    ],
    findOne: [
      ApiOperation({ summary: 'Get a user by ID' }),
      ApiParam({ name: 'id', description: 'User UUID' }),
      ApiResponse({ status: HttpStatus.OK, type: UserEntity }),
      ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' }),
    ],
    create: [
      ApiOperation({ summary: 'Create a user' }),
      ApiBody({ type: CreateUserDto }),
      ApiResponse({ status: HttpStatus.CREATED, type: UserEntity }),
      ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' }),
    ],
  },
});
```

### 4. Keep `main.ts` unchanged

`DocfyModule` applies documentation metadata synchronously during module initialization, before `SwaggerModule.createDocument` is called. No changes to your bootstrap function are needed.

```ts
// main.ts — nothing changes here
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = new DocumentBuilder().setTitle('My API').build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  await app.listen(3000);
}
```

## API reference

### `DocfyModule.forRoot(options?)`

Registers the module and loads all companion docs files for controllers marked with `@WithDocs()`.

| Option | Type | Default | Description |
|---|---|---|---|
| `strict` | `boolean` | `false` | Throw at startup if a controller has `@WithDocs()` but no companion docs file is found. Recommended for CI. |

```ts
// Warn on missing docs files (default)
DocfyModule.forRoot()

// Throw on missing docs files — fail fast in CI
DocfyModule.forRoot({ strict: true })
```

---

### `@WithDocs()`

Class decorator that marks a controller for companion file discovery. Pair with `@Controller()`.

```ts
@WithDocs()
@Controller('products')
export class ProductsController { ... }
```

Also sets `DOCFY_MARKER` metadata (`'docfy:with_docs'`) on the class, available for external introspection:

```ts
import { DOCFY_MARKER } from 'nestjs-docfy';

const hasDocs = Reflect.getMetadata(DOCFY_MARKER, ProductsController) === true;
```

---

### `docs(controllerClass, config)`

Applies Swagger decorators to a controller class from outside its file.
Call this at the top level of a `*.controller.docs.ts` file — it runs as a side effect on import.

**`config.classDecorators`** — `ClassDecorator[]` — decorators applied to the class constructor (e.g. `ApiTags`).

**`config.methods`** — `Record<string, MethodDecorator[]>` — decorators per method name. Each decorator is called exactly as TypeScript would call it if it were written inline.

If a method name in `config.methods` does not exist on the controller, a warning is logged and that entry is skipped — the rest of the docs file still applies.

## File naming convention

| Controller file | Companion docs file |
|---|---|
| `users.controller.ts` | `users.controller.docs.ts` |
| `users.controller.js` (compiled) | `users.controller.docs.js` |

Discovery is automatic. `DocfyModule` locates each controller's source file via Node's module cache (`require.cache`) and resolves the companion path. This works identically in both `ts-node` (development) and compiled `dist/` (production).

> **Barrel re-exports**: if your controller is exported from an `index.ts` barrel in addition to its own file, `nestjs-docfy` prefers the `.controller.ts` file over the barrel. Make sure the class is exported directly from its own module file.

## Testing

When testing application modules that import `DocfyModule`, reset the controller registry between test suites to avoid cross-contamination:

```ts
import { resetDocfyRegistry } from 'nestjs-docfy/testing';

beforeEach(() => resetDocfyRegistry());
```

## How it works

NestJS calls `NestFactory.create()` to build the dependency graph and module instances, then calls `app.listen()` — which internally calls `app.init()` — to register routes and fire lifecycle hooks. `SwaggerModule.createDocument()` is called between these two steps, in `main.ts`.

`DocfyModule.forRoot()` runs synchronously during the `NestFactory.create()` phase (as the module graph is evaluated), which is *before* `SwaggerModule.createDocument()`. At that point, it uses `require()` to load each docs file, which calls `docs()` and writes `Reflect` metadata directly onto the controller methods — exactly as TypeScript decorator syntax would at class-definition time.

By the time `SwaggerModule.createDocument()` scans for metadata, all of it is already in place.

## License

MIT
