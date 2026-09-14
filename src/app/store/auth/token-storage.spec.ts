import { TestBed } from '@angular/core/testing';
import {
  ACCESS_TOKEN_KEY,
  AUTH_TOKEN_STORAGE,
  REFRESH_TOKEN_KEY,
  browserAuthTokenStorage,
} from './token-storage';

describe('browserAuthTokenStorage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  describe('with a browser window', () => {
    const storage = (): ReturnType<typeof browserAuthTokenStorage> =>
      browserAuthTokenStorage(window);

    it('reads back what it wrote', () => {
      storage().write({ accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' });

      expect(storage().read()).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      });
    });

    it('writes under the documented keys, so a sign-out elsewhere can find them', () => {
      storage().write({ accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' });

      expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('mock-access-token');
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('mock-refresh-token');
    });

    it('reads null when nothing is stored', () => {
      expect(storage().read()).toBeNull();
    });

    /**
     * An access token with no refresh token is a session that cannot survive its first
     * 401. Restoring half a pair would leave `isAuthenticated` true until it does.
     */
    it('reads null when only half a pair is present', () => {
      localStorage.setItem(ACCESS_TOKEN_KEY, 'mock-access-token');

      expect(storage().read()).toBeNull();
    });

    it('clears both keys', () => {
      storage().write({ accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' });

      storage().clear();

      expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    });
  });

  /**
   * What the server gets. Every method has to be callable and none may throw: `AuthStore`
   * reads storage from its `onInit` hook, so a throw here happens while the injector is
   * constructing a root service during a render, and takes the whole page with it.
   */
  describe('without a window', () => {
    const storage = browserAuthTokenStorage(null);

    it('reads no session', () => {
      expect(storage.read()).toBeNull();
    });

    it('accepts a write without storing anything', () => {
      expect(() =>
        storage.write({ accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' })
      ).not.toThrow();
      expect(storage.read()).toBeNull();
      expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    });

    it('accepts a clear', () => {
      expect(() => storage.clear()).not.toThrow();
    });
  });
});

describe('AUTH_TOKEN_STORAGE', () => {
  afterEach(() => localStorage.clear());

  it('defaults to the browser implementation', () => {
    TestBed.inject(AUTH_TOKEN_STORAGE).write({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    });

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('mock-access-token');
  });

  it('can be replaced without touching the store', () => {
    const fake = browserAuthTokenStorage(null);
    TestBed.configureTestingModule({
      providers: [{ provide: AUTH_TOKEN_STORAGE, useValue: fake }],
    });

    expect(TestBed.inject(AUTH_TOKEN_STORAGE)).toBe(fake);
  });
});
