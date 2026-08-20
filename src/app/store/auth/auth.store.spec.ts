import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthStore } from './auth.store';
import type { AuthResponse, AuthTokens, User } from './auth.models';

const mockUser: User = {
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user',
};

const mockAuthResponse: AuthResponse = {
  user: mockUser,
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
};

const mockTokens: AuthTokens = {
  accessToken: 'new-access-token',
  refreshToken: 'new-refresh-token',
};

const API = 'http://localhost:3000/api/v1/auth';

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(AuthStore);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('has null user and tokens', () => {
      expect(store.user()).toBeNull();
      expect(store.accessToken()).toBeNull();
      expect(store.refreshToken()).toBeNull();
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
  });

  describe('login', () => {
    it('sets isLoading while request is in-flight', () => {
      store.login({ email: 'test@example.com', password: 'password' });
      expect(store.isLoading()).toBeTrue();
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);
    });

    it('populates state on success', () => {
      store.login({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);

      expect(store.user()).toEqual(mockUser);
      expect(store.accessToken()).toBe('access-token');
      expect(store.isAuthenticated()).toBeTrue();
      expect(store.isLoading()).toBeFalse();
      expect(store.error()).toBeNull();
    });

    it('persists tokens to localStorage on success', () => {
      store.login({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);

      expect(localStorage.getItem('auth_access_token')).toBe('access-token');
      expect(localStorage.getItem('auth_refresh_token')).toBe('refresh-token');
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
  });

  describe('logout', () => {
    beforeEach(() => {
      store.login({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);
    });

    it('clears state synchronously', () => {
      store.logout();

      expect(store.user()).toBeNull();
      expect(store.accessToken()).toBeNull();
      expect(store.isAuthenticated()).toBeFalse();
    });

    it('removes tokens from localStorage', () => {
      store.logout();

      expect(localStorage.getItem('auth_access_token')).toBeNull();
      expect(localStorage.getItem('auth_refresh_token')).toBeNull();
    });
  });

  describe('loadFromStorage', () => {
    it('restores tokens from localStorage', () => {
      localStorage.setItem('auth_access_token', 'stored-token');
      localStorage.setItem('auth_refresh_token', 'stored-refresh');
      store.loadFromStorage();

      expect(store.accessToken()).toBe('stored-token');
      expect(store.refreshToken()).toBe('stored-refresh');
    });

    it('does not change state when localStorage is empty', () => {
      store.loadFromStorage();
      expect(store.accessToken()).toBeNull();
    });
  });

  describe('refreshAccessToken', () => {
    beforeEach(() => {
      store.login({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);
    });

    it('updates tokens in state and localStorage on success', () => {
      store.refreshAccessToken();
      httpTesting.expectOne(`${API}/refresh`).flush(mockTokens);

      expect(store.accessToken()).toBe('new-access-token');
      expect(store.refreshToken()).toBe('new-refresh-token');
      expect(localStorage.getItem('auth_access_token')).toBe('new-access-token');
    });

    it('clears state when no refresh token exists', () => {
      store.logout();
      store.refreshAccessToken();

      expect(store.accessToken()).toBeNull();
      expect(store.user()).toBeNull();
    });
  });

  describe('computed signals', () => {
    it('isAdmin is true for admin role', () => {
      store.login({ email: 'admin@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush({
        ...mockAuthResponse,
        user: { ...mockUser, role: 'admin' },
      });

      expect(store.isAdmin()).toBeTrue();
    });

    it('userRole returns the role string', () => {
      store.login({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);

      expect(store.userRole()).toBe('user');
    });

    it('currentUser returns the user object', () => {
      store.login({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);

      expect(store.currentUser()).toEqual(mockUser);
    });
  });

  describe('hasRole', () => {
    it('returns true when user has the given role', () => {
      store.login({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);

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
 * The startup path. `restoreSession` is what `provideAppInitializer` calls in
 * `app.config.ts`; `onInit` only restores the tokens.
 */
describe('AuthStore session restore', () => {
  let store: InstanceType<typeof AuthStore>;
  let httpTesting: HttpTestingController;

  function bootstrap(): void {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function seedTokens(): void {
    localStorage.setItem('auth_access_token', 'stored-token');
    localStorage.setItem('auth_refresh_token', 'stored-refresh');
  }

  it('leaves the store idle until restoreSession is called', () => {
    seedTokens();

    bootstrap();

    // `onInit` restores the tokens and nothing else. Issuing the request from there
    // would re-enter the store's own factory through `jwtInterceptor` (NG0200).
    expect(store.accessToken()).toBe('stored-token');
    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  it('fetches the profile behind a token found in storage', () => {
    seedTokens();
    bootstrap();

    store.restoreSession();

    expect(store.isRestoringSession()).toBeTrue();
    expect(store.isAuthenticated()).withContext('tokens alone are not a session').toBeFalse();

    httpTesting.expectOne(`${API}/me`).flush(mockUser);

    expect(store.user()).toEqual(mockUser);
    expect(store.isAuthenticated()).toBeTrue();
    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  it('does not restore anything when storage is empty', () => {
    bootstrap();

    store.restoreSession();

    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  it('is a no-op when a user is already loaded', () => {
    bootstrap();
    store.login({ email: 'test@example.com', password: 'password' });
    httpTesting.expectOne(`${API}/login`).flush(mockAuthResponse);

    store.restoreSession();

    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  it('does not stack a second request while one is in flight', () => {
    seedTokens();
    bootstrap();
    store.restoreSession();

    store.restoreSession();

    expect(httpTesting.match(`${API}/me`).length)
      .withContext('the guard would be left waiting on whichever response lost the race')
      .toBe(1);
  });

  it('finishes restoring even when the profile request fails', () => {
    seedTokens();
    bootstrap();
    store.restoreSession();

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
