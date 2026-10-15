import { routes } from './app.routes';
import { AUTH_ROUTES } from '@/app/features/auth/auth.routes';
import { ADMIN_ROUTES } from '@/app/features/admin/admin.routes';
import { DASHBOARD_ROUTES } from '@/app/features/dashboard/dashboard.routes';
import { UnauthorizedComponent } from '@/app/features/errors/unauthorized.component';
import { authGuard } from '@/app/core/guards';
import { loadChildRoutes, loadRouteComponent } from '@/testing';

describe('app routes', () => {
  it('redirects root path to dashboard', () => {
    const root = routes.find((r) => r.path === '' && r.pathMatch === 'full');
    expect(root).toBeDefined();
    expect(root?.redirectTo).toBe('dashboard');
  });

  it('lazy-loads auth feature routes at root path', () => {
    const auth = routes.find((r) => r.path === '' && r.pathMatch !== 'full');
    expect(auth).toBeDefined();
    expect(auth?.loadChildren).toBeDefined();
  });

  it('lazy-loads dashboard feature with authGuard', () => {
    const dashboard = routes.find((r) => r.path === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard?.loadChildren).toBeDefined();
    expect(dashboard?.canActivate?.length).toBeGreaterThan(0);
  });

  it('lazy-loads admin feature with authGuard and roleGuard', () => {
    const admin = routes.find((r) => r.path === 'admin');
    expect(admin).toBeDefined();
    expect(admin?.loadChildren).toBeDefined();
    expect(admin?.canActivate?.length).toBe(2);
  });

  it('lazy-loads unauthorized page', () => {
    const unauth = routes.find((r) => r.path === 'unauthorized');
    expect(unauth).toBeDefined();
    expect(unauth?.loadComponent).toBeDefined();
  });

  it('has a wildcard catch-all redirecting to dashboard', () => {
    const wildcard = routes.find((r) => r.path === '**');
    expect(wildcard).toBeDefined();
    expect(wildcard?.redirectTo).toBe('dashboard');
  });

  describe('lazy loaders actually resolve', () => {
    it('auth loadChildren resolves to AUTH_ROUTES', async () => {
      const auth = routes.find((r) => r.path === '' && r.pathMatch !== 'full');
      await expectAsync(loadChildRoutes(auth)).toBeResolvedTo(AUTH_ROUTES);
    });

    it('dashboard loadChildren resolves to DASHBOARD_ROUTES', async () => {
      const dashboard = routes.find((r) => r.path === 'dashboard');
      await expectAsync(loadChildRoutes(dashboard)).toBeResolvedTo(DASHBOARD_ROUTES);
    });

    it('admin loadChildren resolves to ADMIN_ROUTES', async () => {
      const admin = routes.find((r) => r.path === 'admin');
      await expectAsync(loadChildRoutes(admin)).toBeResolvedTo(ADMIN_ROUTES);
    });

    it('unauthorized loadComponent resolves to UnauthorizedComponent', async () => {
      const unauth = routes.find((r) => r.path === 'unauthorized');
      await expectAsync(loadRouteComponent(unauth)).toBeResolvedTo(UnauthorizedComponent);
    });
  });
  /**
   * The route table as an access-control decision, read as a whole rather than one route
   * at a time.
   *
   * The assertions above name `dashboard` and `admin` and check each carries its guards,
   * which is the right test for the routes that exist and no test at all for the route
   * added next year. A new feature mounted at the top level with no `canActivate` is
   * invisible: it compiles, it renders, every existing spec here still passes, and the
   * only way to notice is for somebody to read `app.routes.ts` and remember what the
   * guards are for.
   *
   * So the partition is asserted instead of the members. Everything that is not a
   * redirect must carry `authGuard` unless its path is on this list, and the list is
   * short enough to be read in a diff — which turns "I added a public route" from an
   * omission into an edit a reviewer sees.
   *
   * `authGuard` specifically, not "some guard": a route behind `roleGuard` alone would
   * send an anonymous visitor to `/login`, but only after `roleGuard` had read a store
   * that an unauthenticated visitor has no business having populated. The two compose in
   * that order on `admin` for a reason, and `docs/owasp-top-10.md` (A01) says what the
   * guards are and are not: navigation, never authorisation, which belongs to the API.
   */
  describe('as an access-control decision', () => {
    /** The routes a visitor with no session may reach. Everything else needs `authGuard`. */
    const PUBLIC_PATHS = ['', 'unauthorized'];

    it('requires a session for every route that is not explicitly public', () => {
      const reachableWithoutASession = routes
        .filter((route) => route.redirectTo === undefined)
        .filter((route) => !(route.canActivate ?? []).includes(authGuard))
        .map((route) => route.path ?? '');

      expect(reachableWithoutASession.sort()).toEqual([...PUBLIC_PATHS].sort());
    });

    /**
     * The other half: a public path has to stay a path, not a prefix. `path: ''` with
     * `loadChildren` is how the auth feature mounts `/login` and `/register` at the root,
     * and it is the one entry on the list that could grow a child nobody meant to publish.
     */
    it('publishes only the auth feature at the public root', async () => {
      const publicRoot = routes.find((route) => route.path === '' && route.pathMatch !== 'full');
      const children = await loadChildRoutes(publicRoot);

      expect(children.map((child) => child.path).sort()).toEqual(['login', 'register']);
    });
  });
});
