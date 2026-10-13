import {
  HttpXsrfTokenExtractor,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { switchMap } from 'rxjs';
import { CSRF_CONTRACT, isCsrfSafeMethod } from '../csrf';
import { CsrfBootstrap } from '../csrf-bootstrap';

/**
 * Echoes the CSRF cookie back in a header on every mutating request to this API.
 *
 * ## Why this exists when Angular has `withXsrfConfiguration`
 *
 * Because Angular's built-in interceptor declines to act on a cross-origin request, and
 * this application's API *is* cross-origin. The check is not a heuristic — it is explicit
 * in `@angular/common/http`, which resolves the request URL against `PlatformLocation`
 * and returns early when the origins differ:
 *
 * ```js
 * const { origin: locationOrigin } = new URL(inject(PlatformLocation).href);
 * const { origin: requestOrigin } = new URL(req.url, locationOrigin);
 * if (locationOrigin !== requestOrigin) {
 *   return next(req);          // no header, no warning, no way to opt in
 * }
 * ```
 *
 * `environment.apiUrl` is `http://localhost:3000/api/v1` and the application is served
 * from port 4200 or 4000, so *every* mutating request takes that early return. This is
 * the failure mode worth naming: configuring `withXsrfConfiguration({ cookieName,
 * headerName })` reads, in a diff and in a review, exactly like a deployed CSRF defence.
 * It would be a cookie name, a header name, a documented contract — and not one request
 * carrying a token. The application works perfectly either way, because the protection is
 * only ever visible in what the *server* rejects, and a server given no token to compare
 * against by a client it believes is protected has no reason to complain.
 *
 * Angular is right to refuse, which is why this does not simply widen it. A token sent to
 * an arbitrary origin is a token handed to whoever is on the other end, and a CSRF token
 * echoed to a third party is a CSRF defence turned into a credential leak. So the scope
 * is declared once, in `app.config.ts`, by the same `requestsUnder(environment.apiUrl)`
 * predicate that scopes caching and retries — this interceptor is never offered a request
 * to anywhere else, and `scripts/ci/assert-csrf.mjs` fails if that scoping is removed.
 *
 * `withXsrfConfiguration` is still configured there, and still earns its place: it is
 * what points {@link HttpXsrfTokenExtractor} — Angular's cookie reader, which this uses
 * rather than reimplementing — at {@link CSRF_CONTRACT.cookieName}, and it keeps the
 * built-in protection correct for a same-origin deployment, where both interceptors run
 * and neither overwrites the other's header.
 *
 * ## Position
 *
 * Beneath `jwtInterceptor`, for a reason the ordering comment in `app.config.ts` repeats:
 * the two endpoints that actually need this — `POST /auth/refresh` and `POST /auth/logout`
 * — are on `jwtInterceptor`'s bypass list, so an interceptor above it would see them
 * pass by and never be asked about them. Below it, scoped by URL instead of by
 * credential, they are ordinary mutating requests like any other.
 *
 * Above `retryInterceptor`, so a replayed attempt carries the header the first one did.
 * That costs nothing today — `DEFAULT_RETRY_POLICY` retries `GET`, `HEAD` and `OPTIONS`
 * only, which is to say exactly the methods this exempts — and it is the right way round
 * if a policy ever admits an idempotent `PUT`.
 */
export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  // A safe method changes nothing, so a token on it proves nothing. Checked before
  // anything is injected, because this is most requests.
  if (isCsrfSafeMethod(req.method)) {
    return next(req);
  }

  // Server-side rendering has no visitor to hold a cookie: `DOCUMENT` there is one DOM
  // shared by every request, so there is no jar to read and nothing a bootstrap could
  // store. Angular's extractor comes to the same conclusion on its own — `getToken()`
  // returns `null` under `ngServerMode` — but relying on that would mean the *bootstrap*
  // below still fired, turning every server render of a page that mutates into a
  // credentialed request on behalf of nobody.
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return next(req);
  }

  const extractor = inject(HttpXsrfTokenExtractor);
  const bootstrap = inject(CsrfBootstrap);

  const token = extractor.getToken();
  if (token !== null) {
    return next(withCsrfToken(req, token));
  }

  // No cookie yet — the first mutation of a session that has never had a response from
  // the API. Get one, then read the jar again rather than trusting the bootstrap to
  // have produced anything: `ensureToken` completes whatever happened, and a request
  // with no header is still sent, for the server to reject or not.
  return bootstrap
    .ensureToken()
    .pipe(switchMap(() => next(withCsrfToken(req, extractor.getToken()))));
};

/**
 * The request as it should go out: the token in the header, and credentials on, so the
 * cookie the token came from travels with it.
 *
 * `withCredentials` is set here and not in the services, and only alongside a token,
 * because it is this header's requirement rather than the call site's: the server
 * compares the header against the *cookie*, so a request carrying one and not the other
 * is rejected. It is also the narrowest widening available — the refresh cookie is scoped
 * `Path=/api/v1/auth` and so is unaffected outside it, which leaves `session_hint`, a
 * non-secret marker, as the only other cookie that starts travelling. `docs/csrf.md`
 * records that trade and the CORS headers it obliges the API to send.
 *
 * An existing header of the same name is left alone, and so is the rest of the request:
 * a call site that set the header itself has taken ownership of this contract, including
 * the credentials half, and a clone that half-adopted it would be worse than either.
 * Angular's own interceptor makes the same call.
 */
function withCsrfToken<T>(req: HttpRequest<T>, token: string | null): HttpRequest<T> {
  if (token === null || req.headers.has(CSRF_CONTRACT.headerName)) {
    return req;
  }

  return req.clone({
    setHeaders: { [CSRF_CONTRACT.headerName]: token },
    withCredentials: true,
  });
}
