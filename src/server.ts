import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

/**
 * The Node process that serves the application.
 *
 * Three responsibilities, in this order, and the order is the whole file: hand back a
 * build artifact if the path names one, otherwise ask Angular to render, otherwise 404.
 *
 * This is also the only source file in the repository that runs on Node rather than in a
 * browser. Nothing under `src/app/` may import from it, and it may not import anything
 * with a DOM dependency of its own — `main.server.ts` is the boundary, and it is reached
 * through the manifest the builder writes rather than by an import from here.
 */

/**
 * The browser build, which the builder emits as a sibling of the server bundle.
 *
 * `import.meta.dirname` rather than `process.cwd()`: the server is started from wherever
 * the deployment happens to put it — a container's WORKDIR, a PM2 cwd, a serverless
 * bundle root — and a path relative to the process's working directory silently resolves
 * to nothing, which presents as every asset 404ing while the HTML renders fine.
 */
const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Build artifacts, straight from disk.
 *
 * `index: false` so a request for `/` is not answered by `index.html` before the router
 * has seen it — that would bypass the redirect to `/dashboard` and serve the un-routed
 * shell. `redirect: false` so a request for a directory is not answered with a 301 to
 * the same path with a trailing slash, which for `/login` would fight the prerendered
 * route below for the same URL.
 *
 * `maxAge: '1y'` is safe only because every emitted file name carries a content hash
 * (`outputHashing: "all"`). The two files that are *not* hashed — `index.html` and the
 * prerendered pages — are never served from here: they go through `angularApp.handle`,
 * which sets its own cache headers.
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  })
);

/**
 * Everything else is the Angular application: a prerendered page from the build, a
 * server render, or the client-side-rendering shell, decided by `app.routes.server.ts`.
 *
 * `next()` on a null response rather than a 404 written here, so a route this engine
 * does not claim falls through to Express' own final handler — and so that an API route
 * mounted after this one would still be reachable.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Listen only when this module is the process entry point.
 *
 * The same file is imported — not executed — by the Angular CLI's dev server and by the
 * prerenderer, both of which drive `reqHandler` directly. Binding a port unconditionally
 * would make `ng build` fail on a machine where 4000 is already taken.
 */
if (isMainModule(import.meta.url)) {
  // Angular validates the `Host` and `X-Forwarded-Host` of every request against an
  // allow-list, and that list is empty unless something fills it — so an unconfigured
  // server starts happily and then answers *every* request with a 400 whose message is
  // about server-side request forgery. That reads as an attack rather than as a missing
  // environment variable, so the missing variable is made the failure instead, at the
  // one moment where the fix is obvious.
  //
  // It is deliberately not defaulted to `localhost`: a default that works on a laptop
  // and silently rejects production traffic is the failure this check exists to prevent.
  //
  // `console.error` + `process.exit`, not `throw`. Constructing `AngularNodeAppEngine`
  // above installs a process-wide `uncaughtException` handler that logs and returns, so
  // a top-level throw from here is caught by it and the process exits *0* — a startup
  // failure that reports success, which is worse than the thing being guarded against.
  if (!process.env['NG_ALLOWED_HOSTS']) {
    console.error(
      'NG_ALLOWED_HOSTS is not set, so every request would be rejected as a possible ' +
        'host-header attack. Set it to the hostnames this server is reached by, ' +
        'comma-separated — NG_ALLOWED_HOSTS=example.com,www.example.com in production, ' +
        'NG_ALLOWED_HOSTS=localhost to run the build locally. See docs/ssr.md.'
    );
    process.exit(1);
  }

  const port = Number(process.env['PORT'] ?? 4000);
  app.listen(port, (error?: Error) => {
    if (error) {
      console.error(`Failed to listen on port ${port}:`, error);
      process.exit(1);
    }
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/** The handler the Angular CLI (dev server, prerenderer) and serverless adapters call. */
export const reqHandler = createNodeRequestHandler(app);
