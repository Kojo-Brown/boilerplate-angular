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
    login: rxMethod<LoginCredentials>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap((credentials) =>
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

    register: rxMethod<RegisterCredentials>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap((credentials) =>
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

    loadCurrentUser: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true })),
        switchMap(() =>
          authService.getProfile().pipe(
            tapResponse({
              next: (user) => patchState(store, { user, isLoading: false }),
              error: (err: unknown) => {
                const message =
                  err instanceof HttpErrorResponse ? err.message : 'Failed to load user';
                patchState(store, { isLoading: false, error: message });
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
  withHooks({
    onInit(store) {
      store.loadFromStorage();
    },
  })
);
