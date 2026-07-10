import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { authGuard } from './auth.guard';
import { AuthStore } from '@/app/store/auth/auth.store';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

function runGuard(
  isAuthenticated: boolean,
  url = '/dashboard'
): ReturnType<typeof authGuard> {
  TestBed.overrideProvider(AuthStore, {
    useValue: { isAuthenticated: () => isAuthenticated },
  });

  return TestBed.runInInjectionContext(() => {
    const route = {} as ActivatedRouteSnapshot;
    const state = { url } as RouterStateSnapshot;
    return authGuard(route, state);
  });
}

describe('authGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
    });
  });

  it('allows navigation when authenticated', () => {
    const result = runGuard(true);
    expect(result).toBeTrue();
  });

  it('redirects to /login when not authenticated', () => {
    const result = runGuard(false, '/dashboard');
    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    const tree = result as UrlTree;
    expect(router.serializeUrl(tree)).toBe('/login?returnUrl=%2Fdashboard');
  });

  it('preserves the returnUrl query param', () => {
    const result = runGuard(false, '/admin/users');
    const router = TestBed.inject(Router);
    const tree = result as UrlTree;
    expect(tree.queryParams['returnUrl']).toBe('/admin/users');
  });
});
