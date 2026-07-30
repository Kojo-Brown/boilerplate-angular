import { AUTH_ROUTES } from './auth.routes';
import { LoginComponent } from './login.component';
import { RegisterComponent } from './register.component';
import { loadRouteComponent } from '@/testing';

describe('AUTH_ROUTES', () => {
  it('exposes exactly the login and register paths', () => {
    expect(AUTH_ROUTES.map((r) => r.path)).toEqual(['login', 'register']);
  });

  it('titles each page', () => {
    expect(AUTH_ROUTES.find((r) => r.path === 'login')?.title).toBe('Login');
    expect(AUTH_ROUTES.find((r) => r.path === 'register')?.title).toBe('Register');
  });

  it('leaves both pages unguarded so signed-out users can reach them', () => {
    for (const route of AUTH_ROUTES) {
      expect(route.canActivate).toBeUndefined();
    }
  });

  it('login loadComponent resolves to LoginComponent', async () => {
    const login = AUTH_ROUTES.find((r) => r.path === 'login');
    await expectAsync(loadRouteComponent(login)).toBeResolvedTo(LoginComponent);
  });

  it('register loadComponent resolves to RegisterComponent', async () => {
    const register = AUTH_ROUTES.find((r) => r.path === 'register');
    await expectAsync(loadRouteComponent(register)).toBeResolvedTo(RegisterComponent);
  });
});
