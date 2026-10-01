import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import type { Request } from 'express';
import { join } from 'node:path';
import {
  applyCspNonce,
  buildContentSecurityPolicy,
  createCspNonce,
  CSP_HEADER,
} from '@/app/core/security';
import { environment } from '@/environments/environment';

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
 * Whether a request is for a *document* rather than for a subresource.
 *
 * Only documents carry a nonce, so only documents need the conditional-request handling
 * below. `Sec-Fetch-Dest` is the precise answer and every browser this application
 * supports sends it; the `Accept` test is the fallback for the ones that do not and for
 * `curl`, which `assert-csp.mjs` is effectively standing in for. A navigation asks for
 * `text/html`; a fetch for a chunk does not.
 */
function isDocumentRequest(req: Request): boolean {
  if (req.headers['sec-fetch-dest'] === 'document') return true;
  return (req.headers.accept ?? '').includes('text/html');
}

/**
 * The policy for one response, and the nonce it authorises.
 *
 * The three origins come from `environment`, which is a build-time constant — so there is
 * no environment variable that can argue this server into relaxing its own policy, and
 * the development build differs from the production one only in what `apiUrl` resolves
 * to. `csp.ts` has the reasoning and the measurement behind that.
 */
function cspFor(nonce: string): string {
  return buildContentSecurityPolicy({
    nonce,
    apiUrl: environment.apiUrl,
    imageCdnUrl: environment.imageCdnUrl,
    vitalsUrl: environment.vitalsUrl,
  });
}

/**
 * Give one rendered document a nonce, and the header that authorises it.
 *
 * Non-HTML responses are returned untouched: a policy on a JavaScript chunk governs
 * nothing, and `express.static` above has already answered for the hashed assets anyway.
 *
 * ## Why the ETag has to go
 *
 * A prerendered route is a file on disk, and `@angular/ssr` serves it with an `ETag` and
 * answers a conditional request with a 304. That is exactly right for a static page and
 * exactly wrong for one carrying a nonce, because the `ETag` is computed from the *file*
 * and the substitution above happens after it: three consecutive responses measured with
 * the deletions below removed carried one identical `ETag` and three different nonces. A
 * validator that reports "unchanged" about a body that changed is simply incorrect, and
 * what it buys is that any cache holding the page — the browser's, or a shared one in
 * front of it — may answer later requests from the copy it has.
 *
 * The symptom is the reason this is handled rather than noted. Loading `/login` three
 * times in Chromium against that same build produced **one** nonce for all three loads,
 * the page rendering correctly every time, nothing blocked, nothing logged. The policy
 * and the document agree, so there is no violation to report; the nonce has just stopped
 * being per-response, which is the entire property it exists for. A static nonce that
 * cannot be distinguished from a working one is the failure `nonce.ts` is written against,
 * arrived at from the other direction. The same three loads with the deletions in place
 * produce three distinct nonces.
 *
 * So a nonced document drops its validator and says `no-cache`. `no-cache` rather than
 * `no-store` on purpose — `no-store` would also make the page ineligible for the
 * browser's back/forward cache, and there is nothing to gain by it: with no `ETag` and no
 * `Last-Modified` there is no validator for a revalidation to succeed on, so the browser
 * re-fetches and gets a fresh nonce either way. `private` is the half that matters most in
 * a deployment: without it the prerendered HTML carries no `cache-control` at all, which
 * makes it heuristically cacheable, and a CDN in front of this server would hand one
 * visitor's nonce to every visitor.
 *
 * The cost is real and worth naming: prerendering `/login` exists to make it a file a CDN
 * can hold, and a per-response nonce takes that back. `docs/security.md` argues the trade
 * and what the alternative (a build-time hash policy) would cost instead.
 */
async function nonceDocument(response: Response, nonce: string): Promise<Response> {
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) {
    return response;
  }

  const html = applyCspNonce(await response.text(), nonce);
  const headers = new Headers(response.headers);

  headers.set(CSP_HEADER, cspFor(nonce));
  headers.delete('etag');
  headers.delete('last-modified');
  headers.set('cache-control', 'no-cache, private');
  // The substitution changes the body's length, and the prerendered file's own
  // `content-length` came with it. A stale one here truncates the page in the browser.
  headers.set('content-length', String(new TextEncoder().encode(html).byteLength));

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Everything else is the Angular application: a prerendered page from the build, a
 * server render, or the client-side-rendering shell, decided by `app.routes.server.ts`.
 *
 * `next()` on a null response rather than a 404 written here, so a route this engine
 * does not claim falls through to Express' own final handler — and so that an API route
 * mounted after this one would still be reachable.
 *
 * The request's validators are dropped before the engine sees it, for the reason
 * `nonceDocument` gives: a 304 and a fresh nonce cannot both be right, and the engine
 * decides the 304 before this code gets a response to fix up. Stripping them here means
 * the answer does not depend on what any intermediary happened to have cached — including
 * a copy of this page served before the policy existed, which is the one case that
 * `cache-control` on the way out cannot reach.
 */
app.use((req, res, next) => {
  if (isDocumentRequest(req)) {
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
  }

  const nonce = createCspNonce();

  angularApp
    .handle(req)
    .then(async (response) =>
      response ? writeResponseToNodeResponse(await nonceDocument(response, nonce), res) : next()
    )
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
