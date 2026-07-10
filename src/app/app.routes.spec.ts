import { routes } from './app.routes';

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
});
