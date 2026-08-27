import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthStore } from '@/app/store/auth/auth.store';
import type { AuthResponse } from '@/app/store/auth/auth.models';
import { AuthFacade } from './auth.facade';

const API = 'http://localhost:3000/api/v1/auth';

const authResponse: AuthResponse = {
  user: { id: '1', email: 'test@example.com', name: 'Test User', role: 'user' },
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
};

/**
 * Exercised against the *real* `AuthStore`, not a double.
 *
 * A facade's only risk is that it lies about the thing behind it, and a spec that
 * asserts "the facade called the double" cannot catch that. Here a sign-in has to leave
 * the app as a real `POST` and come back before `isSignedIn()` flips.
 */
describe('AuthFacade', () => {
  let facade: AuthFacade;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    facade = TestBed.inject(AuthFacade);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  describe('the surface it presents', () => {
    it('is signed out, idle and error-free before anything happens', () => {
      expect(facade.isSignedIn()).toBeFalse();
      expect(facade.currentUser()).toBeNull();
      expect(facade.isBusy()).toBeFalse();
      expect(facade.errorMessage()).toBeNull();
    });

    /**
     * The point of the pattern, as an assertion. Every name here is a member of
     * `AuthStore` that a component holding the store could reach, and three of them
     * are the session's credentials.
     */
    it('does not expose tokens or the session lifecycle', () => {
      const surface = facade as unknown as Record<string, unknown>;

      const leaked = [
        'accessToken',
        'refreshToken',
        'updateTokens',
        'refreshAccessToken',
        'restoreSession',
        'loadFromStorage',
        'loadCurrentUser',
      ].filter((member) => member in surface);

      expect(leaked).toEqual([]);
    });

    /**
     * `store.login` is an `rxMethod`: it accepts an `Observable<T>` and hands back a
     * subscription. Neither reaches a caller of `signIn`.
     */
    it('takes a plain value and returns nothing', () => {
      expect(facade.signIn({ email: 'test@example.com', password: 'password' })).toBeUndefined();

      httpTesting.expectOne(`${API}/login`).flush(authResponse);
    });
  });

  describe('signIn', () => {
    it('posts the credentials and reports the request as busy while it is open', () => {
      facade.signIn({ email: 'test@example.com', password: 'password' });

      const req = httpTesting.expectOne(`${API}/login`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'test@example.com', password: 'password' });
      expect(facade.isBusy()).toBeTrue();

      req.flush(authResponse);

      expect(facade.isBusy()).toBeFalse();
    });

    it('publishes the user through the facade once the response lands', () => {
      facade.signIn({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(authResponse);

      expect(facade.isSignedIn()).toBeTrue();
      expect(facade.currentUser()).toEqual(authResponse.user);
    });

    it('surfaces the server message on a rejected sign-in', () => {
      facade.signIn({ email: 'test@example.com', password: 'wrong' });
      httpTesting
        .expectOne(`${API}/login`)
        .flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

      expect(facade.errorMessage()).toBe('Invalid credentials');
      expect(facade.isSignedIn()).toBeFalse();
      expect(facade.isBusy()).toBeFalse();
    });
  });

  describe('signUp', () => {
    it('posts to the register endpoint and signs the new user in', () => {
      facade.signUp({ email: 'new@example.com', password: 'password', name: 'New User' });

      const req = httpTesting.expectOne(`${API}/register`);
      expect(req.request.body).toEqual({
        email: 'new@example.com',
        password: 'password',
        name: 'New User',
      });

      req.flush(authResponse);

      expect(facade.isSignedIn()).toBeTrue();
    });
  });

  describe('signOut', () => {
    it('ends the session', () => {
      facade.signIn({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(authResponse);

      facade.signOut();

      expect(facade.isSignedIn()).toBeFalse();
      expect(facade.currentUser()).toBeNull();
    });
  });

  describe('dismissError', () => {
    it('clears the message without touching the rest of the state', () => {
      facade.signIn({ email: 'test@example.com', password: 'wrong' });
      httpTesting
        .expectOne(`${API}/login`)
        .flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

      facade.dismissError();

      expect(facade.errorMessage()).toBeNull();
      expect(facade.isSignedIn()).toBeFalse();
    });
  });

  describe('the store behind it', () => {
    /**
     * The facade passes the store's own signals through rather than copying them, so a
     * write made anywhere — here, the interceptor's token rotation stands in for it — is
     * visible to a component reading the facade, with no plumbing in between.
     */
    it('reads the same reactive nodes the store writes', () => {
      const store = TestBed.inject(AuthStore);

      expect(facade.currentUser()).toBe(store.currentUser());

      facade.signIn({ email: 'test@example.com', password: 'password' });
      httpTesting.expectOne(`${API}/login`).flush(authResponse);

      expect(facade.currentUser()).toBe(store.currentUser());
      expect(facade.isSignedIn()).toBe(store.isAuthenticated());
    });
  });
});
