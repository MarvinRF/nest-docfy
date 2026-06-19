import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';

/**
 * Minimal structural shape of what `DocfyUiModule.setup()` needs from a
 * NestJS application instance — just enough to register Express-style
 * middleware. Deliberately not typed as `INestApplication` so this file
 * doesn't pull `@nestjs/common`'s full surface into a narrow concern, and
 * not typed as `express.Application` so consumers don't need `@types/express`
 * just to call this function.
 */
export interface DocfyUiSetupTarget {
  use(...args: unknown[]): unknown;
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
   * `SwaggerModule.setup()` in your bootstrap — Express resolves routes
   * in registration order, so the static, patched document takes
   * precedence over the live (and, under webpack, incomplete) one for
   * any request to `/api-json`.
   */
  staticSpecPath?: string;
}

/**
 * Serves the published `docfy-ui` package's static build at `mountPath`,
 * giving a `nestjs-docfy`-equipped app a documentation UI by default —
 * the same role `SwaggerModule.setup()` + `swagger-ui-express` play for
 * raw Swagger UI, but for `docfy-ui`.
 *
 * Deep client-side routes (e.g. reloading `/docs/users/findAllUsers`
 * directly) resolve correctly at any `mountPath`: this injects a `<base>`
 * tag matching `mountPath` (so the build's relative asset URLs resolve
 * against it instead of the current, possibly-deep, pathname) and a
 * `window.__DOCFY_BASE_PATH__` global that `docfy-ui` reads to set
 * `BrowserRouter`'s `basename`.
 */
export class DocfyUiModule {
  static setup(
    mountPath: string,
    app: DocfyUiSetupTarget,
    options: DocfyUiSetupOptions = {},
  ): void {
    if (options.staticSpecPath) {
      const specJson = fs.readFileSync(options.staticSpecPath, 'utf8');
      app.use('/api-json', (_req: express.Request, res: express.Response) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(specJson);
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

    // `index: false` so directory requests (e.g. `GET /docs/`) fall through
    // to the catch-all below instead of express.static serving the
    // un-patched index.html straight off disk.
    app.use(mountPath, express.static(uiDir, { index: false }));
    app.use(mountPath, (_req: express.Request, res: express.Response) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(indexHtml);
    });
  }
}
