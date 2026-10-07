import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import type {
  AccessTokenResponse,
  AuthResponse,
  LoginCredentials,
  RegisterCredentials,
  User,
} from './auth.models';

/**
 * The four calls that move the refresh cookie, and the one that does not.
 *
 * `withCredentials: true` is what makes a cookie cross the origin boundary in both
 * directions: without it `XMLHttpRequest`/`fetch` neither stores a `Set-Cookie` from the
 * API nor sends one back, so the entire scheme in `docs/token-storage.md` silently
 * degrades to "sign-in works, reload signs you out" — a bug with no error attached to it,
 * which is why each flag below is written out rather than applied by a helper.
 *
 * `getProfile` deliberately does *not* carry it. It is authorised by the bearer token in
 * the `Authorization` header `jwtInterceptor` attaches, and the refresh cookie is scoped
 * to the auth path (`Path=/api/v1/auth`), so sending credentials here would widen the
 * request's reach for nothing. Least privilege, one request at a time.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/auth`;

  /** Signs in and, in the same response, asks the browser to store the refresh cookie. */
  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/login`, credentials, {
      withCredentials: true,
    });
  }

  register(credentials: RegisterCredentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/register`, credentials, {
      withCredentials: true,
    });
  }

  /**
   * Trades the refresh cookie for a new access token.
   *
   * No argument and an empty body: the credential is the cookie the browser attaches,
   * which this application cannot read and therefore cannot pass. That is the whole
   * difference from the version this replaced, which took the refresh token as a string
   * — and a string a caller can pass is a string a caller can store.
   */
  refresh(): Observable<AccessTokenResponse> {
    return this.http.post<AccessTokenResponse>(
      `${this.baseUrl}/refresh`,
      {},
      { withCredentials: true }
    );
  }

  getProfile(): Observable<User> {
    return this.http.get<User>(`${this.baseUrl}/me`);
  }

  /**
   * Revokes the session server-side and asks for the refresh cookie to be expired.
   *
   * The request is not a courtesy. An `HttpOnly` cookie can only be cleared by a
   * `Set-Cookie` on a response, so without this call a "sign out" that only drops
   * client-side state leaves a live refresh cookie in the jar — and the next page load
   * signs the user straight back in.
   */
  logout(): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/logout`, {}, { withCredentials: true });
  }
}
