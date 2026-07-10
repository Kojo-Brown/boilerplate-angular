import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { roleGuard } from './role.guard';
import { AuthStore } from '@/app/store/auth/auth.store';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

function runGuard(
  opts: { isAuthenticated: boolean; userRole: string | null },
  allowedRoles: 'user' | 'admin' | ('user' | 'admin')[]
): ReturnType<ReturnType<typeof roleGuard>> {
  TestBed.overrideProvider(AuthStore, {
    useValue: {
      isAuthenticated: () => opts.isAuthenticated,
      userRole: () => opts.userRole,
    },
  });

  return TestBed.runInInjectionContext(() => {
    const route = {} as ActivatedRouteSnapshot;
    const state = {} as RouterStateSnapshot;
    return roleGuard(allowedRoles)(route, state);
  });
}

describe('roleGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
    });
  });

  it('allows admin when admin role is required', () => {
    const result = runGuard({ isAuthenticated: true, userRole: 'admin' }, 'admin');
    expect(result).toBeTrue();
  });

  it('allows user when user role is required', () => {
    const result = runGuard({ isAuthenticated: true, userRole: 'user' }, 'user');
    expect(result).toBeTrue();
  });

  it('allows when role matches one of multiple allowed roles', () => {
    const result = runGuard({ isAuthenticated: true, userRole: 'user' }, ['admin', 'user']);
    expect(result).toBeTrue();
  });

  it('redirects to /unauthorized when role does not match', () => {
    const result = runGuard({ isAuthenticated: true, userRole: 'user' }, 'admin');
    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as UrlTree)).toBe('/unauthorized');
  });

  it('redirects to /login when not authenticated', () => {
    const result = runGuard({ isAuthenticated: false, userRole: null }, 'admin');
    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('redirects to /unauthorized when userRole is null but authenticated', () => {
    const result = runGuard({ isAuthenticated: true, userRole: null }, 'user');
    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as UrlTree)).toBe('/unauthorized');
  });
});
