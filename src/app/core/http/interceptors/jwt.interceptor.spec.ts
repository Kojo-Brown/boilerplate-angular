import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { jwtInterceptor } from './jwt.interceptor';
import { AuthStore } from '@/app/store/auth/auth.store';
import { AuthService } from '@/app/store/auth/auth.service';

const ACCESS_TOKEN = 'test-access-token';
const REFRESH_TOKEN = 'test-refresh-token';
const NEW_ACCESS_TOKEN = 'new-access-token';
const NEW_REFRESH_TOKEN = 'new-refresh-token';

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let authStoreSpy: {
    accessToken: jasmine.Spy;
    refreshToken: jasmine.Spy;
    logout: jasmine.Spy;
    updateTokens: jasmine.Spy;
  };
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    authStoreSpy = {
      accessToken: jasmine.createSpy('accessToken').and.returnValue(ACCESS_TOKEN),
      refreshToken: jasmine.createSpy('refreshToken').and.returnValue(REFRESH_TOKEN),
      logout: jasmine.createSpy('logout'),
      updateTokens: jasmine.createSpy('updateTokens'),
    };

    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', [
      'refreshToken',
      'login',
      'register',
      'logout',
      'getProfile',
    ]);
    authServiceSpy.refreshToken.and.returnValue(
      of({ accessToken: NEW_ACCESS_TOKEN, refreshToken: NEW_REFRESH_TOKEN })
    );

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: authStoreSpy },
        { provide: AuthService, useValue: authServiceSpy },
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

      expect(authServiceSpy.refreshToken).toHaveBeenCalledWith(REFRESH_TOKEN);
      expect(authStoreSpy.updateTokens).toHaveBeenCalledWith({
        accessToken: NEW_ACCESS_TOKEN,
        refreshToken: NEW_REFRESH_TOKEN,
      });
      expect(result).toEqual({ ok: true });
    });

    it('calls logout and emits error when no refresh token is present', () => {
      authStoreSpy.refreshToken.and.returnValue(null);

      let errorEmitted = false;
      http.get('/api/data').subscribe({ error: () => (errorEmitted = true) });

      const req = controller.expectOne('/api/data');
      req.flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(authStoreSpy.logout).toHaveBeenCalled();
      expect(errorEmitted).toBeTrue();
    });

    it('calls logout and emits error when refresh request fails', () => {
      authServiceSpy.refreshToken.and.returnValue(throwError(() => new Error('Refresh failed')));

      let errorEmitted = false;
      http.get('/api/data').subscribe({ error: () => (errorEmitted = true) });

      const req = controller.expectOne('/api/data');
      req.flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(authStoreSpy.logout).toHaveBeenCalled();
      expect(errorEmitted).toBeTrue();
    });

    it('passes through non-401 errors unchanged', () => {
      let caughtStatus: number | undefined;
      http.get('/api/data').subscribe({
        error: (err: { status: number }) => (caughtStatus = err.status),
      });

      const req = controller.expectOne('/api/data');
      req.flush(null, { status: 403, statusText: 'Forbidden' });

      expect(caughtStatus).toBe(403);
      expect(authServiceSpy.refreshToken).not.toHaveBeenCalled();
    });
  });
});
