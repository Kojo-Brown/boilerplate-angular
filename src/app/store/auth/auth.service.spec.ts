import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { environment } from '@/environments/environment';
import { createMockUser } from '@/testing';
import type { AuthResponse, AuthTokens } from './auth.models';

describe('AuthService', () => {
  const base = `${environment.apiUrl}/auth`;
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  const tokens: AuthTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  };

  it('login() POSTs credentials and returns the auth response', () => {
    const credentials = { email: 'user@example.com', password: 'Password1' };
    const response: AuthResponse = { ...tokens, user: createMockUser() };
    let received: AuthResponse | undefined;

    service.login(credentials).subscribe((res) => (received = res));

    const req = httpMock.expectOne(`${base}/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(credentials);
    req.flush(response);

    expect(received).toEqual(response);
  });

  it('register() POSTs credentials and returns the auth response', () => {
    const credentials = {
      name: 'Jane Smith',
      email: 'jane@example.com',
      password: 'Password1',
    };
    const response: AuthResponse = { ...tokens, user: createMockUser({ name: 'Jane Smith' }) };
    let received: AuthResponse | undefined;

    service.register(credentials).subscribe((res) => (received = res));

    const req = httpMock.expectOne(`${base}/register`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(credentials);
    req.flush(response);

    expect(received).toEqual(response);
  });

  it('refreshToken() POSTs the refresh token and returns a new token pair', () => {
    let received: AuthTokens | undefined;

    service.refreshToken('mock-refresh-token').subscribe((res) => (received = res));

    const req = httpMock.expectOne(`${base}/refresh`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ refreshToken: 'mock-refresh-token' });
    req.flush(tokens);

    expect(received).toEqual(tokens);
  });

  it('getProfile() GETs the current user', () => {
    const user = createMockUser({ email: 'me@example.com' });

    service.getProfile().subscribe((res) => expect(res).toEqual(user));

    const req = httpMock.expectOne(`${base}/me`);
    expect(req.request.method).toBe('GET');
    req.flush(user);
  });

  it('logout() POSTs the refresh token so the server can revoke it', () => {
    service.logout('mock-refresh-token').subscribe();

    const req = httpMock.expectOne(`${base}/logout`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ refreshToken: 'mock-refresh-token' });
    req.flush(null);
  });
});
