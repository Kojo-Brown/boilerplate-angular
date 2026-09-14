import { RenderMode } from '@angular/ssr';
import type { ServerRoute } from '@angular/ssr';

/**
 * How each route is produced on the server.
 *
 * One line per route, and the line is a decision about *where the data for that page
 * lives* rather than a performance dial. The split here follows one rule: a page the
 * server can render correctly for an anonymous request is prerendered; a page whose
 * content depends on who is asking is left to the client.
 *
 * ## Why every authenticated route is `Client`
 *
 * The session is two tokens in `localStorage` (see `AUTH_TOKEN_STORAGE`). The server
 * cannot read it — there is one Node process serving every visitor and no cookie
 * carrying the session to it — so on the server `AuthStore` is always signed out.
 *
 * Server-rendering `/dashboard` under that would mean one of two wrong answers. Either
 * `authGuard` runs and every request gets a 302 to `/login`, signed-in users included,
 * because the server has no way to tell them apart. Or the guard is bypassed on the
 * server, and an anonymous request is served the dashboard frame, which the client then
 * takes back the moment it hydrates and re-runs the guard — a flash of a page the viewer
 * was never entitled to, and a render whose entire output is discarded.
 *
 * `RenderMode.Client` says that plainly: these routes ship the application shell and the
 * browser decides. Phase 10's token-storage item — an in-memory access token plus an
 * httpOnly refresh cookie — is what would change the answer, because a cookie *does*
 * reach the server. `docs/ssr.md` covers the trade.
 *
 * ## Prerender, not Server, for the public routes
 *
 * `/login`, `/register` and `/unauthorized` render the same bytes for everyone, so there
 * is nothing for a per-request render to compute. Prerendering makes them static files a
 * CDN can hold, and it moves the render cost to build time where a failure is a red
 * build rather than a 500.
 *
 * ## The catch-all
 *
 * `**` is `Client` rather than `Server` because everything it can match is either an
 * authenticated route or the router's redirect to one. Making it `Prerender` would ask
 * the builder to enumerate routes it cannot know, and making it `Server` would pay for a
 * render whose output is the shell.
 */
export const serverRoutes: ServerRoute[] = [
  { path: 'login', renderMode: RenderMode.Prerender },
  { path: 'register', renderMode: RenderMode.Prerender },
  { path: 'unauthorized', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
