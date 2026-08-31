import { HttpContextToken } from '@angular/common/http';
import { InjectionToken } from '@angular/core';

/**
 * What the cache decorator did with a request.
 *
 * `bypass` and `miss` are deliberately different: `bypass` means the request was never
 * a candidate (a `POST`, a progress-reporting download, an explicit opt-out), `miss`
 * means it was one and the cache had nothing. A cache whose hit rate is 0% because
 * nothing is cacheable is a different problem from one that is 0% because everything
 * expires first, and telemetry that collapsed the two could not tell them apart.
 */
export type CacheOutcome = 'hit' | 'dedup' | 'miss' | 'bypass';

/**
 * The scratch space the decorators use to tell each other what they did.
 *
 * A decorator only ever sees the layer directly beneath it, so `retryInterceptor` has no
 * way to *return* "that took three attempts" to `telemetryInterceptor` sitting four
 * layers above — the response it hands back is the same `HttpResponse` a first-attempt
 * success would have produced. The `HttpContext` is the one thing every layer shares:
 * `HttpRequest.clone()` passes the context through by reference, so the object an
 * interceptor mutates on the way down is the object another one reads on the way back.
 *
 * Mutable on purpose. Every alternative — re-cloning the request with a new context
 * value, or an injectable per-request scope — either loses writes made after the
 * downstream call was issued or needs a request-scoped injector Angular's HTTP stack
 * does not have.
 */
export interface RequestTrace {
  /** Retries `retryInterceptor` performed. `0` on a request that succeeded first time. */
  retries: number;

  /** What `cacheInterceptor` did. `bypass` until that decorator has looked at it. */
  cache: CacheOutcome;
}

/**
 * Per-request observations, shared by every decorator in the chain.
 *
 * `HttpContext.get` memoises the factory's result against the token, so the first
 * decorator to ask creates the object and every later `get` — including on a clone —
 * returns that same instance.
 */
export const REQUEST_TRACE = new HttpContextToken<RequestTrace>(() => ({
  retries: 0,
  cache: 'bypass',
}));

/**
 * Milliseconds, from whatever source the application considers authoritative.
 *
 * One clock rather than a monotonic one for durations and a wall clock for expiry,
 * because `Retry-After`'s HTTP-date form is only meaningful against wall time and a
 * decorator cannot ask for "the other clock". `Date.now` is therefore the default and
 * duration measurement inherits its one weakness: an NTP step mid-request skews that
 * request's `durationMs`. Provide `() => performance.now()` instead if durations matter
 * more than `Retry-After` dates — `retryDelayMs` takes its `now` as an argument, so the
 * two are separable.
 */
export const HTTP_CLOCK = new InjectionToken<() => number>('HTTP_CLOCK', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});
