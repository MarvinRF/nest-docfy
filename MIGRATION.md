# Migrating to nestjs-docfy 0.19

0.19 is a security release with breaking changes ([GHSA-v7f7-7xm3-5jr9](https://github.com/MarvinRF/nest-docfy/security/advisories/GHSA-v7f7-7xm3-5jr9)).
Full guide with context: https://www.nestdocfy.com/docs/getting-started/security
README section: https://github.com/MarvinRF/nest-docfy#migrating-to-019

> **For coding agents:** each step below starts with a check you can run against the project.
> Apply a step only when its check matches, and never satisfy a step by turning a protection off
> (`allowProxyInProduction`, `securityHeaders: false`, `--allow-writes`, `--no-restrict-to-servers`)
> unless the user explicitly asks for it.

## 1. Node.js 22.12+

- **Check:** `node --version` is below `v22.12.0`, or `engines.node` / `.nvmrc` / CI `node-version` pins an older line.
- **Do:** move to Node.js 22.12 or newer (Node 18 and 20 are end-of-life).

## 2. CLI and compiler plugin dependencies

- **Check:** any of: `package.json` scripts call `nestjs-docfy`; `nest-cli.json` has `"plugins": ["nestjs-docfy"]` (or the object form); CI runs `npx nestjs-docfy`.
- **Do:** `npm install --save-dev ts-morph commander picocolors`. If `nestjs-docfy generate-client` is used anywhere, also `npm install --save-dev openapi-typescript`.
- **Verify:** `npx nestjs-docfy --version` prints the version instead of an install hint.

## 3. "Try it out" proxy in production

- **Check:** a `DocfyUiModule.setup(` call passes `openApiDocument` or `additionalProxyOrigins`, and the app runs with `NODE_ENV=production`.
- **Symptom if skipped:** boot error `the "Try it out" proxy is DISABLED`; "Try it out" falls back to direct browser calls.
- **Do:** add `proxyAuthorize` using the app's existing auth (session, JWT, API key). Nest guards do not run for this route, so this hook is the only check:

  ```ts
  DocfyUiModule.setup('/docs', app, {
    openApiDocument: document,
    proxyAuthorize: async (req) => (await currentUser(req))?.roles.includes('developer') ?? false,
  });
  ```

  Ask the user who should be allowed if that isn't clear from the code. Use `allowProxyInProduction: true` only if the user confirms the mount path is already protected (middleware in front of it, private network).

- **Verify:** `npx nestjs-docfy doctor` prints no `[security]` line about the proxy.

## 4. Custom proxy clients

- **Check:** code other than docfy-ui POSTs to `.../__docfy_proxy`.
- **Do:** send `Content-Type: application/json`. Anything else now gets `415`.

## 5. Content-Security-Policy on the docs UI

- **Check:** "Try it out" calls API origins directly (no proxy) that are not in the spec's `servers[]`, or the docs load assets from other origins; symptom: CSP violation in the browser console on the docs page.
- **Do:** list those origins in `cspConnectSrc: ['https://api.example.com']`, or replace the policy with `contentSecurityPolicy`. If helmet or a reverse proxy already sets these headers, `securityHeaders: false` avoids duplicates.

## 6. Contract tests (`nestjs-docfy test`, docfy-mcp `contract_test`)

- **Check:** CI or scripts run `nestjs-docfy test`, or rely on write endpoints being exercised.
- **Do:** write endpoints are now skipped. Add `--allow-writes` only for a disposable environment. A non-localhost `--base-url` must be one of the spec's `servers`; otherwise add it to the spec or pass `--no-restrict-to-servers` (user decision).

## 7. Reusable PR-check workflow

- **Check:** a workflow uses `MarvinRF/nest-docfy/.github/workflows/docfy-pr-check-reusable.yml`.
- **Do:** pin `uses:` to `@v0.19.0` (or a commit SHA) and pass `docfy-version: 0.19.0` and `docfy-ref: v0.19.0`; both are now required.

## 8. Custom controller globs

- **Check:** `--pattern` or the plugin's `controllerGlob` is set to something other than `**/*.controller.ts`.
- **Do:** the basename is now matched exactly (`.` is literal, anchored). Confirm `npx nestjs-docfy check` still finds the same controllers.

## Final verification

```bash
npx nestjs-docfy doctor   # no [security] lines
npm audit --omit=dev      # build tooling no longer appears in production
```
