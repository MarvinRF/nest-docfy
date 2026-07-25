import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';

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

    if (options.staticSpecPath) {
      const specJson = fs.readFileSync(options.staticSpecPath, 'utf8');
      httpAdapter.get('/api-json', (_req: unknown, res: any) => {
        res.type('application/json');
        res.send(specJson);
      });
    }

    const indexHtmlPath = require.resolve('docfy-ui/dist/index.html');
    const uiDir = path.dirname(indexHtmlPath);
    const basePath = mountPath === '/' ? '/' : `${mountPath.replace(/\/+$/, '')}/`;
    const indexHtml = fs
      .readFileSync(indexHtmlPath, 'utf8')
      .replace(
        '<head>',
        `<head>\n    <base href="${basePath}" />\n    <script>window.__DOCFY_BASE_PATH__ = ${JSON.stringify(basePath)};</script>`,
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
