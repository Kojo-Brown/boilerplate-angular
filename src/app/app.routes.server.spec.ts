import { RenderMode } from '@angular/ssr';
import type { ServerRoute } from '@angular/ssr';
import type { Routes } from '@angular/router';
import { routes } from '@/app/app.routes';
import { serverRoutes } from '@/app/app.routes.server';
import { loadChildRoutes } from '@/testing';

/**
 * The server route table, checked against the router's.
 *
 * The failure this guards against is a route added to `app.routes.ts` and not mentioned
 * here. Nothing breaks: `**` catches it, so it is served as the client-rendering shell,
 * which is the *safe* default and therefore the silent one — a page meant to be
 * prerendered simply never is, and the only symptom is a slower first paint nobody
 * attributes to a missing line.
 *
 * `assert-ssr.mjs` checks the other half against the build: that the routes declared
 * `Prerender` here are the routes the builder actually prerendered, and that
 * `/dashboard` is served as the shell rather than rendered.
 */
describe('serverRoutes', () => {
  const modeOf = (path: string): RenderMode | undefined =>
    serverRoutes.find((route: ServerRoute) => route.path === path)?.renderMode;

  it('ends with a catch-all, so every route has an answer', () => {
    expect(serverRoutes.at(-1)?.path).toBe('**');
  });

  it('prerenders the routes that render the same bytes for everyone', () => {
    expect(modeOf('login')).toBe(RenderMode.Prerender);
    expect(modeOf('register')).toBe(RenderMode.Prerender);
    expect(modeOf('unauthorized')).toBe(RenderMode.Prerender);
  });

  it('leaves everything else to the client', () => {
    expect(modeOf('**')).toBe(RenderMode.Client);
  });

  /**
   * The one rule worth enforcing rather than reviewing: the server has no session, so a
   * route behind a guard cannot be rendered there. `Prerender` would bake a signed-out
   * page into a static file; `Server` would decide every visitor's session by the
   * absence of one the server cannot read. Both are silent — the page renders, it is
   * just the wrong page — so the invariant is that such a route is never *named* here
   * with either mode, and falls through to the `Client` catch-all instead.
   */
  it('never prerenders or server-renders a guarded route', () => {
    const guarded = routes
      .filter((route) => (route.canActivate?.length ?? 0) > 0)
      .map((route) => route.path)
      .filter((path): path is string => path !== undefined);

    expect(guarded)
      .withContext('the app should still have guarded routes for this to be about')
      .not.toEqual([]);

    for (const path of guarded) {
      const declared = serverRoutes.filter(
        (route) => route.path === path || route.path.startsWith(`${path}/`)
      );
      for (const route of declared) {
        expect([RenderMode.Prerender, RenderMode.Server])
          .withContext(
            `"${route.path}" sits under the guarded route "${path}", so the server cannot ` +
              `render it correctly for an anonymous request. Leave it to the "**" entry, ` +
              `or declare it RenderMode.Client explicitly.`
          )
          .not.toContain(route.renderMode);
      }
    }
  });

  /** A path named here that the router does not serve prerenders a 404 into a static file. */
  it('names only paths the router actually serves', async () => {
    const lazyChildren: Routes = await loadChildRoutes(
      routes.find((route) => typeof route.loadChildren === 'function')
    );
    const known = new Set(
      [...routes, ...lazyChildren]
        .map((route) => route.path)
        .filter((path): path is string => path !== undefined && path !== '')
    );

    for (const route of serverRoutes) {
      if (route.path === '**') continue;
      expect(known.has(route.path))
        .withContext(
          `serverRoutes declares "${route.path}", which no route config serves. ` +
            `Known paths: ${[...known].join(', ')}.`
        )
        .toBeTrue();
    }
  });
});
