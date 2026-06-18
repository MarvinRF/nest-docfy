<p align="center">
  <a href="http://nestjs.com"><img alt="Nest Logo" src="https://nestjs.com/img/logo-small.svg" width="120"></a>
</p>

<h1 align="center">
  nestjs-docfy
</h1>

[![NPM version](https://img.shields.io/npm/v/nestjs-docfy.svg)](https://www.npmjs.com/package/nestjs-docfy)
[![NPM downloads](https://img.shields.io/npm/dw/nestjs-docfy.svg)](https://www.npmjs.com/package/nestjs-docfy)
[![GitHub last commit](https://img.shields.io/github/last-commit/MarvinRF/nest-docfy)](https://github.com/MarvinRF/nest-docfy/commits/main)
[![GitHub issues](https://img.shields.io/github/issues/MarvinRF/nest-docfy.svg)](https://github.com/MarvinRF/nest-docfy/issues)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/MarvinRF/nest-docfy/blob/main/LICENSE)

Keep your NestJS controllers clean. Swagger documentation lives in a dedicated companion file — by naming convention, zero boilerplate.

## Table of contents

- [Motivation](#motivation)
- [Installation](#installation)
- [Quick start](#quick-start)
  - [1. Import DocfyModule](#1-import-docfymodule)
  - [2. Mark your controllers](#2-mark-your-controllers)
  - [3. Generate companion docs files](#3-generate-companion-docs-files)
  - [4. Fill in the docs file](#4-fill-in-the-docs-file)
- [CLI — generate](#cli--generate)
  - [Options](#options)
  - [Project types](#project-types)
  - [Idempotency and --force](#idempotency-and---force)
- [CLI — check](#cli--check)
- [CLI — coverage](#cli--coverage)
- [CLI — lint](#cli--lint)
- [CLI — patch-spec](#cli--patch-spec)
- [API reference](#api-reference)
  - [DocfyModule.forRoot()](#docfymoduleforrootoptions)
  - [@WithDocs()](#withdocs)
  - [docs()](#docscontrollerclass-config)
  - [attachTagGroups()](#attachtaggroupsdocument)
  - [DocfyUiModule.setup()](#docfyuimodulesetupmountpath-app-options)
- [Interface-typed DTOs](#interface-typed-dtos)
- [class-validator inference](#class-validator-inference)
- [@HttpCode() support](#httpcode-support)
- [Tag groups (x-tagGroups)](#tag-groups-x-taggroups)
- [File naming convention](#file-naming-convention)
- [Testing](#testing)
- [How it works](#how-it-works)
- [License](#license)

## Motivation

Swagger decorators are documentation. They have nothing to do with routing logic, validation, or business rules — yet they end up mixed into the same file, doubling its length and burying the code that actually matters.

**Before** — Swagger decorators scattered across your controller:

```ts
// users.controller.ts
@ApiTags("users")
@Controller("users")
export class UsersController {
  @Get()
  @ApiOperation({ summary: "List all users" })
  @ApiResponse({ status: 200, description: "OK", type: [UserEntity] })
  findAll(): Promise<UserEntity[]> {
    return this.usersService.findAll();
  }

  @Post()
  @ApiOperation({ summary: "Create a user" })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: "Created", type: UserEntity })
  @ApiResponse({ status: 400, description: "Bad Request" })
  create(@Body() dto: CreateUserDto): Promise<UserEntity> {
    return this.usersService.create(dto);
  }
}
```

**After** — controller expresses only behavior:

```ts
// users.controller.ts
@WithDocs()
@Controller("users")
export class UsersController {
  findAll(): Promise<UserEntity[]> {
    return this.usersService.findAll();
  }

  create(@Body() dto: CreateUserDto): Promise<UserEntity> {
    return this.usersService.create(dto);
  }
}
```

```ts
// users.controller.docs.ts — all documentation in one place
docs(UsersController, {
  classDecorators: [ApiTags("users")],
  methods: {
    findAll: [
      ApiOperation({ summary: "List all users" }),
      ApiResponse({ status: 200, description: "OK", type: [UserEntity] }),
    ],
    create: [
      ApiOperation({ summary: "Create a user" }),
      ApiBody({ type: CreateUserDto }),
      ApiResponse({ status: 201, description: "Created", type: UserEntity }),
      ApiResponse({ status: 400, description: "Bad Request" }),
    ],
  },
});
```

`nestjs-docfy` enforces a clean boundary: controllers express behavior, docs files express documentation. The convention (`*.controller.docs.ts`) mirrors how NestJS already organizes specs (`*.controller.spec.ts`), so it feels natural from day one.

## Installation

```bash
npm install nestjs-docfy
```

**Peer dependencies** (already present in any NestJS project):

```bash
npm install @nestjs/common @nestjs/swagger reflect-metadata
```

## Quick start

### 1. Import DocfyModule

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { DocfyModule } from "nestjs-docfy";

@Module({
  imports: [DocfyModule.forRoot()],
})
export class AppModule {}
```

Pass `{ strict: true }` to fail fast at startup when a controller has `@WithDocs()` but no companion file is found — recommended for CI:

```ts
DocfyModule.forRoot({ strict: true });
```

### 2. Mark your controllers

```ts
// users.controller.ts
import { Controller, Get, Post, Body } from "@nestjs/common";
import { WithDocs } from "nestjs-docfy";

@WithDocs()
@Controller("users")
export class UsersController {
  // route handlers only — no Swagger decorators here
}
```

### 3. Generate companion docs files

Run the CLI to scan your project and generate a pre-filled `*.controller.docs.ts` for every controller:

```bash
npx nestjs-docfy generate
```

The CLI uses **static analysis only** (no code execution) and auto-detects your project layout — monorepos, Nx workspaces, and Nest CLI monorepos are all supported.

To preview what would be written without touching the filesystem:

```bash
npx nestjs-docfy generate --dry-run
```

### 4. Fill in the docs file

The generated file comes pre-populated with inferred summaries, response types, and common error responses:

```ts
// Generated by nestjs-docfy — edit freely, use --force to merge new methods
import { docs } from "nestjs-docfy";
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";
import { UsersController } from "./users.controller";
import { CreateUserDto } from "./dto/create-user.dto";
import { UserEntity } from "./entities/user.entity";

docs(UsersController, {
  classDecorators: [ApiTags("users")],
  methods: {
    // GET / → async findAll(): Promise<UserEntity[]>
    findAll: [
      ApiOperation({ summary: "Find all" }),
      ApiResponse({ status: 200, description: "OK", type: [UserEntity] }),
    ],

    // POST / → async create(dto: CreateUserDto): Promise<UserEntity>
    create: [
      ApiOperation({ summary: "Create" }),
      ApiBody({ type: CreateUserDto }),
      ApiResponse({ status: 201, description: "Created", type: UserEntity }),
      ApiResponse({ status: 400, description: "Bad Request" }),
    ],
  },
});
```

Edit the file freely — your changes are safe. Running `generate` again will skip existing files. Use `--force` to merge only **new** methods without touching existing ones.

No changes to `main.ts` are needed. `DocfyModule` applies all metadata before `SwaggerModule.createDocument()` is called.

## CLI — generate

```bash
npx nestjs-docfy generate [options]
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

### Project types

The CLI auto-detects your project layout — no configuration needed:

| Layout            | Detected when                                        |
| ----------------- | ---------------------------------------------------- |
| Simple project    | `tsconfig.json` at root, no monorepo markers         |
| Nx monorepo       | `nx.json` present                                    |
| Nest CLI monorepo | `nest-cli.json` with `"monorepo": true`              |
| Generic monorepo  | `packages/` or `apps/` with sub-`package.json` files |

### Idempotency and --force

| Scenario                                   | Behavior                                           |
| ------------------------------------------ | -------------------------------------------------- |
| Run `generate` on a clean project          | Creates all docs files                             |
| Run `generate` again (no changes)          | Skips all existing files — safe to run repeatedly  |
| Add a new endpoint, run `generate --force` | Merges new method block, preserves existing arrays |
| Edit a method's decorators, run `--force`  | Your edits are preserved                           |

Add to your `package.json` for convenience:

```json
{
  "scripts": {
    "docs:generate": "nestjs-docfy generate",
    "docs:preview": "nestjs-docfy generate --dry-run"
  }
}
```

## CLI — check

Verify that every controller is fully documented before merging. Exits with code `1` if any drift is detected — designed for CI pipelines.

```bash
npx nestjs-docfy check [options]
```

| Option              | Default                   | Description                                 |
| ------------------- | ------------------------- | ------------------------------------------- |
| `--root <path>`     | `.`                       | Project root directory                      |
| `--tsconfig <path>` | auto-detected             | Path to `tsconfig.json`                     |
| `--pattern <glob>`  | `**/*.controller.ts`      | Glob pattern to find controllers            |
| `--format <format>` | `ts`                      | Docs file format to look for: `ts` or `js`  |
| `--quiet`           | `false`                   | Suppress all output except errors           |

**What it checks:**

- Controllers with HTTP methods but no companion docs file
- Controllers that have methods added since the last `generate` run

**Example output:**

```text
✖ UsersController — undocumented methods: updateProfile, deleteAccount
  → run nestjs-docfy generate --force to merge new methods

✖ 2 controller(s) out of sync.
```

**CI integration:**

```yaml
# GitHub Actions example
- name: Check docs are up to date
  run: npx nestjs-docfy check
```

Or as an npm script:

```json
{
  "scripts": {
    "docs:check": "nestjs-docfy check"
  }
}
```

## CLI — coverage

Measure what percentage of your endpoints are documented. Useful as an objective quality metric and as a CI gate.

```bash
npx nestjs-docfy coverage [options]
```

| Option              | Default              | Description                                            |
| ------------------- | -------------------- | ------------------------------------------------------ |
| `--root <path>`     | `.`                  | Project root directory                                 |
| `--tsconfig <path>` | auto-detected        | Path to `tsconfig.json`                                |
| `--pattern <glob>`  | `**/*.controller.ts` | Glob pattern to find controllers                       |
| `--format <format>` | `ts`                 | Docs file format to look for: `ts` or `js`             |
| `--min <percent>`   | none                 | Minimum coverage required (0-100) — exits `1` if below |
| `--quiet`           | `false`              | Suppress all output except errors                      |

**Example output:**

```text
Controllers: 42
Endpoints: 187

Documented: 174
Missing docs: 13

Coverage: 93.0%
```

**Enforcing a minimum in CI:**

```bash
npx nestjs-docfy coverage --min 95
```

When coverage falls below `--min`, the command exits with code `1`, failing the build.

```yaml
# GitHub Actions example
- name: Enforce documentation coverage
  run: npx nestjs-docfy coverage --min 95
```

Or as an npm script:

```json
{
  "scripts": {
    "docs:coverage": "nestjs-docfy coverage --min 95"
  }
}
```

## CLI — lint

Checks documentation **quality**, not just presence — catches incomplete `ApiOperation`, `ApiResponse`, and `ApiBody` decorators that `check` and `coverage` wouldn't flag (the method is documented, just incompletely).

```bash
npx nestjs-docfy lint [options]
```

| Option              | Default              | Description                                |
| ------------------- | -------------------- | ------------------------------------------ |
| `--root <path>`     | `.`                  | Project root directory                     |
| `--tsconfig <path>` | auto-detected        | Path to `tsconfig.json`                    |
| `--pattern <glob>`  | `**/*.controller.ts` | Glob pattern to find controllers           |
| `--format <format>` | `ts`                 | Docs file format to look for: `ts` or `js` |
| `--quiet`           | `false`              | Suppress all output except errors          |

**What it checks**, for every method already present in a docs file:

- `ApiOperation` missing a `summary`
- Endpoints with a `@Body()` parameter missing a `400` `ApiResponse`
- Endpoints with a `@Body()` parameter missing an `ApiBody` `description`

Controllers without a companion docs file, or methods not yet documented at all, are left to `check` — `lint` only judges the quality of what's already there.

**Example output:**

```text
✖ POST /users
  Missing 400 response

✖ GET /users
  Missing operation summary

✖ PATCH /users/:id
  Missing request body description

✖ 3 issue(s) found.
```

Exits with code `1` if any issue is found — designed for CI pipelines, same as `check`.

```yaml
# GitHub Actions example
- name: Lint documentation quality
  run: npx nestjs-docfy lint
```

Or as an npm script:

```json
{
  "scripts": {
    "docs:lint": "nestjs-docfy lint"
  }
}
```

## CLI — patch-spec

Patches an **already-built** OpenAPI document with every controller's companion docs file, entirely via static analysis (`ts-morph`) — no `require()` of any docs file, no decorators applied to any class, no dependency on a live class reference matching the one the running app actually uses.

This is the workaround for the one thing `DocfyModule`'s runtime pipeline structurally cannot do: work under NestJS CLI's `webpack: true` build mode (see "Not supported" under [File naming convention](#file-naming-convention) for why). `patch-spec` sidesteps that entirely by matching on **path + HTTP method**, computed the same way `check`/`coverage`/`lint` already do, instead of needing the live controller class.

```bash
npx nestjs-docfy patch-spec --spec <path-or-url> [options]
```

| Option | Default | Description |
| --- | --- | --- |
| `--spec <path\|url>` | *(required)* | A local `openapi.json`, or a URL (e.g. a running app's `/api-json`) |
| `--out <path>` | stdout | Where to write the patched document |
| `--root <path>` | `.` | Project root directory |
| `--tsconfig <path>` | auto-detected | Path to `tsconfig.json` |
| `--pattern <glob>` | `**/*.controller.ts` | Glob pattern to find controllers |
| `--format <format>` | `ts` | Docs file format to look for: `ts` or `js` |
| `--quiet` | `false` | Suppress all output except errors |

```bash
# Patch a running app's served document
npx nestjs-docfy patch-spec --spec http://localhost:3000/api-json --out openapi.json

# Patch a file already written to disk
npx nestjs-docfy patch-spec --spec dist/openapi.json --out dist/openapi.json
```

**What gets merged**, matched by `path` + HTTP method against the base document:

- `ApiTags` → unioned into `tags` (never drops tags the base document already had)
- `ApiOperation({ summary, description, deprecated })` → overwrites those fields
- `ApiResponse({ status, description, schema })` → merged per status code (other status codes untouched); when no `schema`/`type` is given, falls back to the method's own resolved return type — same DTO/class-validator/interface inference `generate` already does
- `ApiBody({ schema })` → sets `requestBody`, with the same return-type-style fallback to the `@Body()` parameter's resolved type
- `ApiBearerAuth()` → appended to `security`
- `ApiParam` / `ApiQuery` / `ApiHeader` → appended to `parameters`, deduplicated by name + location

**What this does *not* do** (yet — this command is intentionally scoped, not a full reimplementation of `@nestjs/swagger`'s decorator semantics): enums, `oneOf`/`anyOf`, examples, links, callbacks, and any decorator argument that isn't a literal (a variable, a function call, a spread) are left alone rather than guessed at — better to leave a field as the base document already had it than patch in something wrong. Routes a docs file documents that don't exist in `--spec` are reported as warnings, not silently dropped or errored on.

## API reference

### `DocfyModule.forRoot(options?)`

Registers the module and loads all companion docs files for controllers marked with `@WithDocs()`.

| Option   | Type      | Default | Description                                                                                    |
| -------- | --------- | ------- | ---------------------------------------------------------------------------------------------- |
| `strict` | `boolean` | `false` | Throw at startup if a `@WithDocs()` controller has no companion docs file. Recommended for CI. |

### `@WithDocs()`

Class decorator that marks a controller for companion file discovery. Pair with `@Controller()`.

```ts
@WithDocs()
@Controller('products')
export class ProductsController { ... }
```

Also sets `DOCFY_MARKER` metadata on the class, available for external introspection:

```ts
import { DOCFY_MARKER } from "nestjs-docfy";

Reflect.getMetadata(DOCFY_MARKER, ProductsController); // true
```

### `docs(controllerClass, config)`

Applies Swagger decorators to a controller class from outside its file. Call at the top level of a `*.controller.docs.ts` file — runs as a side effect on import.

Fully type-safe: `config.methods` only accepts keys that exist on the controller class. Typos are caught at compile time.

```ts
docs(UsersController, {
  classDecorators: [ApiTags('users')],
  methods: {
    findAll: [...],    // ✔ exists on UsersController
    typoMethod: [...], // ✖ TypeScript error
  },
});
```

**`config.classDecorators`** — `ClassDecorator[]` — applied to the class constructor (e.g. `ApiTags`, `ApiBearerAuth`).

**`config.methods`** — `Partial<Record<keyof T, MethodDecorator[]>>` — decorator arrays per method name, applied in order.

**`config.group`** — `string` — logical group name for ReDoc's `x-tagGroups` extension. See [Tag groups](#tag-groups-x-taggroups).

**`config.tags`** — `string[]` — tag names associated with `group`. Should match what you pass to `ApiTags()`.

If a method key does not exist on the controller at runtime, a warning is logged and that entry is skipped — the rest of the docs file still applies.

### `attachTagGroups(document)`

Adds the `x-tagGroups` extension to a Swagger document, built from groups registered via `docs({ group, tags })`. Call after `SwaggerModule.createDocument()` and before `SwaggerModule.setup()`. Returns the document unchanged if no groups were registered. See [Tag groups](#tag-groups-x-taggroups) for a full example.

### `DocfyUiModule.setup(mountPath, app, options?)`

Serves [`docfy-ui`](https://www.npmjs.com/package/docfy-ui) — the AI-first documentation UI companion to this package — at `mountPath`, the same role `SwaggerModule.setup()` + `swagger-ui-express` play for raw Swagger UI. Built on Express's static-file middleware directly, so it expects an Express-based Nest app (the default `@nestjs/platform-express` adapter) — Fastify isn't supported yet.

```ts
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { DocfyUiModule } from 'nestjs-docfy';

const app = await NestFactory.create(AppModule);

DocfyUiModule.setup('/docs', app); // before SwaggerModule.setup — see staticSpecPath below

const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
SwaggerModule.setup('api', app, document); // exposes /api-json, which docfy-ui fetches by default

await app.listen(3000);
```

Visit `/docs` — no further configuration needed, since `docfy-ui` fetches `/api-json` same-origin by default.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `staticSpecPath` | `string` | — | Path to a pre-built OpenAPI JSON file, served at `/api-json` *instead of* the app's live one. |

**`staticSpecPath` — required if your app builds with `"webpack": true`.** `DocfyModule`'s runtime metadata pipeline cannot apply docs files there (see [Not supported: webpack: true](#not-supported-nestjs-clis-webpack-true-build-mode)), so the live `/api-json` will be missing everything docs files would otherwise add. Generate a patched document ahead of time —

```bash
npx nestjs-docfy patch-spec --spec http://localhost:3000/api-json --out openapi.patched.json
```

— and serve that instead:

```ts
DocfyUiModule.setup('/docs', app, { staticSpecPath: './openapi.patched.json' });
```

Call this **before** `SwaggerModule.setup()`: Express resolves routes in registration order, so the static, patched document takes precedence over the live one for any request to `/api-json`.

> **Caveat**: `docfy-ui` renders with React Router's `BrowserRouter` and no configurable `basename` yet, so deep client-side routes (e.g. reloading an endpoint's detail page directly) only resolve correctly when `mountPath` is `/` — the application's root. Mounting elsewhere (e.g. `/docs`) still serves the UI and its initial load works fine; in-app navigation to a specific endpoint and then reloading that URL does not yet work at a non-root mount path.

## Interface-typed DTOs

When a response or body type is a TypeScript `interface` (not a class), Swagger cannot use it as a `type:` value because interfaces are erased at runtime. `nestjs-docfy` detects this automatically and generates an inline `schema:` object instead — **no changes to your code required**.

```ts
// Your existing interface — no need to convert to a class
export interface RegisterResponseDto {
  success: boolean;
  message: string | null;
}
```

Generated output:

```ts
ApiResponse({
  status: 201,
  description: 'Created',
  schema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string', nullable: true },
    },
    required: ['success'],
  },
}),
```

Supports: primitives, nullable unions (`T | null`), arrays, nested interfaces, and optional properties (excluded from `required`).

## class-validator inference

When a DTO class uses `class-validator` decorators and does **not** already have `@ApiProperty` on its properties, `nestjs-docfy` infers a full JSON Schema from the validator decorators — no manual annotation required.

```ts
// create-user.dto.ts
import { IsString, IsEmail, MinLength, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
```

Generated output:

```ts
ApiBody({
  schema: {
    type: 'object',
    properties: {
      name:  { type: 'string', minLength: 2 },
      email: { type: 'string', format: 'email' },
      bio:   { type: 'string' },
    },
    required: ['name', 'email'],
  },
}),
```

Supported decorators: `@IsString`, `@IsEmail`, `@IsUrl`, `@IsUUID`, `@IsDateString`, `@IsNumber`, `@IsInt`, `@IsBoolean`, `@IsArray`, `@Min`, `@Max`, `@MinLength`, `@MaxLength`, `@IsOptional`.

> If any property in the class already has `@ApiProperty`, inference is skipped and `type: ClassName` is used instead — your existing Swagger annotations are never overwritten.

## @HttpCode() support

NestJS's `@HttpCode()` decorator overrides the default HTTP status code for a route handler. `nestjs-docfy` reads it automatically and uses the correct code in the generated `ApiResponse`.

```ts
// users.controller.ts
@Post('logout')
@HttpCode(204)
logout(): void { ... }
```

Generated output:

```ts
logout: [
  ApiOperation({ summary: 'Logout' }),
  ApiResponse({ status: 204, description: 'No Content' }),
],
```

Without `@HttpCode()`, the default codes apply: `201` for `@Post`, `200` for all other HTTP verbs.

## Tag groups (x-tagGroups)

Pass `group` and `tags` to `docs()` to organize controllers under logical sections in tools that support the `x-tagGroups` OpenAPI extension — most notably [ReDoc](https://github.com/Redocly/redoc).

```ts
// users.controller.docs.ts
docs(UsersController, {
  classDecorators: [ApiTags('users')],
  group: 'Administration',
  tags: ['users'],
});

// roles.controller.docs.ts
docs(RolesController, {
  classDecorators: [ApiTags('roles')],
  group: 'Administration',
  tags: ['roles'],
});
```

`tags` should match what you already pass to `ApiTags()` — `nestjs-docfy` does not call `ApiTags` for you, it only builds the `x-tagGroups` mapping from what you declare.

To actually attach the groups to the generated document, call `attachTagGroups()` after `SwaggerModule.createDocument()`:

```ts
// main.ts
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { attachTagGroups } from 'nestjs-docfy';

const config = new DocumentBuilder().setTitle('My API').build();
const document = SwaggerModule.createDocument(app, config);

SwaggerModule.setup('api', app, attachTagGroups(document));
```

Generated extension:

```yaml
x-tagGroups:
  - name: Administration
    tags:
      - users
      - roles
```

Multiple `docs()` calls can contribute to the same group — tags are merged and deduplicated. `attachTagGroups()` is a no-op (returns the document unchanged) when no controller declares a `group`.

## File naming convention

Discovery is automatic. `DocfyModule` locates each controller's source file via Node's module cache and resolves the companion path — this works identically in `ts-node` (development) and compiled `dist/` (production).

| Controller file       | Companion docs file        |
| --------------------- | -------------------------- |
| `users.controller.ts` | `users.controller.docs.ts` |
| `users.controller.js` | `users.controller.docs.js` |

> **Barrel re-exports**: if your controller is also exported from an `index.ts` barrel, make sure the class is exported directly from its own module file. `nestjs-docfy` prefers `.controller.ts` over barrel files.

### Not supported: NestJS CLI's `webpack: true` build mode

If your `nest-cli.json` has `"webpack": true` under `compilerOptions` — the documented default for monorepos with multiple apps — `nestjs-docfy` **will not work**, and there is no configuration that makes it work. This is architectural, not a bug to be patched around:

- Webpack inlines every module into one bundle file and never populates Node's `require.cache` with an entry per original source file, which is what the discovery mechanism above depends on. You'll see `Could not locate source file for X` for every `@WithDocs()` controller.
- Even if that lookup is worked around (e.g. by recovering the original path from the bundle's source map, sidestepping `require.cache` entirely), there's a second, unavoidable wall: a docs file required from outside the bundle creates a structurally different class object than the one the running app actually uses internally. Decorating that fresh copy has no effect on the document `SwaggerModule.createDocument()` actually serves — silently, with no error. This path-recovery layer was built and tested before discovering this; it isn't shipped, because "looks like it loaded, does nothing" is worse than the current loud, accurate warning.
- The only way around this would be for the controller's own file to import its `.docs.ts` companion (forcing webpack to bundle them together) — which defeats the entire point of the convention: zero coupling between a controller and its documentation.

**If you need `nestjs-docfy`, disable webpack bundling**: remove `"webpack": true` (or set it to `false`) in `nest-cli.json`. Under `nest build`'s default `tsc`-based compilation, every source file — including each `*.controller.docs.ts` — gets compiled to its own `.js` file in `dist/`, so `require.cache` naturally has one entry per file and discovery works exactly as documented above, no special configuration needed.

## Testing

Reset the controller registry between test suites to avoid cross-contamination:

```ts
import { resetDocfyRegistry } from "nestjs-docfy/testing";

beforeEach(() => resetDocfyRegistry());
```

## How it works

`DocfyModule.forRoot()` runs synchronously during the `NestFactory.create()` phase — before `SwaggerModule.createDocument()` is called. It uses `require()` to load each companion docs file, which executes `docs()` and writes `Reflect` metadata directly onto the controller methods, exactly as TypeScript decorator syntax would at class-definition time.

By the time `SwaggerModule.createDocument()` scans for metadata, all of it is already in place. No monkey-patching, no runtime proxies.

The `generate` CLI uses `ts-morph` for static analysis — it reads the TypeScript AST without executing any project code. All user-supplied paths and glob patterns are validated and sanitised before use.

## License

[MIT](https://github.com/MarvinRF/nest-docfy/blob/main/LICENSE) © Marvin Rocha
