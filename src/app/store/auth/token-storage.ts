import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { storageOf } from '@/app/core/platform/web-storage';
import type { AuthTokens } from './auth.models';

/** Storage keys for the session. Exported so a test — or a sign-out elsewhere — can seed them. */
export const ACCESS_TOKEN_KEY = 'auth_access_token';
export const REFRESH_TOKEN_KEY = 'auth_refresh_token';

/**
 * Where the session's tokens live between page loads.
 *
 * The same split as {@link ThemePreferenceStore}: this is the *mechanism* — two keys and
 * a `Storage` object — while `AuthStore` owns the policy. Pulling it out of the store is
 * what makes the store runnable at all under server-side rendering, where `localStorage`
 * is not a global that happens to be missing so much as a concept that does not apply:
 * there is one process serving every visitor, so there is nowhere for one visitor's
 * tokens to be.
 *
 * It is also the seam Phase 10's token-storage item will replace — an in-memory access
 * token plus an httpOnly refresh cookie is a different implementation of these three
 * methods and nothing else.
 */
export interface AuthTokenStorage {
  /** The stored pair, or `null` unless *both* halves are present. */
  read(): AuthTokens | null;
  /** Replace the stored pair. */
  write(tokens: AuthTokens): void;
  /** Forget the stored pair. */
  clear(): void;
}

/** `localStorage`, where there is one. A no-op everywhere else, including the server. */
export function browserAuthTokenStorage(view: Window | null): AuthTokenStorage {
  const storage = storageOf(view);

  return {
    read(): AuthTokens | null {
      const accessToken = storage?.getItem(ACCESS_TOKEN_KEY);
      const refreshToken = storage?.getItem(REFRESH_TOKEN_KEY);
      // Both or neither: an access token with no refresh token is a session that cannot
      // survive its first 401, and restoring half a pair would make `isAuthenticated`
      // true for however long that takes.
      return accessToken && refreshToken ? { accessToken, refreshToken } : null;
    },
    write({ accessToken, refreshToken }: AuthTokens): void {
      storage?.setItem(ACCESS_TOKEN_KEY, accessToken);
      storage?.setItem(REFRESH_TOKEN_KEY, refreshToken);
    },
    clear(): void {
      storage?.removeItem(ACCESS_TOKEN_KEY);
      storage?.removeItem(REFRESH_TOKEN_KEY);
    },
  };
}

/**
 * The seam `AuthStore` depends on. Override it in a `TestBed` without touching the store.
 */
export const AUTH_TOKEN_STORAGE = new InjectionToken<AuthTokenStorage>('AUTH_TOKEN_STORAGE', {
  providedIn: 'root',
  factory: () => browserAuthTokenStorage(inject(DOCUMENT).defaultView),
});
