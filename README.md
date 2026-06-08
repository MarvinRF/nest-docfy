# nestjs-docfy

Keep your NestJS controllers clean. Swagger documentation lives in a dedicated companion file — by naming convention, zero boilerplate.

## Before / After

**Before** — Swagger decorators buried in your controller:

```ts
// users.controller.ts
@ApiTags('users')
@Controller('users')
export class UsersController {
  @Get()
  @ApiOperation({ summary: 'List all users' })
  @ApiResponse({ status: 200, type: [UserEntity] })
  findAll(): Promise<UserEntity[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, type: UserEntity })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id') id: string): Promise<UserEntity> {
    return this.usersService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a user' })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, type: UserEntity })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  create(@Body() dto: CreateUserDto): Promise<UserEntity> {
    return this.usersService.create(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'User not found' })
  remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }
}
```

**After** — controller expresses only behavior:

```ts
// users.controller.ts
@WithDocs()
@Controller('users')
export class UsersController {
  findAll(): Promise<UserEntity[]> {
    return this.usersService.findAll();
  }

  findOne(@Param('id') id: string): Promise<UserEntity> {
    return this.usersService.findOne(id);
  }

  create(@Body() dto: CreateUserDto): Promise<UserEntity> {
    return this.usersService.create(dto);
  }

  remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }
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

### 3. Generate the companion docs files

Run the CLI to scan your project and generate a pre-filled `*.controller.docs.ts` for every controller:

```bash
npx nestjs-docfy generate
```

This produces files like:

```ts
// users.controller.docs.ts (generated — fill in the arrays)
import { docs } from 'nestjs-docfy';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UsersController } from './users.controller';

docs(UsersController, {
  classDecorators: [
    // ApiTags('users'),
  ],
  methods: {
    // GET /users → async findAll(): Promise<UserEntity[]>
    findAll: [
      // ApiOperation({ summary: '' }),
      // ApiResponse({ status: 200, type: [UserEntity] }),
    ],

    // GET /:id → async findOne(id: string): Promise<UserEntity>
    findOne: [
      // ApiOperation({ summary: '' }),
      // ApiResponse({ status: 200, type: UserEntity }),
      // ApiResponse({ status: 404 }),
    ],
  },
});
```

Or create the file manually following the same convention:

```text
src/users/users.controller.ts       ← your controller
src/users/users.controller.docs.ts  ← documentation goes here
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

## CLI — `nestjs-docfy generate`

Scans your project for NestJS controllers using **static analysis only** (no code execution) and generates companion `*.controller.docs.ts` files with every method pre-filled and ready to annotate.

### Basic usage

```bash
# Auto-detect project type and generate all docs files
npx nestjs-docfy generate

# Preview what would be generated without writing anything
npx nestjs-docfy generate --dry-run

# Add new methods to existing docs files without touching decorated ones
npx nestjs-docfy generate --force
```

### Options

| Option              | Default                   | Description                                                       |
| ------------------- | ------------------------- | ----------------------------------------------------------------- |
| `--root <path>`     | `.`                       | Project root directory                                            |
| `--tsconfig <path>` | auto-detected             | Path to `tsconfig.json`                                           |
| `--pattern <glob>`  | `**/*.controller.ts`      | Glob pattern to find controllers                                  |
| `--out <path>`      | alongside each controller | Output directory for generated files                              |
| `--force`           | `false`                   | Merge new methods into existing docs files (preserves user edits) |
| `--dry-run`         | `false`                   | Print what would be generated without writing files               |
| `--quiet`           | `false`                   | Suppress all output except errors (CI-friendly)                   |
| `--format`          | `ts`                      | Output format: `ts` or `js`                                       |

### Project types supported

The CLI auto-detects your project layout — no configuration needed:

| Layout            | Detected when                                          |
| ----------------- | ------------------------------------------------------ |
| Simple project    | `tsconfig.json` at root, no monorepo markers           |
| NX Monorepo       | `nx.json` present                                      |
| Nest CLI Monorepo | `nest-cli.json` with `"monorepo": true`                |
| Generic Monorepo  | `packages/` or `apps/` with sub-`package.json` files   |

### Recommended script

Add to your `package.json`:

```json
"scripts": {
  "docs:generate": "nestjs-docfy generate"
}
```

Then run:

```bash
npm run docs:generate
```

### Idempotency and `--force`

Without `--force`: running `generate` twice is safe — existing docs files are skipped entirely.

With `--force`: the CLI merges only **new** methods (methods added to the controller since the docs file was last generated). User-edited decorator arrays are preserved. This makes `--force` safe to run after adding endpoints.

## API reference

### `DocfyModule.forRoot(options?)`

Registers the module and loads all companion docs files for controllers marked with `@WithDocs()`.

| Option   | Type      | Default | Description                                                                                                 |
| -------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------- |
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

The function is fully type-safe: `config.methods` only accepts keys that exist on the controller class. Typos are caught at compile time.

```ts
docs(UsersController, {
  classDecorators: [ApiTags('users')],
  methods: {
    findAll: [...],   // ✔ exists on UsersController
    typoMethod: [...] // ✖ TypeScript error
  },
});
```

**`config.classDecorators`** — `ClassDecorator[]` — decorators applied to the class constructor (e.g. `ApiTags`).

**`config.methods`** — `Partial<Record<keyof T, MethodDecorator[]>>` — decorators per method name. Each decorator is called exactly as TypeScript would call it if it were written inline.

If a method name in `config.methods` does not exist on the controller at runtime, a warning is logged and that entry is skipped — the rest of the docs file still applies.

## File naming convention

| Controller file                   | Companion docs file          |
| --------------------------------- | ---------------------------- |
| `users.controller.ts`             | `users.controller.docs.ts`   |
| `users.controller.js` (compiled)  | `users.controller.docs.js`   |

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

The `generate` CLI uses **static analysis only** (`ts-morph`) — it reads TypeScript AST without executing any project code. All user-supplied paths and values are validated and sanitised before use.

## License

MIT
