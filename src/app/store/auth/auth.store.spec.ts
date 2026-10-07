import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthStore } from './auth.store';
import { SESSION_HINT, type SessionHint } from './session-hint';
import type { AccessTokenResponse, AuthResponse, User } from './auth.models';

const mockUser: User = {
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user',
};

const mockAuthResponse: AuthResponse = {
  user: mockUser,
  accessToken: 'access-token',
};

const mockTokens: AccessTokenResponse = {
  accessToken: 'new-access-token',
};

const API = 'http://localhost:3000/api/v1/auth';

/**
 * A hint whose answer a spec controls, and whose `forget` is observable.
 *
 * The real one reads `document.cookie`, which Karma shares between specs — so driving
 * the store through the token instead of through the jar is both more direct and immune
 * to a cookie another spec left behind.
 */
function fakeHint(present = false): SessionHint & { forget: jasmine.Spy<() => void> } {
  let exists = present;
  const forget = jasmine.createSpy('forget').and.callFake(() => (exists = false));
  return { exists: () => exists, forget };
}

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;
  let httpTesting: HttpTestingController;
  let hint: ReturnType<typeof fakeHint>;

  beforeEach(() => {
    hint = fakeHint();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SESSION_HINT, useValue: hint },
      ],
    });
    store = TestBed.inject(AuthStore);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  /**
   * Every web-storage entry whose key or value mentions `token`.
   *
   * A scan rather than `localStorage.length === 0`: Karma runs every spec in one page, so
   * a theme preference another spec wrote is not this store's doing. What matters is that
   * no entry anywhere holds the token — the question `assert-no-token-persistence.mjs`
   * answers statically for the whole repository.
   */
  function webStorageMentioning(token: string): readonly string[] {
    const hits: string[] = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key === null) continue;
        const value = storage.getItem(key) ?? '';
        if (key.includes(token) || value.includes(token)) hits.push(`${key}=${value}`);
      }
    }
    return hits;
  }

  /** Signs in, leaving the store with a user and an access token. */
  function signIn(response: AuthResponse = mockAuthResponse): void {
    store.login({ email: 'test@example.com', password: 'password' });
    httpTesting.expectOne(`${API}/login`).flush(response);
  }

  describe('initial state', () => {
    it('has no user and no token', () => {
      expect(store.user()).toBeNull();
      expect(store.accessToken()).toBeNull();
      expect(store.isLoading()).toBeFalse();
      expect(store.error()).toBeNull();
    });

    it('isAuthenticated is false', () => {
      expect(store.isAuthenticated()).toBeFalse();
    });

    it('isAdmin is false', () => {
      expect(store.isAdmin()).toBeFalse();
    });

    it('userRole is null', () => {
      expect(store.userRole()).toBeNull();
    });

    /**
     * The store is constructed without reading anything. Its predecessor restored tokens
     * from `localStorage` in an `onInit` hook; there is now nothing on the client to
     * restore from, which is the point of the change rather than a side effect of it.
     */
    it('issues no request while being constructed', () => {
      httpTesting.verify();
    });
  });

  describe('login', () => {
    it('sets isLoading while request is in-flight', () => {
      store.login({ email: 'test@example.com', password: 'password' });
      expect(store.isLoading()).toBeTrue();
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);
    });

    it('populates state on success', () => {
      signIn();

      expect(store.user()).toEqual(mockUser);
      expect(store.accessToken()).toBe('access-token');
      expect(store.isAuthenticated()).toBeTrue();
      expect(store.isLoading()).toBeFalse();
      expect(store.error()).toBeNull();
    });

    /**
     * The hardening, asserted at the one point a token enters the application.
     *
     * The access token is in the store and in no persistent store anywhere; the refresh
     * token is not in the response body at all — the server sends it as a `Set-Cookie`
     * the browser handles without this code seeing it, so there is nothing here that
     * could write it down. `scripts/ci/assert-no-token-persistence.mjs` is the
     * repository-wide version of this check, since a spec can only cover the paths it
     * calls.
     */
    it('persists no token anywhere a later page load could read it', () => {
      signIn();

      expect(store.accessToken()).toBe('access-token');
      expect(webStorageMentioning('access-token'))
        .withContext('an access token in web storage is readable by any script on the origin')
        .toEqual([]);
      expect(document.cookie)
        .withContext('nor may it be written to a cookie this document can read')
        .not.toContain('access-token');
    });

    it('sets server error message on 401', () => {
      store.login({ email: 'test@example.com', password: 'wrong' });
      httpTesting
        .expectOne(`${API}/login`)
        .flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

      expect(store.error()).toBe('Invalid credentials');
      expect(store.isLoading()).toBeFalse();
      expect(store.isAuthenticated()).toBeFalse();
    });

    it('falls back to default message when server body has no message', () => {
      store.login({ email: 'test@example.com', password: 'wrong' });
      httpTesting
        .expectOne(`${API}/login`)
        .flush({}, { status: 500, statusText: 'Internal Server Error' });

      expect(store.error()).toBe('Login failed');
    });

    // `exhaustMap`, not `switchMap`: the duplicate is dropped rather than replacing a
    // POST the server may already have acted on — which now also means a refresh cookie
    // the browser has already stored.
    it('ignores a second submit while the first is in flight', () => {
      store.login({ email: 'test@example.com', password: 'password' });
      store.login({ email: 'test@example.com', password: 'password' });

      const requests = httpTesting.match(`${API}/login`);
      expect(requests.length).toBe(1);
      expect(requests[0].cancelled).toBeFalse();
      requests[0].flush(mockAuthResponse);
    });

    it('accepts a retry once the first attempt has settled', () => {
      store.login({ email: 'test@example.com', password: 'wrong' });
      httpTesting
        .expectOne(`${API}/login`)
        .flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

      signIn();

      expect(store.isAuthenticated()).toBeTrue();
      expect(store.error()).toBeNull();
    });
  });

  describe('register', () => {
    const credentials = {
      email: 'test@example.com',
      password: 'password',
      name: 'Test User',
    };

    it('populates state on success and persists no token', () => {
      store.register(credentials);
      httpTesting.expectOne(`${API}/register`).flush(mockAuthResponse);

      expect(store.user()).toEqual(mockUser);
      expect(store.accessToken()).toBe('access-token');
      expect(store.isAuthenticated()).toBeTrue();
      expect(store.isLoading()).toBeFalse();
      expect(webStorageMentioning('access-token')).toEqual([]);
    });

    it('sets the server error message on failure', () => {
      store.register(credentials);
      httpTesting
        .expectOne(`${API}/register`)
        .flush({ message: 'Email already taken' }, { status: 409, statusText: 'Conflict' });

      expect(store.error()).toBe('Email already taken');
      expect(store.isAuthenticated()).toBeFalse();
    });

    // Worth more here than on `login`: a duplicate that reaches the server creates a row.
    it('ignores a second submit while the first is in flight', () => {
      store.register(credentials);
      store.register(credentials);

      const requests = httpTesting.match(`${API}/register`);
      expect(requests.length).toBe(1);
      expect(requests[0].cancelled).toBeFalse();
      requests[0].flush(mockAuthResponse);
    });
  });

  describe('logout', () => {
    beforeEach(signIn);

    it('clears state synchronously, before the server has answered', () => {
      store.logout();

      expect(store.user()).toBeNull();
      expect(store.accessToken()).toBeNull();
      expect(store.isAuthenticated()).toBeFalse();

      httpTesting.expectOne(`${API}/logout`).flush(null);
    });

    /**
     * The request that stops a sign-out being cosmetic. The refresh cookie is `HttpOnly`,
     * so only a `Set-Cookie` can expire it: without this call the jar keeps a live
     * refresh token and the next page load restores the session the user just ended.
     */
    it('asks the server to revoke the session and expire the refresh cookie', () => {
      store.logout();

      const request = httpTesting.expectOne(`${API}/logout`);
      expect(request.request.method).toBe('POST');
      expect(request.request.withCredentials)
        .withContext('without credentials the cookie is not sent and nothing is revoked')
        .toBeTrue();
      request.flush(null);
    });

    it('drops the session hint, so a reload does not try to restore', () => {
      store.logout();
      httpTesting.expectOne(`${API}/logout`).flush(null);

      expect(hint.forget).toHaveBeenCalled();
    });

    /** A sign-out the network loses must still be a sign-out in this tab. */
    it('stays signed out when the revocation request fails', () => {
      store.logout();

      httpTesting
        .expectOne(`${API}/logout`)
        .flush({ message: 'Boom' }, { status: 500, statusText: 'Server Error' });

      expect(store.isAuthenticated()).toBeFalse();
      expect(store.user()).toBeNull();
      expect(store.error()).withContext('nothing for the user to act on').toBeNull();
    });

    it('ignores a second sign-out while the first revocation is in flight', () => {
      store.logout();
      store.logout();

      const requests = httpTesting.match(`${API}/logout`);
      expect(requests.length).toBe(1);
      requests[0].flush(null);
    });
  });

  describe('clearSession', () => {
    /**
     * The local half of signing out, for the one caller that needs it: `jwtInterceptor`
     * reaches this after a refresh has been *rejected*, where asking the server to
     * revoke the credential it just refused would be a wasted request.
     */
    it('forgets the session without asking the server anything', () => {
      signIn();

      store.clearSession();

      expect(store.isAuthenticated()).toBeFalse();
      expect(store.accessToken()).toBeNull();
      expect(hint.forget).toHaveBeenCalled();
      httpTesting.verify();
    });
  });

  describe('updateAccessToken', () => {
    it('replaces the token in memory and leaves the user signed in', () => {
      signIn();

      store.updateAccessToken('rotated-token');

      expect(store.accessToken()).toBe('rotated-token');
      expect(store.isAuthenticated()).toBeTrue();
      expect(webStorageMentioning('rotated-token')).toEqual([]);
    });
  });

  describe('refreshAccessToken', () => {
    beforeEach(signIn);

    it('adopts the rotated token on success', () => {
      store.refreshAccessToken();
      const request = httpTesting.expectOne(`${API}/refresh`);
      expect(request.request.body)
        .withContext('the credential is the cookie, not anything this code can pass')
        .toEqual({});
      request.flush(mockTokens);

      expect(store.accessToken()).toBe('new-access-token');
      expect(store.isAuthenticated()).toBeTrue();
      expect(webStorageMentioning('new-access-token')).toEqual([]);
    });

    /**
     * There is no local refresh token left to check, so "can I refresh?" is a question
     * only the server answers — and a rejection ends the session.
     */
    it('clears the session when the server rejects the refresh cookie', () => {
      store.refreshAccessToken();
      httpTesting
        .expectOne(`${API}/refresh`)
        .flush({ message: 'Expired' }, { status: 401, statusText: 'Unauthorized' });

      expect(store.accessToken()).toBeNull();
      expect(store.user()).toBeNull();
      expect(hint.forget).toHaveBeenCalled();
    });
  });

  describe('computed signals', () => {
    it('isAdmin is true for admin role', () => {
      signIn({ ...mockAuthResponse, user: { ...mockUser, role: 'admin' } });

      expect(store.isAdmin()).toBeTrue();
    });

    it('userRole returns the role string', () => {
      signIn();

      expect(store.userRole()).toBe('user');
    });

    it('currentUser returns the user object', () => {
      signIn();

      expect(store.currentUser()).toEqual(mockUser);
    });
  });

  describe('hasRole', () => {
    it('returns true when user has the given role', () => {
      signIn();

      expect(store.hasRole('user')).toBeTrue();
      expect(store.hasRole('admin')).toBeFalse();
    });

    it('returns false when no user is authenticated', () => {
      expect(store.hasRole('user')).toBeFalse();
    });
  });

  describe('clearError', () => {
    it('sets error to null', () => {
      store.login({ email: 'x', password: 'y' });
      httpTesting
        .expectOne(`${API}/login`)
        .flush({ message: 'Error' }, { status: 400, statusText: 'Bad Request' });

      store.clearError();
      expect(store.error()).toBeNull();
    });
  });
});

/**
 * The startup path, which is where the hardening is most visible: there is no token on
 * the client to restore, so a reload rebuilds the session out of a cookie this code
 * cannot read. `restoreSession` is what `provideAppInitializer` calls in `app.config.ts`.
 */
describe('AuthStore session restore', () => {
  let store: InstanceType<typeof AuthStore>;
  let httpTesting: HttpTestingController;
  let hint: ReturnType<typeof fakeHint>;

  function bootstrap(hintPresent: boolean): void {
    hint = fakeHint(hintPresent);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SESSION_HINT, useValue: hint },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
  }

  it('leaves the store idle until restoreSession is called', () => {
    bootstrap(true);

    // Constructing the store issues nothing. Doing it from a store hook would re-enter
    // the store's own factory through `jwtInterceptor` (NG0200).
    expect(store.accessToken()).toBeNull();
    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  it('trades the refresh cookie for a token and then fetches the profile', () => {
    bootstrap(true);

    store.restoreSession();

    expect(store.isRestoringSession()).toBeTrue();

    const refresh = httpTesting.expectOne(`${API}/refresh`);
    expect(refresh.request.withCredentials).toBeTrue();
    refresh.flush({ accessToken: 'restored-token' });

    expect(store.accessToken()).toBe('restored-token');
    expect(store.isAuthenticated()).withContext('a token alone is not a session').toBeFalse();
    expect(store.isRestoringSession()).toBeTrue();

    // `app.config.spec.ts` is where the bearer header on this request is asserted: this
    // `TestBed` provides `HttpClient` without the application's interceptor chain.
    httpTesting.expectOne(`${API}/me`).flush(mockUser);

    expect(store.user()).toEqual(mockUser);
    expect(store.isAuthenticated()).toBeTrue();
    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  /**
   * The reason the hint exists. Without it every anonymous page load would spend a
   * credentialed round trip to be told 401, and `authGuard` would have to wait for it
   * before redirecting someone who was never signed in.
   */
  it('spends no request when there is no hint of a session', () => {
    bootstrap(false);

    store.restoreSession();

    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  /**
   * And the reason it is only ever a *hint*. A cookie the client can read is a cookie
   * the client can be wrong about: revoked server-side, rotated away, or signed out in
   * another tab. A failed refresh has to settle the flag `authGuard` waits on and drop
   * the hint, or every later load repeats the same doomed request.
   */
  it('ends the restore and forgets the hint when the refresh is rejected', () => {
    bootstrap(true);

    store.restoreSession();
    httpTesting
      .expectOne(`${API}/refresh`)
      .flush({ message: 'Expired' }, { status: 401, statusText: 'Unauthorized' });

    expect(store.isRestoringSession())
      .withContext('a restore that never settles hangs the navigation instead of redirecting')
      .toBeFalse();
    expect(store.isAuthenticated()).toBeFalse();
    expect(hint.forget).toHaveBeenCalled();
    httpTesting.verify();
  });

  it('is a no-op when a user is already loaded', () => {
    bootstrap(true);
    store.login({ email: 'test@example.com', password: 'password' });
    httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);

    store.restoreSession();

    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  it('does not stack a second request while one is in flight', () => {
    bootstrap(true);
    store.restoreSession();

    store.restoreSession();

    expect(httpTesting.match(`${API}/refresh`).length)
      .withContext('the guard would be left waiting on whichever response lost the race')
      .toBe(1);
  });

  it('finishes restoring even when the profile request fails', () => {
    bootstrap(true);
    store.restoreSession();
    httpTesting.expectOne(`${API}/refresh`).flush({ accessToken: 'restored-token' });

    httpTesting
      .expectOne(`${API}/me`)
      .flush({ message: 'Boom' }, { status: 500, statusText: 'Server Error' });

    // A restore that never settles is worse than one that fails: `authGuard` waits on
    // this flag, so leaving it set would hang the navigation rather than redirect.
    expect(store.isRestoringSession()).toBeFalse();
    expect(store.isAuthenticated()).toBeFalse();
    httpTesting.verify();
  });
});
