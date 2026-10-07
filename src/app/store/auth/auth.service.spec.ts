import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { environment } from '@/environments/environment';
import { createMockUser } from '@/testing';
import type { AccessTokenResponse, AuthResponse } from './auth.models';

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

  const tokens: AccessTokenResponse = { accessToken: 'mock-access-token' };

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

  /**
   * The flag with no failure mode of its own. Without `withCredentials` the browser
   * discards the `Set-Cookie` on a cross-origin response and never sends the cookie
   * back: sign-in still works, nothing errors, and every reload signs the user out. So
   * each call that carries the refresh cookie is asserted individually, and `getProfile`
   * is asserted *not* to — it is authorised by the bearer header, and the cookie is
   * scoped to the auth path.
   */
  it('sends the refresh cookie with every call that moves it, and with nothing else', () => {
    service.login({ email: 'user@example.com', password: 'Password1' }).subscribe();
    expect(httpMock.expectOne(`${base}/login`).request.withCredentials)
      .withContext('login stores the refresh cookie')
      .toBeTrue();

    service.register({ name: 'N', email: 'n@example.com', password: 'Password1' }).subscribe();
    expect(httpMock.expectOne(`${base}/register`).request.withCredentials)
      .withContext('register stores the refresh cookie')
      .toBeTrue();

    service.refresh().subscribe();
    expect(httpMock.expectOne(`${base}/refresh`).request.withCredentials)
      .withContext('refresh is authorised by the cookie alone')
      .toBeTrue();

    service.logout().subscribe();
    expect(httpMock.expectOne(`${base}/logout`).request.withCredentials)
      .withContext('logout asks for the cookie to be expired')
      .toBeTrue();

    service.getProfile().subscribe();
    expect(httpMock.expectOne(`${base}/me`).request.withCredentials)
      .withContext('the profile is authorised by the bearer token, not the cookie')
      .toBeFalse();

    httpMock.match(() => true).forEach((req) => req.flush(null));
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

  /**
   * The body is empty, and that is the assertion. A refresh token in a request body is a
   * refresh token some caller had to be holding; the credential here is the cookie the
   * browser attaches, which this code cannot read and so cannot send.
   */
  it('refresh() POSTs no credential and returns a new access token', () => {
    let received: AccessTokenResponse | undefined;

    service.refresh().subscribe((res) => (received = res));

    const req = httpMock.expectOne(`${base}/refresh`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    expect(JSON.stringify(req.request.body)).not.toContain('refresh');
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

  /**
   * No argument either: the server identifies the session from the cookie it is being
   * asked to expire. `Set-Cookie` is the only way to clear an `HttpOnly` cookie, which
   * is why signing out is a request at all rather than a local state change.
   */
  it('logout() POSTs no credential so the server can revoke the cookie it receives', () => {
    service.logout().subscribe();

    const req = httpMock.expectOne(`${base}/logout`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null);
  });
});
