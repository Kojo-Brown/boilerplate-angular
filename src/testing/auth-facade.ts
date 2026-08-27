import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import type { AuthFacadeApi, LoginCredentials, RegisterCredentials, User } from '@/app/core/auth';

/** What a spec may pin on the auth double before rendering. */
export interface FakeAuthFacadeOptions {
  user?: User | null;
  /** Defaults to `user !== null`, which is the invariant the real facade holds. */
  isSignedIn?: boolean;
  isBusy?: boolean;
  errorMessage?: string | null;
}

/**
 * The double, with its reads writable so a spec can move them mid-test and its commands
 * spied so a spec can assert on them.
 *
 * It extends `AuthFacadeApi` rather than restating it: a member added to the facade is a
 * compile error here until it is added, which is the check
 * [`createMockAuthStore`](./mock-factories.ts) can only make at runtime.
 */
export interface FakeAuthFacade extends AuthFacadeApi {
  readonly currentUser: WritableSignal<User | null>;
  readonly isSignedIn: WritableSignal<boolean>;
  readonly isBusy: WritableSignal<boolean>;
  readonly errorMessage: WritableSignal<string | null>;
  readonly signIn: jasmine.Spy<(credentials: LoginCredentials) => void>;
  readonly signUp: jasmine.Spy<(credentials: RegisterCredentials) => void>;
  readonly signOut: jasmine.Spy<() => void>;
  readonly dismissError: jasmine.Spy<() => void>;
}

/**
 * A stand-in for `AuthFacade`.
 *
 * Real `signal`s rather than spies returning fixed values, because a component under
 * test reads these through its template: a spec that flips `isSignedIn` after the first
 * render needs the change to reach the view, and a `jasmine.Spy` is not a reactive node,
 * so nothing would refresh — least of all under zoneless change detection.
 *
 * The signed-in flag is *derived* from the user by default, since the facade cannot
 * report a session with nobody in it. A spec can still write the two apart afterwards;
 * doing so on purpose is a different thing from getting it wrong in setup.
 */
export function createFakeAuthFacade(options: FakeAuthFacadeOptions = {}): FakeAuthFacade {
  const user = options.user ?? null;

  return {
    currentUser: signal<User | null>(user),
    isSignedIn: signal(options.isSignedIn ?? user !== null),
    isBusy: signal(options.isBusy ?? false),
    errorMessage: signal<string | null>(options.errorMessage ?? null),
    signIn: jasmine.createSpy('signIn'),
    signUp: jasmine.createSpy('signUp'),
    signOut: jasmine.createSpy('signOut'),
    dismissError: jasmine.createSpy('dismissError'),
  };
}
