import { Injectable, inject } from '@angular/core';
import type { Signal } from '@angular/core';
import { AuthStore } from '@/app/store/auth/auth.store';
import type { LoginCredentials, RegisterCredentials, User } from '@/app/store/auth/auth.models';

/**
 * Everything view code is allowed to know about the signed-in user.
 *
 * The interface exists so a component's *declared* dependency is this shape rather than
 * `AuthFacade` the class, and so a test double is checked against it by the compiler
 * instead of by whichever spec renders the component first — `ValueProvider.useValue` is
 * typed `any`, so `{ provide: AuthFacade, useValue: {} }` compiles.
 */
export interface AuthFacadeApi {
  /** The signed-in user, or `null`. */
  readonly currentUser: Signal<User | null>;
  /** A user *and* a token are present. `false` also covers "not known yet" — see below. */
  readonly isSignedIn: Signal<boolean>;
  /** A sign-in, sign-up or profile request is in flight. */
  readonly isBusy: Signal<boolean>;
  /** The last failure, in words a template can render. */
  readonly errorMessage: Signal<string | null>;

  signIn(credentials: LoginCredentials): void;
  signUp(credentials: RegisterCredentials): void;
  signOut(): void;
  dismissError(): void;
}

/**
 * The auth domain as components see it.
 *
 * `AuthStore` is an `@ngrx/signals` store and stays one — `rxMethod` and its flattening
 * control are why (see [`docs/rxjs-flattening.md`](../../../../docs/rxjs-flattening.md)).
 * This class is the seam that keeps that choice out of `features/` and `shared/`, which
 * `eslint.config.mjs` enforces by refusing `@ngrx/*` and `@/app/store/*` imports there.
 * Three things it takes away from a component, each of which was reachable before:
 *
 * 1. **The tokens.** `accessToken` and `refreshToken` are signals on the store, so any
 *    component holding it could interpolate a bearer token into a template or hand it to
 *    a third-party widget. They are not on this surface, and `updateTokens` is not
 *    either: rotating a session is the interceptor's job, not a view's.
 * 2. **The session lifecycle.** `loadFromStorage`, `restoreSession`, `refreshAccessToken`
 *    and `loadCurrentUser` are bootstrap and transport concerns, wired once in
 *    `app.config.ts` and `jwtInterceptor`. A component calling one of them mid-render is
 *    a bug with no legitimate case behind it.
 * 3. **RxJS.** `store.login` is an `rxMethod`, whose call signature is
 *    `T | Signal<T> | Observable<T>` and whose return value is a subscription. So a
 *    template could pass an observable of credentials and a component could hold the
 *    subscription — coupling a view to both RxJS and NgRx through a method that looks
 *    like a plain call. `signIn(credentials: LoginCredentials): void` accepts one value
 *    and returns nothing.
 *
 * What it deliberately does *not* do is wrap the signals. `currentUser` is the store's
 * own `computed`, passed straight through: a `Signal` is already read-only, and copying
 * it into a second one would add a reactive node, a subscription to keep alive, and a
 * frame of lag, to re-express something the type system says once. The facade is a
 * narrower door onto the same graph, not a second graph.
 *
 * `isAdmin`, `userRole` and `hasRole` are on the store and not here on purpose: every
 * role decision in this app is made by `roleGuard` before a component is created. The
 * day a template needs to hide an admin-only control, adding a `Signal<boolean>` here is
 * one line — and until then, a member no caller has is a member no caller can misuse.
 * See [`docs/facade.md`](../../../../docs/facade.md).
 */
@Injectable({ providedIn: 'root' })
export class AuthFacade implements AuthFacadeApi {
  private readonly store = inject(AuthStore);

  readonly currentUser: Signal<User | null> = this.store.currentUser;
  readonly isSignedIn: Signal<boolean> = this.store.isAuthenticated;
  readonly isBusy: Signal<boolean> = this.store.isLoading;
  readonly errorMessage: Signal<string | null> = this.store.error;

  signIn(credentials: LoginCredentials): void {
    this.store.login(credentials);
  }

  signUp(credentials: RegisterCredentials): void {
    this.store.register(credentials);
  }

  signOut(): void {
    this.store.logout();
  }

  dismissError(): void {
    this.store.clearError();
  }
}
