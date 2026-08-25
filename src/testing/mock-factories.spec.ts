import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthStore } from '@/app/store/auth/auth.store';
import { createMockAuthStore, createMockUser } from './mock-factories';

describe('createMockAuthStore', () => {
  describe('substitutability', () => {
    /**
     * The check the type system cannot do for us.
     *
     * `ValueProvider.useValue` is `any`, so `{ provide: AuthStore, useValue: double }`
     * compiles whatever the double looks like. Comparing the two surfaces at runtime is
     * what turns a forgotten member into a failing test here, rather than a `TypeError`
     * in the first spec that renders a component reading it.
     */
    it('exposes every member of the real store', () => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      const real = TestBed.inject(AuthStore) as unknown as Record<string, unknown>;
      const double = createMockAuthStore() as unknown as Record<string, unknown>;

      const missing = Object.keys(real).filter((key) => !(key in double));

      expect(missing).toEqual([]);
    });

    it('answers every member with a callable, as the real store does', () => {
      const double = createMockAuthStore() as unknown as Record<string, unknown>;

      const notCallable = Object.keys(double).filter((key) => typeof double[key] !== 'function');

      expect(notCallable).toEqual([]);
    });
  });

  describe('invariants', () => {
    it('is signed out by default', () => {
      const store = createMockAuthStore();

      expect(store.isAuthenticated()).toBeFalse();
      expect(store.currentUser()).toBeNull();
      expect(store.userRole()).toBeNull();
      expect(store.isAdmin()).toBeFalse();
      expect(store.isRestoringSession()).toBeFalse();
    });

    it('is authenticated only with both a token and a user', () => {
      expect(
        createMockAuthStore({ accessToken: 'mock-access-token' }).isAuthenticated()
      ).toBeFalse();
      expect(createMockAuthStore({ user: createMockUser() }).isAuthenticated()).toBeFalse();
      expect(
        createMockAuthStore({
          user: createMockUser(),
          accessToken: 'mock-access-token',
        }).isAuthenticated()
      ).toBeTrue();
    });

    it('derives the role, admin flag and hasRole from the user', () => {
      const store = createMockAuthStore({ user: createMockUser({ role: 'admin' }) });

      expect(store.userRole()).toBe('admin');
      expect(store.isAdmin()).toBeTrue();
      expect(store.hasRole('admin')).toBeTrue();
      expect(store.hasRole('user')).toBeFalse();
    });

    it('reports a plain user as not an admin', () => {
      const store = createMockAuthStore({ user: createMockUser({ role: 'user' }) });

      expect(store.isAdmin()).toBeFalse();
      expect(store.hasRole('user')).toBeTrue();
    });

    it('still lets a spec pin a derived value outright', () => {
      const store = createMockAuthStore({ isAuthenticated: true, isAdmin: true });

      expect(store.isAuthenticated()).toBeTrue();
      expect(store.isAdmin()).toBeTrue();
    });
  });
});

describe('createMockUser', () => {
  it('produces an obviously fake user, with distinct ids', () => {
    const first = createMockUser();
    const second = createMockUser();

    expect(first.email).toBe('test@example.com');
    expect(first.role).toBe('user');
    expect(first.id).not.toBe(second.id);
  });

  it('applies overrides', () => {
    expect(createMockUser({ role: 'admin', name: 'Ada' }).role).toBe('admin');
  });
});
