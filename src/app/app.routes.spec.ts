import { routes } from './app.routes';
import { AUTH_ROUTES } from '@/app/features/auth/auth.routes';
import { ADMIN_ROUTES } from '@/app/features/admin/admin.routes';
import { DASHBOARD_ROUTES } from '@/app/features/dashboard/dashboard.routes';
import { UnauthorizedComponent } from '@/app/features/errors/unauthorized.component';
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
});
