import { ADMIN_ROUTES } from './admin.routes';
import { AdminComponent } from './admin.component';
import { loadRouteComponent } from '@/testing';

describe('ADMIN_ROUTES', () => {
  it('exposes a single route at the empty path', () => {
    expect(ADMIN_ROUTES.map((r) => r.path)).toEqual(['']);
    expect(ADMIN_ROUTES[0].title).toBe('Admin');
  });

  it('relies on the parent route for guarding rather than re-declaring guards', () => {
    // `/admin` carries `authGuard` + `roleGuard('admin')` in app.routes.ts; duplicating
    // them here would run each guard twice per navigation.
    expect(ADMIN_ROUTES[0].canActivate).toBeUndefined();
  });

  it('loadComponent resolves to AdminComponent', async () => {
    await expectAsync(loadRouteComponent(ADMIN_ROUTES[0])).toBeResolvedTo(AdminComponent);
  });
});
