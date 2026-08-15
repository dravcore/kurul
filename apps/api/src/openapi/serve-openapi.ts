import { Logger, type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { envBool, isProductionEnv } from '../common/env';
import { buildOpenApiDocument } from './openapi.document';

/** Where the interactive console lives. */
export const OPENAPI_UI_PATH = 'docs';

/** Where the machine-readable document lives. The same bytes as the committed snapshot. */
export const OPENAPI_JSON_PATH = 'openapi.json';

/**
 * Whether this instance publishes `/docs` and `/openapi.json`.
 *
 * **Off under `NODE_ENV=production` unless `API_DOCS_ENABLED=true`; on everywhere else.**
 * The default is the decision, so it is worth writing down what it costs and what it buys.
 *
 * This API is self-hosted by people who did not choose it — an operator running
 * `docker compose up` gets whatever the image decided. Three things are true of a console
 * served by default there, and only the first is about information:
 *
 * 1. **The spec itself leaks almost nothing.** Kurultay is AGPL and the routes are in the
 *    repository; a scanner learns nothing from `/openapi.json` it could not read on GitHub.
 *    This is the weakest of the three reasons and is not, on its own, why the default is off.
 * 2. **It is an unauthenticated HTML surface on an API that has none.** The whole service is
 *    `default-src 'none'` (`configure-app.ts`) precisely because it renders no documents. Swagger
 *    UI is a document, with scripts, and serving it means carving a per-path exception into that
 *    policy — see `docsContentSecurityPolicy` below. One path is a small hole; a hole that
 *    appeared because nobody chose it is a different thing.
 * 3. **It is a request console pointed at the reader's own session.** "Try it out" issues real
 *    requests from the browser, same-origin, with the operator's cookie attached. A signed-in
 *    admin who wanders onto a page they did not know existed is two clicks from
 *    `DELETE /workspaces/{id}`. That is a footgun to hand somebody on purpose, not by default.
 *
 * What the default costs is discoverability, and it is paid for elsewhere: the identical
 * document is committed at `apps/api/openapi.json` and CI fails when it drifts, so the contract
 * is readable without a running server and without this switch. Development gets the console
 * for free because there is no operator to surprise.
 */
export function openApiDocsEnabled(): boolean {
  return envBool('API_DOCS_ENABLED', !isProductionEnv());
}

/**
 * The one Content-Security-Policy exception in this API, scoped to the docs paths.
 *
 * `configure-app.ts` sets `default-src 'none'` for the whole service, which blocks Swagger UI
 * outright — measured, not assumed: with the global policy in force the page renders a blank
 * frame and the console reports every bundle refused. The relaxation is written as a full
 * policy rather than a merge so that reading this line tells you exactly what is allowed:
 *
 * - `'self'` for scripts, styles and images, because `SwaggerModule` serves its own bundles
 *   from this origin and nothing else.
 * - `'unsafe-inline'` for both scripts and styles, because the page Swagger UI generates
 *   carries an inline `<style>` block and an inline bootstrap `<script>`. Neither is
 *   avoidable without forking the template.
 * - `data:` for images and fonts, which is what the bundled icons use.
 * - `connect-src 'self'`, so "Try it out" can reach this API and nothing off-origin.
 * - `default-src 'none'` still, so anything not named above is still refused.
 *
 * Note what is *not* relaxed: `frame-ancestors 'none'` stays, so the console cannot be framed
 * by another page, and `form-action 'none'` stays with it.
 */
function docsContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Mounts `/docs` and `/openapi.json`, or does nothing at all.
 *
 * Called from `main.ts` rather than from `configureApp`, and that is deliberate: `configureApp`
 * is shared with the e2e harness, so building the document there would pay for a full Swagger
 * scan in every integration test — and would publish a console on every test app.
 */
export function serveOpenApi(app: INestApplication): void {
  const logger = new Logger('OpenAPI');

  if (!openApiDocsEnabled()) {
    logger.log(
      `API documentation is disabled. Set API_DOCS_ENABLED=true to publish /${OPENAPI_UI_PATH}.`,
    );
    return;
  }

  // Registered before `SwaggerModule.setup` so the header is replaced on the way in, while
  // helmet's value is still the one on the response. Overwriting rather than appending: two
  // `Content-Security-Policy` headers are intersected by the browser, and an intersection with
  // `default-src 'none'` allows nothing.
  app.use(`/${OPENAPI_UI_PATH}`, (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', docsContentSecurityPolicy());
    next();
  });

  SwaggerModule.setup(OPENAPI_UI_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    swaggerOptions: {
      // The operation list is long enough that an expanded default buries the tags.
      docExpansion: 'none',
      persistAuthorization: false,
      tagsSorter: 'alpha',
    },
  });

  logger.log(`API documentation at /${OPENAPI_UI_PATH}, document at /${OPENAPI_JSON_PATH}`);
}
