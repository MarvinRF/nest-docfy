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
 * Caveat: `docfy-ui` currently renders with React Router's `BrowserRouter`
 * and no configurable `basename`, so deep client-side routes (e.g.
 * reloading `/users/findAllUsers` directly) only resolve correctly when
 * `mountPath` is `/` — the application's root. Mounting elsewhere (e.g.
 * `/docs`) still serves the UI and its initial load works, but in-app
 * navigation/reload at a non-root path is not yet supported by `docfy-ui`
 * itself.
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

    app.use(mountPath, express.static(uiDir));
    app.use(mountPath, (_req: express.Request, res: express.Response) => {
      res.sendFile(path.join(uiDir, 'index.html'));
    });
  }
}
