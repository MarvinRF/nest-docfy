import * as fs from 'fs';
import * as path from 'path';
import type * as express from 'express';
import { requireOptionalPeer } from './optional-peer';
import { buildLlmsFullTxt, buildLlmsTxt, normalizeDocument } from 'docfy-core';
import { buildAllowedOrigins, handleProxyRoute, ProxyResponderLike } from './proxy-handler';
import { buildSecurityHeaders, collectConnectSrc } from './security-headers';

/**
 * Minimal structural shape of what `DocfyUiModule.setup()` needs from a
 * NestJS HTTP adapter (`app.getHttpAdapter()`). Matches `@nestjs/common`'s
 * real `HttpServer` interface, so every real `INestApplication` /
 * `NestFastifyApplication` satisfies this with no extra work.
 */
export interface DocfyUiHttpAdapter {
  getType(): string;
  // Non-generic, like @nestjs/common's own `HttpServer.getInstance(): ServerInstance`
  // (which defaults ServerInstance to `any`) — a per-call `getInstance<T>(): T` breaks
  // structural assignment from any concrete adapter (Express, Fastify, or a test fake),
  // since a fixed-return-type method can't satisfy an arbitrarily-instantiable generic one.
  getInstance(): unknown;
  get(path: string, handler: (req: unknown, res: unknown) => unknown): unknown;
  post(path: string, handler: (req: unknown, res: unknown) => unknown): unknown;
}

/**
 * Minimal structural shape of what `DocfyUiModule.setup()` needs from a
 * NestJS application instance — just enough to register middleware/routes.
 * Deliberately not typed as `INestApplication` so this file doesn't pull
 * `@nestjs/common`'s full surface into a narrow concern, and not typed as
 * `express.Application` so consumers don't need `@types/express` just to
 * call this function.
 */
export interface DocfyUiSetupTarget {
  use(...args: unknown[]): unknown;
  getHttpAdapter(): DocfyUiHttpAdapter;
}

export interface DocfyUiSetupOptions {
  /**
   * Path to a pre-built OpenAPI JSON file to serve at `/api-json` instead
   * of whatever the app's own SwaggerModule produces live.
   *
   * Required when the app is built with NestJS CLI's `webpack: true` —
   * DocfyModule's runtime metadata pipeline cannot apply docs files there
   * (see the README's "Not supported: webpack: true" section for why).
   * Generate this file ahead of time with:
   *
   *   npx nestjs-docfy patch-spec --spec <url-or-path> --out <path>
   *
   * Call `DocfyUiModule.setup()` with this option *before*
   * `SwaggerModule.setup()` in your bootstrap — on Express this ordering
   * guarantees the static, patched document takes precedence for any
   * request to `/api-json`. On Fastify, registering `SwaggerModule.setup()`
   * with its default `/api-json` route alongside this option throws
   * `FST_ERR_DUPLICATED_ROUTE` at startup instead — point
   * `SwaggerModule.setup()` at a different `jsonDocumentUrl` (or pass
   * `{ raw: false }`) when using `staticSpecPath` on a Fastify app.
   */
  staticSpecPath?: string;

  /**
   * List of OpenAPI specs to offer in docfy-ui's spec switcher — useful when
   * one docfy-ui instance should let users browse multiple services without
   * leaving the UI. Each `url` is fetched client-side exactly like the
   * default `/api-json` spec is, so it can point at another same-origin
   * route or a different origin (subject to that origin's CORS policy).
   * When omitted (the default), docfy-ui behaves exactly as before —
   * a single spec, no switcher rendered.
   */
  specs?: { name: string; url: string }[];

  /**
   * Enables the "Try it out" server-side proxy: docfy-ui's browser calls a same-origin
   * route on this app instead of the target API directly, sidestepping CORS entirely.
   * Requires explicit opt-in — pass the same `OpenAPIObject` you already have from
   * `SwaggerModule.createDocument()`. Its `servers[]` becomes the proxy's allowlist;
   * there is deliberately no implicit "same origin as this request" fallback (that would
   * be derived from client-controlled headers, an SSRF risk — see docfy-ui.module.ts).
   * Only absolute server URLs count. Omit entirely to leave the proxy disabled (no new
   * route registered at all).
   */
  openApiDocument?: { servers?: { url: string }[] };

  /** Extra allowed origins for the proxy, beyond what `openApiDocument.servers` declares. */
  additionalProxyOrigins?: string[];

  /**
   * Opt-in: serves `llms.txt` and `llms-full.txt` at the mount path (the https://llmstxt.org
   * convention) — lets an agent discover the API's endpoints with a plain `curl`/`fetch`, no
   * MCP server required. `llms.txt` lists one bullet per endpoint (linking to its `docfy-ui`
   * page); `llms-full.txt` expands each into its full "Copy for AI" text, the same content
   * `docfy-mcp`'s `get_endpoint` tool returns. Never registered unless this option is set —
   * unlike `staticSpecPath`/`openApiDocument`, it changes nothing when omitted.
   *
   * Pass `true` to reuse the already-loaded `staticSpecPath` document (requires that option to
   * also be set). Pass `{ document }` explicitly when instead relying on a live
   * `SwaggerModule`-produced spec — the same raw `OpenAPIObject` you'd pass as
   * `openApiDocument`. `title`/`description` default to the spec's own
   * `info.title`/`info.description`.
   */
  llmsTxt?: true | { document: Record<string, unknown>; title?: string; description?: string };

  /**
   * Narrative markdown pages rendered at `{mountPath}/guides/:slug`, listed in `docfy-ui`'s
   * sidebar above the endpoint tag tree — lets a `docfy-ui` instance mix guides/tutorials with
   * the generated API reference, instead of being pure reference-only. Pass the already-read
   * file contents (`fs.readFileSync(path, 'utf8')`), not a path — this module has no opinion on
   * where guide files live in your project. Omit entirely to leave the sidebar unchanged.
   */
  guides?: { slug: string; title: string; content: string }[];

  /**
   * Decides whether a "Try it out" proxy request may go through; return `false` to reject it with
   * 403. The proxy route sits on the raw HTTP adapter, so **Nest guards never run for it** — this
   * hook is where you check the caller (session, API key, IP...). Errors thrown here reject the
   * request (fail closed). When `NODE_ENV=production`, the proxy is only enabled if this hook (or
   * `allowProxyInProduction`) is set.
   */
  proxyAuthorize?: (req: unknown) => boolean | Promise<boolean>;

  /**
   * Enables the proxy in production without `proxyAuthorize`. Only for when the mount path is
   * already protected by something else (middleware in front of it, a private network). Anyone who
   * can reach the mount path can otherwise relay requests to every allowed server.
   */
  allowProxyInProduction?: boolean;

  /**
   * Security headers on the docs UI responses: a `Content-Security-Policy` that only allows this
   * origin's scripts, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
   * framing limited to the same origin. On by default; `false` turns them all off (e.g. when a
   * reverse proxy or helmet already sets them).
   */
  securityHeaders?: boolean;

  /** Replaces the default `Content-Security-Policy` value entirely. */
  contentSecurityPolicy?: string;

  /**
   * Extra `connect-src` sources for the default CSP. Origins this module already knows (absolute
   * `specs` URLs, `openApiDocument`/static spec `servers`, `additionalProxyOrigins`) are included
   * automatically; list here any other origin the browser must reach, e.g. API servers called
   * directly by "Try it out" when the spec comes from a live `SwaggerModule` document.
   */
  cspConnectSrc?: string[];
}

/**
 * Serializes a value for a `<script>` data block. Any injected string (a spec name or URL
 * from config, guide prose containing a literal `</script>`, a mount path) could otherwise
 * close the block early and inject raw HTML. `<` is inert inside a JS string but can't be
 * parsed as a tag by the HTML parser; U+2028/U+2029 are escaped for pre-ES2019 engines.
 */
function toInlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function readServerUrls(document: unknown): string[] {
  const servers = (document as { servers?: unknown } | undefined)?.servers;
  if (!Array.isArray(servers)) return [];
  return servers.map((s) => (s as { url?: unknown })?.url).filter((u): u is string => typeof u === 'string');
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadFastifyStatic(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@fastify/static');
  } catch {
    throw new Error(
      'DocfyUiModule.setup(): serving docfy-ui on a Fastify-based Nest app requires ' +
        "the optional peer dependency '@fastify/static'. Install it with `npm install @fastify/static`.",
    );
  }
}

interface FastifyReplyLike {
  type(contentType: string): { send(body: string): unknown };
  header(name: string, value: string): unknown;
}

interface FastifyScopedInstance {
  register(plugin: unknown, opts?: Record<string, unknown>): unknown;
  addHook(name: 'onRequest', hook: (req: unknown, reply: FastifyReplyLike, done: () => void) => void): unknown;
  setNotFoundHandler(handler: (req: unknown, reply: FastifyReplyLike) => unknown): unknown;
}

interface FastifyRootInstance {
  register(
    plugin: (instance: FastifyScopedInstance, opts: unknown, done: () => void) => void,
    opts: { prefix: string },
  ): unknown;
}

/**
 * Serves the published `docfy-ui` package's static build at `mountPath`,
 * giving a `nestjs-docfy`-equipped app a documentation UI by default —
 * the same role `SwaggerModule.setup()` + `swagger-ui-express` play for
 * raw Swagger UI, but for `docfy-ui`. Works on both Express and Fastify
 * Nest apps.
 *
 * Deep client-side routes (e.g. reloading `/docs/users/findAllUsers`
 * directly) resolve correctly at any `mountPath`: this injects a `<base>`
 * tag matching `mountPath` (so the build's relative asset URLs resolve
 * against it instead of the current, possibly-deep, pathname) and a
 * `<script type="application/json" id="docfy-config">` data block that
 * `docfy-ui` reads (base path, specs, proxy path, guides, security notices).
 * A data block is never executed, so the page works under the strict CSP
 * this module sends.
 */
export class DocfyUiModule {
  static setup(mountPath: string, app: DocfyUiSetupTarget, options: DocfyUiSetupOptions = {}): void {
    const httpAdapter = app.getHttpAdapter();
    const isFastify = httpAdapter.getType() === 'fastify';

    let staticSpecJson: string | undefined;
    if (options.staticSpecPath) {
      staticSpecJson = fs.readFileSync(options.staticSpecPath, 'utf8');
      httpAdapter.get('/api-json', (_req: unknown, res: any) => {
        res.type('application/json');
        res.send(staticSpecJson);
      });
    }

    const basePath = mountPath === '/' ? '/' : `${mountPath.replace(/\/+$/, '')}/`;

    // Parsed eagerly (not deferred into the route handler) so a malformed static spec fails
    // fast at boot, same as any other startup misconfiguration — not silently on first request.
    const llmsDocumentSource =
      options.llmsTxt && options.llmsTxt !== true
        ? options.llmsTxt.document
        : options.llmsTxt && staticSpecJson
          ? JSON.parse(staticSpecJson)
          : undefined;

    if (options.llmsTxt && !llmsDocumentSource) {
      console.warn(
        'DocfyUiModule.setup(): `llmsTxt: true` requires `staticSpecPath` to also be set (or pass ' +
          '`llmsTxt: { document }` explicitly) — no llms.txt routes were registered.',
      );
    }

    if (llmsDocumentSource) {
      const documentModelPromise = normalizeDocument(llmsDocumentSource);
      const llmsTxtOptions =
        options.llmsTxt && options.llmsTxt !== true
          ? { title: options.llmsTxt.title, description: options.llmsTxt.description }
          : {};
      const docsBaseUrl = basePath;

      // Handlers return their promise chain (harmless — Express/Fastify ignore a handler's
      // return value) so tests can `await` completion instead of racing microtask ordering.
      httpAdapter.get(`${basePath}llms.txt`.replace(/\/+/g, '/'), (_req: unknown, res: any) => {
        return documentModelPromise
          .then((document) => res.type('text/plain').send(buildLlmsTxt(document, { ...llmsTxtOptions, docsBaseUrl })))
          .catch((err: unknown) => {
            console.error('DocfyUiModule: failed to build llms.txt:', err);
            res.status(500).send('Failed to build llms.txt');
          });
      });

      httpAdapter.get(`${basePath}llms-full.txt`.replace(/\/+/g, '/'), (_req: unknown, res: any) => {
        return documentModelPromise
          .then((document) =>
            res.type('text/plain').send(buildLlmsFullTxt(document, { ...llmsTxtOptions, docsBaseUrl })),
          )
          .catch((err: unknown) => {
            console.error('DocfyUiModule: failed to build llms-full.txt:', err);
            res.status(500).send('Failed to build llms-full.txt');
          });
      });
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const securityNotices: string[] = [];
    const proxyRequested = Boolean(options.openApiDocument || options.additionalProxyOrigins);
    const proxyBlockedInProduction =
      proxyRequested && isProduction && !options.proxyAuthorize && !options.allowProxyInProduction;

    if (proxyBlockedInProduction) {
      console.error(
        'DocfyUiModule.setup(): the "Try it out" proxy is DISABLED because NODE_ENV=production and ' +
          'no `proxyAuthorize` hook was given. Its route bypasses Nest guards, so without it anyone ' +
          `who can reach ${mountPath} could relay requests to your servers. Add \`proxyAuthorize\` ` +
          '(or `allowProxyInProduction: true` if the mount path is already protected). ' +
          'See https://github.com/MarvinRF/nest-docfy#security',
      );
    } else if (proxyRequested && !options.proxyAuthorize) {
      securityNotices.push(
        `The "Try it out" proxy has no proxyAuthorize hook: anyone who can reach ${mountPath} can send ` +
          'requests through it. With NODE_ENV=production it is disabled unless you add proxyAuthorize ' +
          '(or allowProxyInProduction).',
      );
    }
    if (options.securityHeaders === false) {
      securityNotices.push(
        'Security headers are disabled (securityHeaders: false), including the Content-Security-Policy.',
      );
    }

    let proxyPath: string | undefined;
    if (proxyRequested && !proxyBlockedInProduction) {
      const allowedOrigins = buildAllowedOrigins(options.openApiDocument?.servers, options.additionalProxyOrigins);
      if (allowedOrigins.size === 0) {
        console.warn(
          'DocfyUiModule.setup(): "Try it out" proxy enabled but no absolute server URLs were found — ' +
            'every request will be rejected. Declare an absolute URL in your OpenAPI "servers" array ' +
            '(or pass `additionalProxyOrigins`) to allow it.',
        );
      }
      proxyPath = `${basePath}__docfy_proxy`.replace(/\/+/g, '/');
      const authorize = options.proxyAuthorize;
      httpAdapter.post(proxyPath, (req: any, res: any) => {
        return handleProxyRoute(req, res as ProxyResponderLike, allowedOrigins, authorize).catch((err) => {
          console.error('DocfyUiModule: "Try it out" proxy handler failed unexpectedly:', err);
        });
      });
    }

    const indexHtmlPath = require.resolve('docfy-ui/dist/index.html');
    const uiDir = path.dirname(indexHtmlPath);
    // Notices are developer-facing: never sent in production, so end users of a deployed docs
    // site don't see the app's configuration details.
    const hostConfig = {
      basePath,
      specs: options.specs,
      proxyPath,
      guides: options.guides,
      securityNotices: !isProduction && securityNotices.length > 0 ? securityNotices : undefined,
    };
    const indexHtml = fs
      .readFileSync(indexHtmlPath, 'utf8')
      .replace(
        '<head>',
        `<head>\n    <base href="${escapeHtmlAttribute(basePath)}" />\n    <script type="application/json" id="docfy-config">${toInlineScriptJson(hostConfig)}</script>`,
      );

    const securityHeaders =
      options.securityHeaders === false
        ? []
        : buildSecurityHeaders({
            contentSecurityPolicy: options.contentSecurityPolicy,
            connectSrc: collectConnectSrc([
              ...(options.specs ?? []).map((s) => s.url),
              ...(options.openApiDocument?.servers ?? []).map((s) => s.url),
              ...readServerUrls(llmsDocumentSource),
              ...(options.additionalProxyOrigins ?? []),
              ...(options.cspConnectSrc ?? []),
            ]),
          });

    if (isFastify) {
      const fastifyStatic = loadFastifyStatic();
      const instance = httpAdapter.getInstance() as FastifyRootInstance;
      instance.register(
        (scoped, _opts, done) => {
          if (securityHeaders.length > 0) {
            scoped.addHook('onRequest', (_req, reply, done) => {
              for (const [name, value] of securityHeaders) reply.header(name, value);
              done();
            });
          }
          scoped.register(fastifyStatic, {
            root: uiDir,
            // `wildcard: false` is required by @fastify/static for a scoped
            // setNotFoundHandler to combine correctly with static serving.
            wildcard: false,
            // `index: false` so directory requests (e.g. `GET /docs/`) fall
            // through to the not-found handler below instead of
            // @fastify/static serving the un-patched index.html straight
            // off disk.
            index: false,
            decorateReply: false,
          });
          scoped.setNotFoundHandler((_req, reply) => {
            reply.type('text/html').send(indexHtml);
          });
          done();
        },
        { prefix: mountPath },
      );
      return;
    }

    // `index: false` so directory requests (e.g. `GET /docs/`) fall through
    // to the catch-all below instead of express.static serving the
    // un-patched index.html straight off disk.
    const expressLib = requireOptionalPeer<typeof import('express')>(
      'express',
      'DocfyUiModule.setup() on an Express app',
      false,
    );
    if (securityHeaders.length > 0) {
      app.use(mountPath, (_req: express.Request, res: express.Response, next: () => void) => {
        for (const [name, value] of securityHeaders) res.setHeader(name, value);
        next();
      });
    }
    app.use(mountPath, expressLib.static(uiDir, { index: false }));
    app.use(mountPath, (_req: express.Request, res: express.Response) => {
      res.type('text/html');
      res.send(indexHtml);
    });
  }
}
