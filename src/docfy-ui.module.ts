import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';
import { buildLlmsFullTxt, buildLlmsTxt, normalizeDocument } from 'docfy-core';
import { buildAllowedOrigins, handleProxyRequest, ProxyResponderLike, readJsonBody } from './proxy-handler';

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
}

interface FastifyScopedInstance {
  register(plugin: unknown, opts?: Record<string, unknown>): unknown;
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
 * `window.__DOCFY_BASE_PATH__` global that `docfy-ui` reads to set
 * `BrowserRouter`'s `basename`.
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

    let proxyPath: string | undefined;
    if (options.openApiDocument || options.additionalProxyOrigins) {
      const allowedOrigins = buildAllowedOrigins(options.openApiDocument?.servers, options.additionalProxyOrigins);
      if (allowedOrigins.size === 0) {
        console.warn(
          'DocfyUiModule.setup(): "Try it out" proxy enabled but no absolute server URLs were found — ' +
            'every request will be rejected. Declare an absolute URL in your OpenAPI "servers" array ' +
            '(or pass `additionalProxyOrigins`) to allow it.',
        );
      }
      proxyPath = `${basePath}__docfy_proxy`.replace(/\/+/g, '/');
      httpAdapter.post(proxyPath, (req: any, res: any) => {
        readJsonBody(req)
          .then((body) => handleProxyRequest(body, allowedOrigins, res as ProxyResponderLike))
          .catch((err) => {
            console.error('DocfyUiModule: "Try it out" proxy handler failed unexpectedly:', err);
          });
      });
    }

    const indexHtmlPath = require.resolve('docfy-ui/dist/index.html');
    const uiDir = path.dirname(indexHtmlPath);
    const specsScript = options.specs
      ? `\n    <script>window.__DOCFY_SPECS__ = ${JSON.stringify(options.specs)};</script>`
      : '';
    const proxyScript = proxyPath
      ? `\n    <script>window.__DOCFY_PROXY_PATH__ = ${JSON.stringify(proxyPath)};</script>`
      : '';
    const indexHtml = fs
      .readFileSync(indexHtmlPath, 'utf8')
      .replace(
        '<head>',
        `<head>\n    <base href="${basePath}" />\n    <script>window.__DOCFY_BASE_PATH__ = ${JSON.stringify(basePath)};</script>${specsScript}${proxyScript}`,
      );

    if (isFastify) {
      const fastifyStatic = loadFastifyStatic();
      const instance = httpAdapter.getInstance() as FastifyRootInstance;
      instance.register(
        (scoped, _opts, done) => {
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
    app.use(mountPath, express.static(uiDir, { index: false }));
    app.use(mountPath, (_req: express.Request, res: express.Response) => {
      res.type('text/html');
      res.send(indexHtml);
    });
  }
}
