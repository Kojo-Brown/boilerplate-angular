import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { AUTH_BYPASS_PATHS, jwtInterceptor } from './jwt.interceptor';
import { AuthStore } from '@/app/store/auth/auth.store';
import { AuthService } from '@/app/store/auth/auth.service';
import { SESSION_HINT, type SessionHint } from '@/app/store/auth/session-hint';

const ACCESS_TOKEN = 'test-access-token';
const NEW_ACCESS_TOKEN = 'new-access-token';

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let authStoreSpy: {
    accessToken: jasmine.Spy;
    clearSession: jasmine.Spy;
    updateAccessToken: jasmine.Spy;
  };
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let hint: SessionHint;

  beforeEach(() => {
    authStoreSpy = {
      accessToken: jasmine.createSpy('accessToken').and.returnValue(ACCESS_TOKEN),
      clearSession: jasmine.createSpy('clearSession'),
      updateAccessToken: jasmine.createSpy('updateAccessToken'),
    };

    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', [
      'refresh',
      'login',
      'register',
      'logout',
      'getProfile',
    ]);
    authServiceSpy.refresh.and.returnValue(of({ accessToken: NEW_ACCESS_TOKEN }));
    hint = { exists: () => true, forget: () => undefined };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: authStoreSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: SESSION_HINT, useValue: hint },
      ],
    });

    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
  });

  describe('Bearer token attachment', () => {
    it('attaches Authorization header to protected requests', () => {
      http.get('/api/data').subscribe();

      const req = controller.expectOne('/api/data');
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      req.flush({});
    });

    it('sends no Authorization header when access token is null', () => {
      authStoreSpy.accessToken.and.returnValue(null);

      http.get('/api/data').subscribe();

      const req = controller.expectOne('/api/data');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });
  });

  describe('auth bypass paths', () => {
    it('skips token for /auth/login', () => {
      http.post('/api/auth/login', {}).subscribe();

      const req = controller.expectOne('/api/auth/login');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });

    it('skips token for /auth/register', () => {
      http.post('/api/auth/register', {}).subscribe();

      const req = controller.expectOne('/api/auth/register');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });

    it('skips token for /auth/refresh', () => {
      http.post('/api/auth/refresh', {}).subscribe();

      const req = controller.expectOne('/api/auth/refresh');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });

    it('skips token for /auth/logout', () => {
      http.post('/api/auth/logout', {}).subscribe();

      const req = controller.expectOne('/api/auth/logout');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });
  });

  describe('401 handling', () => {
    it('retries request with new token after successful refresh', () => {
      let result: unknown;
      http.get('/api/data').subscribe({ next: (r) => (result = r) });

      const firstReq = controller.expectOne('/api/data');
      expect(firstReq.request.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      firstReq.flush(null, { status: 401, statusText: 'Unauthorized' });

      const retryReq = controller.expectOne('/api/data');
      expect(retryReq.request.headers.get('Authorization')).toBe(`Bearer ${NEW_ACCESS_TOKEN}`);
      retryReq.flush({ ok: true });

      // No argument: the interceptor has no refresh token to pass, because there is no
      // refresh token on the client. The credential travels as the `HttpOnly` cookie
      // `AuthService.refresh` sends with `withCredentials`.
      expect(authServiceSpy.refresh).toHaveBeenCalledWith();
      expect(authStoreSpy.updateAccessToken).toHaveBeenCalledWith(NEW_ACCESS_TOKEN);
      expect(result).toEqual({ ok: true });
    });

    /**
     * `clearSession`, not `logout`. The server has just rejected the refresh cookie, so
     * a `POST /auth/logout` asking it to revoke the same credential is a request with
     * nothing left to do — and one more failure to handle on a path that is already
     * failing.
     */
    it('clears the session and emits error when the refresh is rejected', () => {
      authServiceSpy.refresh.and.returnValue(throwError(() => new Error('Refresh failed')));

      let errorEmitted = false;
      http.get('/api/data').subscribe({ error: () => (errorEmitted = true) });

      const req = controller.expectOne('/api/data');
      req.flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(authStoreSpy.clearSession).toHaveBeenCalled();
      expect(authServiceSpy.logout).not.toHaveBeenCalled();
      expect(errorEmitted).toBeTrue();
    });

    /**
     * Whether a refresh cookie exists is not readable from here, so the 401 of a visitor
     * who was never signed in cannot be told apart by inspecting a token — except in the
     * one case where both halves of the evidence are absent. Refreshing there would be a
     * second request guaranteed to fail.
     */
    it('does not attempt a refresh for a visitor with neither a token nor a hint', () => {
      authStoreSpy.accessToken.and.returnValue(null);
      hint.exists = (): boolean => false;

      let errorEmitted = false;
      http.get('/api/data').subscribe({ error: () => (errorEmitted = true) });

      controller.expectOne('/api/data').flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(authServiceSpy.refresh).not.toHaveBeenCalled();
      expect(errorEmitted).toBeTrue();
    });

    /**
     * The other side of that rule: a reload has lost the in-memory access token while
     * the refresh cookie is still live, so a hint with no token must still refresh.
     */
    it('attempts a refresh when the token is gone but the hint remains', () => {
      authStoreSpy.accessToken.and.returnValue(null);

      http.get('/api/data').subscribe();

      controller.expectOne('/api/data').flush(null, { status: 401, statusText: 'Unauthorized' });

      const retry = controller.expectOne('/api/data');
      expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${NEW_ACCESS_TOKEN}`);
      retry.flush({ ok: true });

      expect(authServiceSpy.refresh).toHaveBeenCalled();
    });

    it('passes through non-401 errors unchanged', () => {
      let caughtStatus: number | undefined;
      http.get('/api/data').subscribe({
        error: (err: { status: number }) => (caughtStatus = err.status),
      });

      const req = controller.expectOne('/api/data');
      req.flush(null, { status: 403, statusText: 'Forbidden' });

      expect(caughtStatus).toBe(403);
      expect(authServiceSpy.refresh).not.toHaveBeenCalled();
    });
  });
});

describe('AUTH_BYPASS_PATHS', () => {
  /**
   * The open/closed claim, exercised: an application adds an unauthenticated endpoint by
   * providing a different list, and the interceptor is not touched.
   */
  it('lets an application extend the unauthenticated endpoints', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: { accessToken: (): string => ACCESS_TOKEN },
        },
        { provide: AuthService, useValue: {} },
        { provide: SESSION_HINT, useValue: { exists: () => false, forget: () => undefined } },
        { provide: AUTH_BYPASS_PATHS, useValue: ['/auth/magic-link'] },
      ],
    });

    const http = TestBed.inject(HttpClient);
    const controller = TestBed.inject(HttpTestingController);

    http.post('/api/auth/magic-link', {}).subscribe();
    expect(controller.expectOne('/api/auth/magic-link').request.headers.has('Authorization'))
      .withContext('the newly declared bypass path')
      .toBeFalse();

    // And the defaults are genuinely replaced, not merged — this one is signed again.
    http.post('/api/auth/login', {}).subscribe();
    expect(controller.expectOne('/api/auth/login').request.headers.get('Authorization'))
      .withContext('a default path, no longer in the provided list')
      .toBe(`Bearer ${ACCESS_TOKEN}`);

    controller.verify();
  });
});
