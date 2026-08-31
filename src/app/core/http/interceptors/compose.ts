import type {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import type { Observable } from 'rxjs';

/**
 * A question asked of a request to decide whether a decorator applies to it.
 */
export type RequestPredicate = (request: HttpRequest<unknown>) => boolean;

/**
 * Folds several `HttpInterceptorFn`s into one, in the same order `withInterceptors`
 * would have applied them: the first argument is outermost and sees the request first,
 * the last is nearest the transport and sees the response first.
 *
 * This is the decorator pattern's composition step. Each interceptor is already a
 * decorator — it receives the handler beneath it and returns a handler — so composing
 * them is a right fold with `next` as the seed. What the fold adds over listing the
 * same functions in `withInterceptors` is that the result is itself an
 * `HttpInterceptorFn`, and so can be passed to {@link interceptWhen}, provided in a
 * lazy route, or exported as one named unit.
 *
 * Every inner interceptor is invoked inside {@link runInInjectionContext}, which is
 * what makes `inject()` legal in all of them and not just the first. Angular's own
 * chain does the same for the same reason: an interceptor that calls `next()` from
 * inside a `switchMap` — `jwtInterceptor`, waiting on a token refresh — resumes on a
 * later microtask, long after the ambient injection context has been torn down, and a
 * naive fold would hand the interceptor beneath it an `NG0203` instead of a request.
 */
export function composeInterceptors(
  ...interceptors: readonly HttpInterceptorFn[]
): HttpInterceptorFn {
  return (req, next) => {
    // Captured here, where the injection context still exists, and closed over by every
    // link in the chain. `EnvironmentInjector` rather than `Injector` because
    // `runInInjectionContext` requires one, and the HTTP chain has no element injector.
    const injector = inject(EnvironmentInjector);

    const chain = interceptors.reduceRight<HttpHandlerFn>(
      (downstream, interceptor) => (request) =>
        runInInjectionContext(injector, () => interceptor(request, downstream)),
      next
    );

    return chain(req);
  };
}

/**
 * Restricts a decorator to the requests `predicate` accepts; everything else passes
 * straight through to the layer beneath.
 *
 * The reason this is a combinator and not an `if` inside each interceptor: "which
 * requests does this apply to?" is a property of the application, and "what does it do
 * to them?" is a property of the decorator. `cacheInterceptor` should not have to know
 * that this application talks to exactly one API, and an application that grows a
 * second one should not have to edit it.
 *
 * `predicate` is called on every request, on the way down, before any decorator inside
 * `interceptor` runs — so a rejected request costs one function call and nothing else.
 */
export function interceptWhen(
  predicate: RequestPredicate,
  interceptor: HttpInterceptorFn
): HttpInterceptorFn {
  return (req, next) => (predicate(req) ? interceptor(req, next) : next(req));
}

/**
 * Accepts requests whose URL is under `baseUrl`.
 *
 * Matches on the URL as written rather than resolving it against `document.baseURI`,
 * because that is what the rest of this codebase produces: `ApiService` builds every
 * path by concatenating `environment.apiUrl`, so a request either starts with it or was
 * not meant for this API.
 */
export function requestsUnder(baseUrl: string): RequestPredicate {
  return (request) => request.url.startsWith(baseUrl);
}

/**
 * Accepts requests whose method is one of `methods` (compared case-insensitively, since
 * `HttpClient.request('get', …)` does not upper-case what it is given).
 */
export function requestsWithMethod(...methods: readonly string[]): RequestPredicate {
  const wanted = methods.map((method) => method.toUpperCase());
  return (request) => wanted.includes(request.method.toUpperCase());
}

/**
 * The identity decorator: hands the request straight on.
 *
 * Useful as the "off" value of a configuration switch, so a caller can write
 * `withInterceptors([featureEnabled ? cacheInterceptor : passThroughInterceptor])`
 * without the array's length depending on configuration.
 */
export const passThroughInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => next(req);
