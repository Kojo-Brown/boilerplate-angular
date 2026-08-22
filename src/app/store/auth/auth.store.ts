import { computed, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { tapResponse } from '@ngrx/operators';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { EMPTY, exhaustMap, pipe, switchMap, tap } from 'rxjs';
import { AuthService } from './auth.service';
import type { AuthState, AuthTokens, LoginCredentials, RegisterCredentials } from './auth.models';

const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';

const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoading: false,
  error: null,
  isRestoringSession: false,
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(initialState),
  withComputed(({ user, accessToken }) => ({
    isAuthenticated: computed(() => !!accessToken() && !!user()),
    isAdmin: computed(() => user()?.role === 'admin'),
    currentUser: computed(() => user()),
    userRole: computed(() => user()?.role ?? null),
  })),
  withMethods((store, authService = inject(AuthService)) => ({
    /**
     * `exhaustMap`, not `switchMap`: a second submit while one is in flight is ignored,
     * rather than cancelling the first and sending another.
     *
     * The forms disable their submit button on `isLoading()`, but that is a *rendered*
     * guard — under zoneless the `patchState` above schedules a refresh, so a double
     * click inside one frame reaches this pipeline twice. `switchMap` would then abort a
     * request the server may already have acted on: cancelling a POST unsubscribes the
     * client, it does not un-issue the write, and the tokens the aborted response carried
     * are lost while the session it created is not. Ignoring the duplicate is the only
     * choice that leaves exactly one login attempt behind. See
     * [`docs/rxjs-flattening.md`](../../../../docs/rxjs-flattening.md).
     */
    login: rxMethod<LoginCredentials>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        exhaustMap((credentials) =>
          authService.login(credentials).pipe(
            tapResponse({
              next: ({ user, accessToken, refreshToken }) => {
                localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
                localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
                patchState(store, { user, accessToken, refreshToken, isLoading: false });
              },
              error: (err: unknown) => {
                const message =
                  err instanceof HttpErrorResponse
                    ? ((err.error as { message?: string })?.message ?? 'Login failed')
                    : 'Login failed';
                patchState(store, { isLoading: false, error: message });
              },
            })
          )
        )
      )
    ),

    /** `exhaustMap` for the same reason as `login`, and more so: registration creates a row. */
    register: rxMethod<RegisterCredentials>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        exhaustMap((credentials) =>
          authService.register(credentials).pipe(
            tapResponse({
              next: ({ user, accessToken, refreshToken }) => {
                localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
                localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
                patchState(store, { user, accessToken, refreshToken, isLoading: false });
              },
              error: (err: unknown) => {
                const message =
                  err instanceof HttpErrorResponse
                    ? ((err.error as { message?: string })?.message ?? 'Registration failed')
                    : 'Registration failed';
                patchState(store, { isLoading: false, error: message });
              },
            })
          )
        )
      )
    ),

    logout(): void {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      patchState(store, initialState);
    },

    updateTokens({ accessToken, refreshToken }: AuthTokens): void {
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      patchState(store, { accessToken, refreshToken });
    },

    refreshAccessToken: rxMethod<void>(
      pipe(
        exhaustMap(() => {
          const token = store.refreshToken();
          if (!token) {
            localStorage.removeItem(ACCESS_TOKEN_KEY);
            localStorage.removeItem(REFRESH_TOKEN_KEY);
            patchState(store, initialState);
            return EMPTY;
          }
          return authService.refreshToken(token).pipe(
            tapResponse({
              next: ({ accessToken, refreshToken }) => {
                localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
                localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
                patchState(store, { accessToken, refreshToken });
              },
              error: () => {
                localStorage.removeItem(ACCESS_TOKEN_KEY);
                localStorage.removeItem(REFRESH_TOKEN_KEY);
                patchState(store, initialState);
              },
            })
          );
        })
      )
    ),

    /**
     * `switchMap` here, unlike `login`: this is a read, so a superseded request costs
     * nothing to abandon and the newest answer is the one the store should hold.
     */
    loadCurrentUser: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true })),
        switchMap(() =>
          authService.getProfile().pipe(
            tapResponse({
              next: (user) =>
                patchState(store, { user, isLoading: false, isRestoringSession: false }),
              error: (err: unknown) => {
                const message =
                  err instanceof HttpErrorResponse ? err.message : 'Failed to load user';
                patchState(store, { isLoading: false, isRestoringSession: false, error: message });
              },
            })
          )
        )
      )
    ),

    loadFromStorage(): void {
      const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (accessToken && refreshToken) {
        patchState(store, { accessToken, refreshToken });
      }
    },

    hasRole(role: 'user' | 'admin'): boolean {
      return store.user()?.role === role;
    },

    clearError(): void {
      patchState(store, { error: null });
    },
  })),
  /**
   * A second `withMethods` block, because `restoreSession` calls `loadCurrentUser` and a
   * block's `store` argument carries only the methods defined *before* it.
   */
  withMethods((store) => ({
    /**
     * Turn restored tokens into a session by fetching the user behind them.
     *
     * Restoring the tokens is only half a session: `isAuthenticated` also wants a user,
     * so without this a reload of a guarded route bounced a signed-in user to `/login`.
     *
     * Deliberately *not* called from `onInit`. `jwtInterceptor` injects this store to
     * read the access token, so a request issued while the store is still being
     * constructed re-enters its own factory — Angular reports `NG0200: Circular
     * dependency detected for SignalStore`, the request never leaves, and the restore
     * "fails" instantly. `app.config.ts` calls this from `provideAppInitializer`, once
     * construction has finished.
     */
    restoreSession(): void {
      if (!store.accessToken() || store.user() !== null || store.isRestoringSession()) {
        return;
      }

      // Set before the request, not inside the loader: `authGuard` reads this to tell
      // "signed out" apart from "not known yet", and the initial navigation can start
      // before the response arrives.
      patchState(store, { isRestoringSession: true });
      store.loadCurrentUser();
    },
  })),
  withHooks({
    onInit(store) {
      store.loadFromStorage();
    },
  })
);
