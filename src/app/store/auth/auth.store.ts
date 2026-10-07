import { computed, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { exhaustMap, pipe, switchMap, tap } from 'rxjs';
import { AuthService } from './auth.service';
import { SESSION_HINT } from './session-hint';
import type { AuthState, LoginCredentials, RegisterCredentials } from './auth.models';

const initialState: AuthState = {
  user: null,
  accessToken: null,
  isLoading: false,
  error: null,
  isRestoringSession: false,
};

/*
 * The three fallbacks below are what the user is shown when the server's own message is
 * missing or unusable. The server's message passes through untranslated by design: it is
 * the API's to localise, from the request's `Accept-Language`, and second-guessing it in
 * the client would mean mapping strings we do not own back to message ids.
 */
const LOGIN_FAILED = $localize`:Fallback when sign-in failed and the server said nothing useful@@auth.error.loginFailed:Login failed`;
const REGISTRATION_FAILED = $localize`:Fallback when registration failed and the server said nothing useful@@auth.error.registrationFailed:Registration failed`;
const SESSION_LOAD_FAILED = $localize`:Fallback when restoring the session failed@@auth.error.sessionLoadFailed:Failed to load user`;

/**
 * The session, and the only place in this application an access token exists.
 *
 * `accessToken` is a field of this store's state, which is to say a signal in a
 * root-provided service: it lives in memory, for as long as the tab does, and no code
 * path writes it anywhere a later page load could read it back. The refresh token is not
 * here at all — it is an `HttpOnly` cookie the API sets, which the browser attaches to
 * `POST /auth/refresh` and which JavaScript on this origin cannot read. What that buys,
 * what it costs, and what the API has to send for it to work are in
 * `docs/token-storage.md`; `scripts/ci/assert-no-token-persistence.mjs` is what keeps a
 * later change from quietly putting a token back into storage.
 */
export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(initialState),
  withComputed(({ user, accessToken }) => ({
    isAuthenticated: computed(() => !!accessToken() && !!user()),
    isAdmin: computed(() => user()?.role === 'admin'),
    currentUser: computed(() => user()),
    userRole: computed(() => user()?.role ?? null),
  })),
  withMethods((store, authService = inject(AuthService), hint = inject(SESSION_HINT)) => {
    /**
     * Forget the session here and now, without asking the server anything.
     *
     * The half of signing out that a client can do alone, and the whole of what is
     * appropriate when the refresh cookie is already known to be dead — which is the
     * case `jwtInterceptor` reaches after a refresh returns 401. Spending another
     * request to revoke a credential the server has just rejected would be noise.
     */
    const clearSession = (): void => {
      hint.forget();
      patchState(store, initialState);
    };

    const adoptAccessToken = (accessToken: string): void => patchState(store, { accessToken });

    /**
     * Ask the server to revoke the session and expire the refresh cookie.
     *
     * Both outcomes are ignored, and that is deliberate rather than lazy. The local
     * state is already cleared by the time this runs, so there is nothing a success
     * would add and nothing a failure should undo: a user who clicked "sign out" on a
     * flaky connection must end up signed out of this tab regardless. What a failure
     * does leave behind is a live refresh cookie — which is the server's to expire and
     * cannot be reached from here, since it is `HttpOnly`.
     *
     * `exhaustMap` so a second click while the first revocation is in flight is dropped
     * rather than sending another.
     */
    const revokeSession = rxMethod<void>(
      pipe(
        exhaustMap(() =>
          authService.logout().pipe(
            tapResponse({
              next: () => undefined,
              error: () => undefined,
            })
          )
        )
      )
    );

    return {
      /**
       * `exhaustMap`, not `switchMap`: a second submit while one is in flight is ignored,
       * rather than cancelling the first and sending another.
       *
       * The forms disable their submit button on `isLoading()`, but that is a *rendered*
       * guard — under zoneless the `patchState` above schedules a refresh, so a double
       * click inside one frame reaches this pipeline twice. `switchMap` would then abort a
       * request the server may already have acted on: cancelling a POST unsubscribes the
       * client, it does not un-issue the write, and the session the aborted response
       * established is live with its access token lost — now including a refresh cookie
       * the browser has already stored. Ignoring the duplicate is the only choice that
       * leaves exactly one login attempt behind. See
       * [`docs/rxjs-flattening.md`](../../../../docs/rxjs-flattening.md).
       */
      login: rxMethod<LoginCredentials>(
        pipe(
          tap(() => patchState(store, { isLoading: true, error: null })),
          exhaustMap((credentials) =>
            authService.login(credentials).pipe(
              tapResponse({
                // No token is written anywhere: `accessToken` goes into this store's
                // state and the refresh token arrives as a `Set-Cookie` the browser
                // stores without this code seeing it.
                next: ({ user, accessToken }) =>
                  patchState(store, { user, accessToken, isLoading: false }),
                error: (err: unknown) => {
                  const message =
                    err instanceof HttpErrorResponse
                      ? ((err.error as { message?: string })?.message ?? LOGIN_FAILED)
                      : LOGIN_FAILED;
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
                next: ({ user, accessToken }) =>
                  patchState(store, { user, accessToken, isLoading: false }),
                error: (err: unknown) => {
                  const message =
                    err instanceof HttpErrorResponse
                      ? ((err.error as { message?: string })?.message ?? REGISTRATION_FAILED)
                      : REGISTRATION_FAILED;
                  patchState(store, { isLoading: false, error: message });
                },
              })
            )
          )
        )
      ),

      /**
       * Sign out: locally at once, and on the server as soon as it answers.
       *
       * The order matters. Clearing first means the interface is signed out in the same
       * frame as the click, with no spinner and nothing to fail; the revocation then
       * runs on its own. Waiting for the response instead would leave a user staring at
       * a signed-in page whenever the network is slow, and still signed in if it never
       * answers.
       */
      logout(): void {
        clearSession();
        revokeSession();
      },

      clearSession,

      /** Adopt a rotated access token. `jwtInterceptor` calls this after a refresh. */
      updateAccessToken: adoptAccessToken,

      /**
       * Rotate the access token against the refresh cookie, outside the 401 path.
       *
       * There is no token to check first, and no way to check one: whether the cookie
       * exists and is still valid is a question only the server can answer, so this
       * asks it and treats a rejection as the end of the session.
       */
      refreshAccessToken: rxMethod<void>(
        pipe(
          exhaustMap(() =>
            authService.refresh().pipe(
              tapResponse({
                next: ({ accessToken }) => adoptAccessToken(accessToken),
                error: clearSession,
              })
            )
          )
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
                    err instanceof HttpErrorResponse ? err.message : SESSION_LOAD_FAILED;
                  patchState(store, {
                    isLoading: false,
                    isRestoringSession: false,
                    error: message,
                  });
                },
              })
            )
          )
        )
      ),

      hasRole(role: 'user' | 'admin'): boolean {
        return store.user()?.role === role;
      },

      clearError(): void {
        patchState(store, { error: null });
      },
    };
  }),
  /**
   * A second `withMethods` block, because the restore pipeline calls `loadCurrentUser`
   * and `clearSession`, and a block's `store` argument carries only the methods defined
   * *before* it.
   */
  withMethods((store, authService = inject(AuthService), hint = inject(SESSION_HINT)) => {
    /**
     * Two requests, in order: trade the refresh cookie for an access token, then fetch
     * the user it belongs to. Both are needed, because `isAuthenticated` is
     * `accessToken && user` — a token alone is not a session.
     *
     * Kept out of the returned surface on purpose. `restoreSession` is the entry point,
     * and it is the one that owns the preconditions; a caller able to start the
     * pipeline directly could start a second one.
     */
    const continueSession = rxMethod<void>(
      pipe(
        exhaustMap(() =>
          authService.refresh().pipe(
            tapResponse({
              next: ({ accessToken }) => {
                store.updateAccessToken(accessToken);
                store.loadCurrentUser();
              },
              // The hint said there was a session and there was not: expired, revoked,
              // rotated away, or signed out in another tab. `clearSession` drops the
              // hint too, so the next load does not retry against the same dead cookie.
              error: () => store.clearSession(),
            })
          )
        )
      )
    );

    return {
      /**
       * Turn a refresh cookie into a session, if there is one.
       *
       * Called from `provideAppInitializer` in `app.config.ts`, once per page load.
       * Three things it will not do:
       *
       * 1. **Run when there is already a session.** An access token or a loaded user
       *    means this tab signed in normally and has nothing to restore.
       * 2. **Run twice concurrently.** `isRestoringSession` is the in-flight flag as
       *    well as the one `authGuard` waits on, so a second call would leave the guard
       *    waiting on whichever response lost the race.
       * 3. **Spend a request on a visitor who was never signed in.** That is what
       *    {@link SessionHint} is for; without it every anonymous page load would pay a
       *    credentialed round trip to be told 401. The hint is advisory in one direction
       *    only — it can start a restore, and only a successful refresh plus profile can
       *    finish one.
       *
       * Deliberately *not* called from a store hook. `jwtInterceptor` injects this store
       * to read the access token, so a request issued while the store is still being
       * constructed re-enters its own factory — Angular reports `NG0200: Circular
       * dependency detected for SignalStore`, the request never leaves, and the restore
       * "fails" instantly. `app.config.spec.ts` has the regression test.
       */
      restoreSession(): void {
        if (store.accessToken() !== null || store.user() !== null || store.isRestoringSession()) {
          return;
        }
        if (!hint.exists()) {
          return;
        }

        // Set before the request, not inside the loader: `authGuard` reads this to tell
        // "signed out" apart from "not known yet", and the initial navigation can start
        // before the response arrives.
        patchState(store, { isRestoringSession: true });
        continueSession();
      },
    };
  })
);
