import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, catchError, finalize, map, of, shareReplay } from 'rxjs';
import { environment } from '@/environments/environment';
import { CSRF_BOOTSTRAP_PATH } from './csrf';

/**
 * Gets this browser a CSRF token when it does not have one, once.
 *
 * ## Why a request is needed at all
 *
 * The token is a cookie the API sets, so a browser that has never had a response from the
 * API has nothing to echo back — and the double-submit comparison the server performs
 * needs both halves. That is not an edge case: the first API request a cold visit to
 * `/login` makes is `POST /auth/login`, which is a mutation, and nothing has preceded it.
 * Without this, a correctly configured API rejects every sign-in attempt and the failure
 * is a 403 on the one request the user cannot get past.
 *
 * It is deliberately *lazy* — triggered by the first mutating request that finds no
 * token, not by an app initializer. An eager version would spend a credentialed round
 * trip on every visitor including the ones who only ever read, which is the same cost
 * `SessionHint` exists to avoid, and would pay it on every page load rather than once per
 * session. A visitor who browses and leaves makes no request from here at all.
 *
 * ## Why it never fails
 *
 * {@link ensureToken} completes successfully whatever the response was, and a caller
 * cannot tell a 503 from a token. That follows from the rule in `csrf.ts`: this
 * application does not refuse to send requests on CSRF grounds, because a check in a
 * client an attacker does not use protects nobody. So a failed bootstrap leaves the
 * mutation to go out unprotected and the server to reject it — a 403 from the endpoint
 * the user was actually trying to reach, which is both the honest answer and the one with
 * a server-side log behind it. The failure is not swallowed silently either: the request
 * goes through the application's own interceptor chain, so `loggingInterceptor` prints it
 * in development and `telemetryInterceptor` counts it.
 */
@Injectable({ providedIn: 'root' })
export class CsrfBootstrap {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}${CSRF_BOOTSTRAP_PATH}`;

  /**
   * The request currently in flight, shared by every caller waiting on it.
   *
   * Two mutations dispatched in the same tick by a page with no token must not each
   * fetch one — the second would race the first's `Set-Cookie` and could read a value
   * the server has already replaced. Same shape as the refresh queue in
   * `jwtInterceptor`, and for the same reason.
   */
  private inFlight: Observable<void> | null = null;

  /**
   * Resolves once this browser has had its chance to be given a token.
   *
   * "Had its chance", not "has one": the caller re-reads the cookie afterwards and acts
   * on whatever is there, because an API that answered without a `Set-Cookie` — or set
   * one on a domain this document cannot read — leaves nothing to find and no error to
   * report.
   */
  ensureToken(): Observable<void> {
    this.inFlight ??= this.fetchToken();
    return this.inFlight;
  }

  private fetchToken(): Observable<void> {
    return this.http
      .get(this.url, {
        // Without this the browser drops the `Set-Cookie` on a cross-origin response and
        // the request accomplishes nothing at all — no error, no cookie, and a mutation
        // that goes out unprotected on every attempt. `environment.apiUrl` is a different
        // origin in the checked-in configuration, so this is the normal case rather than
        // the exotic one.
        withCredentials: true,
        // The body is not read, and asking for JSON is how an empty `204` or a
        // `text/plain` acknowledgement turns into a parse error on a response that was
        // entirely successful. The cookie is the payload.
        responseType: 'text',
      })
      .pipe(
        map(() => undefined),
        catchError(() => of(undefined)),
        // Clears the slot so a later mutation can try again — after an outage, or once
        // the cookie has expired. It runs on success too: by then the cookie is set, so
        // the next mutation reads it and never reaches this class.
        finalize(() => {
          this.inFlight = null;
        }),
        // `refCount: false` so the request is not cancelled and re-issued when the first
        // waiter unsubscribes before a second one arrives.
        shareReplay({ bufferSize: 1, refCount: false })
      );
  }
}
