import { InjectionToken, inject } from '@angular/core';
import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthStore } from '@/app/store/auth/auth.store';
import { AuthService } from '@/app/store/auth/auth.service';
import { SESSION_HINT } from '@/app/store/auth/session-hint';

/**
 * URL fragments that must never carry an `Authorization` header, and whose 401 means
 * "these credentials are wrong", not "this token expired".
 *
 * A token rather than a module constant, because the list is a property of the API an
 * application talks to, not of the interceptor: an app with a `/auth/magic-link`
 * endpoint should be able to say so from its own `providers`, without editing — or
 * forking — the interceptor. That is the whole of the open/closed principle here; see
 * [`docs/solid.md`](../../../../../docs/solid.md).
 *
 * `/auth/refresh` being on this list is also what keeps the refresh below from
 * recursing: its own 401 is an error to report, never a reason to refresh again.
 */
export const AUTH_BYPASS_PATHS = new InjectionToken<readonly string[]>('AUTH_BYPASS_PATHS', {
  providedIn: 'root',
  factory: () => ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'],
});

let isRefreshing = false;
const refreshTokenSubject = new BehaviorSubject<string | null>(null);

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const authStore = inject(AuthStore);
  const authService = inject(AuthService);
  const hint = inject(SESSION_HINT);
  const bypassPaths = inject(AUTH_BYPASS_PATHS);

  if (bypassPaths.some((path) => req.url.includes(path))) {
    return next(req);
  }

  const token = authStore.accessToken();
  return next(withBearerToken(req, token)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
        return throwError(() => err);
      }

      if (!isRefreshing) {
        // Whether a refresh is even possible is no longer something this code can
        // read: the refresh token is an `HttpOnly` cookie, so "is there one" is a
        // question only the server answers. What *can* be ruled out cheaply is a 401
        // belonging to a visitor who was never signed in — no access token in memory
        // and no session hint — where a refresh attempt would be a second request
        // guaranteed to fail. Everything else goes to the server.
        if (token === null && !hint.exists()) {
          return throwError(() => err);
        }

        isRefreshing = true;
        refreshTokenSubject.next(null);

        return authService.refresh().pipe(
          switchMap(({ accessToken }) => {
            isRefreshing = false;
            authStore.updateAccessToken(accessToken);
            refreshTokenSubject.next(accessToken);
            return next(withBearerToken(req, accessToken));
          }),
          catchError((refreshErr: unknown) => {
            isRefreshing = false;
            refreshTokenSubject.next(null);
            // `clearSession`, not `logout`: the server has just rejected the refresh
            // cookie, so asking it to revoke the same credential would be a wasted
            // request. Nothing is left to revoke — only local state to drop.
            authStore.clearSession();
            return throwError(() => refreshErr);
          })
        );
      }

      return refreshTokenSubject.pipe(
        filter((token): token is string => token !== null),
        take(1),
        switchMap((token) => next(withBearerToken(req, token)))
      );
    })
  );
};

function withBearerToken<T>(req: HttpRequest<T>, token: string | null): HttpRequest<T> {
  if (!token) return req;
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
