import { HttpContextToken, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';
import { retry, throwError, timer } from 'rxjs';
import { REQUEST_TRACE } from './request-trace';

/**
 * When a failed request is worth sending again, and how long to wait first.
 */
export interface RetryPolicy {
  /** Attempts after the first. `0` disables the decorator for the request. */
  readonly maxRetries: number;

  /** Delay before the first retry. Each subsequent one doubles it. */
  readonly baseDelayMs: number;

  /** Ceiling on any single wait, including one a `Retry-After` header asked for. */
  readonly maxDelayMs: number;

  /** Methods that may be retried, upper-cased. */
  readonly methods: readonly string[];

  /** Statuses that may be retried. */
  readonly statuses: readonly number[];

  /**
   * Spreads the computed backoff over a window so that clients failed by one outage do
   * not return in lockstep and fail the recovering server again.
   *
   * A policy field rather than a call to `Math.random()` inside the interceptor, so a
   * spec can substitute the identity function and assert on exact delays — the same
   * reason `TOAST_SCHEDULER` and `TOAST_ID_FACTORY` exist.
   */
  readonly jitter: (delayMs: number) => number;
}

/**
 * "Full jitter" from AWS's exponential-backoff-and-jitter study: a uniform draw from
 * `[0, delay]` rather than `delay ± something`. It converges faster than the variants
 * that keep a floor, because the early retries of a thundering herd get spread across
 * the whole window instead of the top half of it.
 */
export function fullJitter(delayMs: number): number {
  return Math.random() * delayMs;
}

/**
 * The default policy: idempotent methods only, and only for failures that plausibly
 * differ on a second attempt.
 *
 * `POST` and `PATCH` are absent by design. A request that timed out may well have been
 * received and applied, so retrying it risks a duplicate write — this codebase has no
 * idempotency-key mechanism to make that safe, and adding methods here without one is
 * how a retry decorator becomes a double-charge bug. `PUT` and `DELETE` are idempotent
 * by HTTP's definition but are left out too, because that guarantee is the server's to
 * keep and not every implementation does.
 *
 * `0` covers DNS, TLS, CORS preflight and an offline device; `408`/`425`/`429` are the
 * server asking for another attempt; `500`/`502`/`503`/`504` are the failures a healthy
 * cluster resolves by routing the next attempt elsewhere. `501` and the 4xx range are
 * excluded: they describe the request, and the request will not have changed.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 300,
  maxDelayMs: 5_000,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  statuses: [0, 408, 425, 429, 500, 502, 503, 504],
  jitter: fullJitter,
};

/** The policy `retryInterceptor` applies to a request that carries no override. */
export const RETRY_POLICY = new InjectionToken<RetryPolicy>('RETRY_POLICY', {
  providedIn: 'root',
  factory: () => DEFAULT_RETRY_POLICY,
});

/**
 * A per-request patch over {@link RETRY_POLICY}, for the call site that knows something
 * the application-wide policy cannot.
 *
 * ```ts
 * // A search-as-you-type request: superseded within the second, so never worth resending.
 * http.get(url, { context: new HttpContext().set(RETRY_OVERRIDE, { maxRetries: 0 }) });
 * ```
 *
 * `null` — the default — means "no override", which is a different statement from
 * `{}`: both leave the policy unchanged today, but only the first says the call site
 * expressed no opinion.
 */
export const RETRY_OVERRIDE = new HttpContextToken<Partial<RetryPolicy> | null>(() => null);

/**
 * Resends a failed request, with exponential backoff, for as long as the policy allows.
 *
 * Belongs at the bottom of the chain, nearest the transport: everything above it —
 * `jwtInterceptor`'s `Authorization` header, `cacheInterceptor`'s lookup — should
 * happen once per *request*, not once per *attempt*. Re-subscribing `next(req)` is what
 * issues the new attempt, so any decorator beneath this one runs again for each.
 */
export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  const policy = { ...inject(RETRY_POLICY), ...(req.context.get(RETRY_OVERRIDE) ?? {}) };
  const trace = req.context.get(REQUEST_TRACE);

  if (policy.maxRetries <= 0 || !policy.methods.includes(req.method.toUpperCase())) {
    return next(req);
  }

  return next(req).pipe(
    retry({
      count: policy.maxRetries,
      delay: (error: unknown, retryCount: number) => {
        if (!isRetryableFailure(error, policy)) {
          // Rethrowing from the notifier is how `retry` is told to stop early: the
          // count is a ceiling, not a promise that every failure is worth another go.
          return throwError(() => error);
        }

        trace.retries = retryCount;
        return timer(retryDelayMs(error, retryCount, policy, Date.now()));
      },
    })
  );
};

/** Whether `error` is a transport failure the policy is willing to see again. */
export function isRetryableFailure(error: unknown, policy: RetryPolicy): boolean {
  return error instanceof HttpErrorResponse && policy.statuses.includes(error.status);
}

/**
 * How long to wait before attempt number `retryCount + 1`.
 *
 * A `Retry-After` header wins over the computed backoff, and is not jittered — the
 * server named a time, and spreading clients around it would put some of them back
 * before it. It is still clamped to `maxDelayMs`, because a misconfigured `Retry-After:
 * 3600` on a 503 would otherwise hang the request for an hour with no way to tell it
 * apart from a hung connection.
 *
 * `now` is a parameter rather than a `Date.now()` call so the HTTP-date branch is
 * testable without moving the system clock. It is wall-clock milliseconds: an HTTP date
 * has no meaning against a monotonic one.
 */
export function retryDelayMs(
  error: unknown,
  retryCount: number,
  policy: RetryPolicy,
  now: number
): number {
  const requested = error instanceof HttpErrorResponse ? parseRetryAfter(error, now) : null;
  if (requested !== null) return Math.min(requested, policy.maxDelayMs);

  const backoff = Math.min(policy.baseDelayMs * 2 ** (retryCount - 1), policy.maxDelayMs);
  return policy.jitter(backoff);
}

/**
 * `Retry-After` as a non-negative millisecond delay, or `null` if the header is absent
 * or unreadable.
 *
 * RFC 9110 allows both a delta in seconds and an HTTP date, and real services send
 * both — GitHub and Stripe count seconds, a CDN serving a maintenance page usually
 * sends a date. A date already in the past yields `0`, not a negative delay: it means
 * "you may try now".
 */
function parseRetryAfter(error: HttpErrorResponse, now: number): number | null {
  const header = error.headers.get('Retry-After')?.trim();
  if (!header) return null;

  // `Number('')` is 0 and `Number('12abc')` is NaN, so an empty header cannot be
  // mistaken for "retry immediately" and a malformed one falls through to the date
  // parse rather than being read as a delta.
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;

  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
