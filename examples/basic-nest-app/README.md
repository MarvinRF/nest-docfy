# basic-nest-app

A small, runnable NestJS app demonstrating `nestjs-docfy` end to end — including the case that trips up every other approach: **`webpack: true` build mode**.

It uses the local `nestjs-docfy` package (`"nestjs-docfy": "file:../.."`), so it always reflects whatever is currently in `src/` one directory up, not the last npm release.

## What's here

- `@WithDocs()` + `DocfyModule.forRoot()` on `UsersController` — the standard runtime mechanism.
- `nest-cli.json` has `"webpack": true` **and** `"plugins": ["nestjs-docfy"]` — this app deliberately builds the hard way, the one `DocfyModule`'s runtime discovery cannot handle on its own.
- `main.ts` calls `applyDocfyMetadata(document)` right after `SwaggerModule.createDocument()` — this is what actually fills in the docs under webpack, using the metadata the CLI plugin computed at build time.
- `users.controller.docs.ts` showcases, in one file:
  - `enum: UserRole` on an `ApiQuery` — a real TS `enum`, imported from a different file (`entities/user.entity.ts`), not an array literal
  - a `oneOf` schema, inferred automatically from `findOne()`'s real return type `Promise<UserEntity | AdminUserEntity>` — no manual `schema:` needed
  - `examples` on an `ApiResponse`
  - class-validator → JSON Schema inference on `create()`'s body (`CreateUserDto` has no `@ApiProperty()` anywhere)

## Run it

From this directory:

```bash
npm install
npm run build   # nest build — goes through webpack, plugin included
npm start        # or: node dist/main.js
```

Then open `http://localhost:3000/docs` (Swagger UI) or fetch `http://localhost:3000/docs-json` directly.

You'll see this warning on startup — it's expected, not an error:

```
[DocfyModule] Could not locate source file for UsersController. ...
```

That's `DocfyModule`'s runtime mechanism correctly recognizing it can't work inside a webpack bundle and backing off loudly instead of silently doing nothing. The docs show up anyway, because `applyDocfyMetadata()` filled them in from the CLI plugin's build-time output (`dist/docfy-metadata.json` — open it, it's a plain, readable JSON patch).

## The three ways to get here

This app is wired for the **first** one, but all three read the exact same `users.controller.docs.ts`:

1. **CLI plugin + `applyDocfyMetadata()`** (what this app does) — automatic, on every build, including `webpack: true`. No separate step to remember.
2. **`patch-spec`** — a manual, CI-friendly alternative. With the app running:
   ```bash
   npx nestjs-docfy patch-spec --spec http://localhost:3000/docs-json --out openapi.patched.json
   ```
   (Redundant against *this* app specifically, since `applyDocfyMetadata()` already patched the live document — this is what you'd run instead of registering the plugin, against the *unpatched* base document, e.g. right after `SwaggerModule.createDocument()` in a build script.)
3. **Disable `webpack: true`** — remove it from `nest-cli.json` entirely and `DocfyModule`'s runtime mechanism handles everything on its own, no plugin or `applyDocfyMetadata()` needed. Try it: flip `webpack` to `false`, rebuild, and the startup warning disappears.
