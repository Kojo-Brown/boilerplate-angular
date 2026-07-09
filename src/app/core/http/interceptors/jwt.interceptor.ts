import { inject } from '@angular/core';
import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthStore } from '@/app/store/auth/auth.store';
import { AuthService } from '@/app/store/auth/auth.service';

const AUTH_BYPASS_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

let isRefreshing = false;
const refreshTokenSubject = new BehaviorSubject<string | null>(null);

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const authStore = inject(AuthStore);
  const authService = inject(AuthService);

  if (isAuthBypassPath(req.url)) {
    return next(req);
  }

  const token = authStore.accessToken();
  return next(withBearerToken(req, token)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
        return throwError(() => err);
      }

      if (!isRefreshing) {
        isRefreshing = true;
        refreshTokenSubject.next(null);

        const storedRefreshToken = authStore.refreshToken();
        if (!storedRefreshToken) {
          isRefreshing = false;
          authStore.logout();
          return throwError(() => err);
        }

        return authService.refreshToken(storedRefreshToken).pipe(
          switchMap((tokens) => {
            isRefreshing = false;
            authStore.updateTokens(tokens);
            refreshTokenSubject.next(tokens.accessToken);
            return next(withBearerToken(req, tokens.accessToken));
          }),
          catchError((refreshErr: unknown) => {
            isRefreshing = false;
            refreshTokenSubject.next(null);
            authStore.logout();
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

function isAuthBypassPath(url: string): boolean {
  return AUTH_BYPASS_PATHS.some((path) => url.includes(path));
}

function withBearerToken<T>(req: HttpRequest<T>, token: string | null): HttpRequest<T> {
  if (!token) return req;
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
