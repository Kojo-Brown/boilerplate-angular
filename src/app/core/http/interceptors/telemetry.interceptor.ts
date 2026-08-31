import { HttpErrorResponse, HttpEventType, type HttpInterceptorFn } from '@angular/common/http';
import { InjectionToken, inject, isDevMode } from '@angular/core';
import { finalize, tap } from 'rxjs';
import { HTTP_CLOCK, REQUEST_TRACE, type CacheOutcome } from './request-trace';

/**
 * How a request ended.
 *
 * `cancelled` is its own outcome rather than a kind of error. Under a `switchMap`
 * typeahead or a component destroyed mid-flight it is the *expected* ending, and an
 * error-rate dashboard that counted those would report an incident every time someone
 * typed quickly.
 */
export type HttpOutcome = 'success' | 'error' | 'cancelled';

/** One request, as it looked from outside the whole interceptor chain. */
export interface HttpSpan {
  readonly method: string;

  /**
   * The URL without its query string. Query parameters carry search terms, ids and
   * anything else a caller passed, and a telemetry sink is usually somewhere the rest
   * of the application's data is not — a URL that has already been aggregated across
   * users cannot leak what one of them typed.
   */
  readonly url: string;

  readonly outcome: HttpOutcome;

  /** The response status, or `0` when there was never a response to read one from. */
  readonly status: number;

  /** Wall-clock milliseconds from the request entering the chain to it leaving. */
  readonly durationMs: number;

  /** Retries performed beneath this decorator. `0` if the first attempt settled it. */
  readonly retries: number;

  /** What the cache decorator did. See {@link CacheOutcome}. */
  readonly cache: CacheOutcome;
}

/** Where finished requests are reported. */
export interface HttpTelemetrySink {
  record(span: HttpSpan): void;
}

/**
 * Discards everything. The default, because a boilerplate has no analytics backend to
 * name and a sink that guessed at one would either fail loudly in every application
 * that has not configured it or, worse, quietly send traffic somewhere.
 */
export const noopTelemetrySink: HttpTelemetrySink = { record: () => undefined };

/**
 * Prints each span to the console in development and does nothing in production, for
 * the case where the answer wanted is "which of these requests is slow" and standing up
 * a collector to find out is disproportionate.
 */
export const consoleTelemetrySink: HttpTelemetrySink = {
  record: (span) => {
    if (!isDevMode()) return;
    console.debug(
      `[http] ${span.method} ${span.url} ${span.outcome} ${span.status} ` +
        `${Math.round(span.durationMs)}ms retries=${span.retries} cache=${span.cache}`
    );
  },
};

/**
 * A single sink, not a `multi: true` array. Fanning out to two collectors is one
 * `record` that calls two others, written by the application that has two — whereas a
 * multi-provider token would make *every* application pay for the array, and would
 * quietly turn a second registration in a lazy route into a replacement of the first.
 * See `docs/strategy-tokens.md` for that last hazard in the case where it is worth it.
 */
export const HTTP_TELEMETRY_SINK = new InjectionToken<HttpTelemetrySink>('HTTP_TELEMETRY_SINK', {
  providedIn: 'root',
  factory: () => noopTelemetrySink,
});

/**
 * Reports every request to {@link HTTP_TELEMETRY_SINK} once it has ended, whichever way
 * it ended.
 *
 * Belongs at the top of the chain. What it measures is what the caller experienced —
 * including the time a retry spent waiting out its backoff and the time a queued
 * request spent behind a token refresh, both of which are invisible from below. The
 * price of sitting there is that it observes the error `errorInterceptor` has already
 * translated rather than the `HttpErrorResponse`, which is why {@link statusOf} reads
 * either shape.
 *
 * `finalize` rather than `tap`'s `complete`, because unsubscription is an ending too
 * and `tap` has no callback for it.
 */
export const telemetryInterceptor: HttpInterceptorFn = (req, next) => {
  const sink = inject(HTTP_TELEMETRY_SINK);
  const clock = inject(HTTP_CLOCK);
  const trace = req.context.get(REQUEST_TRACE);
  const startedAt = clock();

  // Cancellation is the absence of an ending, so it cannot be detected — only assumed
  // until something else happens. Starting here and overwriting means the branch that
  // needs no evidence is the one that gets none.
  let outcome: HttpOutcome = 'cancelled';
  let status = 0;

  return next(req).pipe(
    tap({
      next: (event) => {
        if (event.type !== HttpEventType.Response) return;
        outcome = 'success';
        status = event.status;
      },
      error: (error: unknown) => {
        outcome = 'error';
        status = statusOf(error);
      },
    }),
    finalize(() => {
      sink.record({
        method: req.method.toUpperCase(),
        url: req.url,
        outcome,
        status,
        durationMs: clock() - startedAt,
        retries: trace.retries,
        cache: trace.cache,
      });
    })
  );
};

/**
 * The HTTP status carried by a rejection, or `0` when it carries none.
 *
 * Two shapes reach here: an `HttpErrorResponse`, when nothing has normalised it yet,
 * and this codebase's `ApiError` — `{ status, message }` — once `errorInterceptor`
 * has. Both are matched structurally rather than by importing `ApiError`, so a third
 * shape from an application's own interceptor is read too instead of being reported
 * as a status-less failure.
 */
export function statusOf(error: unknown): number {
  if (error instanceof HttpErrorResponse) return error.status;

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }

  return 0;
}
