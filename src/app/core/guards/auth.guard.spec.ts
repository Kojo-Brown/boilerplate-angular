import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { isObservable } from 'rxjs';
import type { Observable } from 'rxjs';
import { authGuard } from './auth.guard';
import { AuthStore } from '@/app/store/auth/auth.store';
import type { ActivatedRouteSnapshot, GuardResult, RouterStateSnapshot } from '@angular/router';

interface FakeAuthStore {
  isAuthenticated: WritableSignal<boolean>;
  isRestoringSession: WritableSignal<boolean>;
}

function installStore(isAuthenticated: boolean, isRestoringSession = false): FakeAuthStore {
  const fake: FakeAuthStore = {
    isAuthenticated: signal(isAuthenticated),
    isRestoringSession: signal(isRestoringSession),
  };
  TestBed.overrideProvider(AuthStore, { useValue: fake });
  return fake;
}

function runGuard(url = '/dashboard'): ReturnType<typeof authGuard> {
  return TestBed.runInInjectionContext(() => {
    const route = {} as ActivatedRouteSnapshot;
    const state = { url } as RouterStateSnapshot;
    return authGuard(route, state);
  });
}

/** Collects everything the guard's stream emits, plus whether it completed. */
function collect(result: ReturnType<typeof authGuard>): {
  emissions: GuardResult[];
  completed: () => boolean;
} {
  expect(isObservable(result)).withContext('guard should return an Observable').toBeTrue();

  const emissions: GuardResult[] = [];
  let completed = false;
  (result as Observable<GuardResult>).subscribe({
    next: (value) => emissions.push(value),
    complete: () => (completed = true),
  });

  return { emissions, completed: () => completed };
}

describe('authGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
    });
  });

  describe('when the session is already known', () => {
    it('allows navigation when authenticated', () => {
      installStore(true);
      expect(runGuard()).toBeTrue();
    });

    it('redirects to /login when not authenticated', () => {
      installStore(false);

      const result = runGuard('/dashboard');

      expect(result).toBeInstanceOf(UrlTree);
      const router = TestBed.inject(Router);
      expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Fdashboard');
    });

    it('preserves the returnUrl query param', () => {
      installStore(false);

      const result = runGuard('/admin/users');

      expect((result as UrlTree).queryParams['returnUrl']).toBe('/admin/users');
    });
  });

  // A stored token restores synchronously, the profile behind it does not, and
  // `isAuthenticated` needs both. Deciding before the restore settles is what used to
  // bounce a signed-in user to `/login` on every reload of a guarded route.
  describe('while the session is being restored', () => {
    it('does not decide until the restore settles', () => {
      installStore(false, true);

      const { emissions } = collect(runGuard());
      // `toObservable` replays the signal's current value on the first flush; the
      // guard has to swallow that one rather than read it as "restore finished".
      TestBed.tick();
      TestBed.tick();

      expect(emissions).toEqual([]);
    });

    it('allows navigation once the restore produces a user', () => {
      const store = installStore(false, true);
      const { emissions, completed } = collect(runGuard());

      store.isAuthenticated.set(true);
      store.isRestoringSession.set(false);
      TestBed.tick();

      expect(emissions).toEqual([true]);
      expect(completed()).withContext('take(1) should complete the stream').toBeTrue();
    });

    it('redirects once the restore finishes without a user', () => {
      const store = installStore(false, true);
      const { emissions } = collect(runGuard('/dashboard/posts'));

      store.isRestoringSession.set(false);
      TestBed.tick();

      expect(emissions.length).toBe(1);
      expect(emissions[0]).toBeInstanceOf(UrlTree);
      expect((emissions[0] as UrlTree).queryParams['returnUrl']).toBe('/dashboard/posts');
    });

    it('emits only the first settled answer', () => {
      const store = installStore(false, true);
      const { emissions } = collect(runGuard());

      store.isAuthenticated.set(true);
      store.isRestoringSession.set(false);
      TestBed.tick();

      // A later sign-out must not push a second, contradictory answer at the router.
      store.isRestoringSession.set(true);
      store.isAuthenticated.set(false);
      TestBed.tick();
      store.isRestoringSession.set(false);
      TestBed.tick();

      expect(emissions).toEqual([true]);
    });
  });
});
