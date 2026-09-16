import { InjectionToken, isDevMode } from '@angular/core';
import type { WebVitalReport } from './web-vitals.model';

/**
 * Where finished Core Web Vitals measurements are reported.
 *
 * The same shape as `HttpTelemetrySink`, and for the same reasons — one method, no
 * lifecycle, nothing to await. A sink is called from a `PerformanceObserver` callback and
 * from a `visibilitychange` handler on a page that is being torn down, so `record` must
 * return promptly and must not throw: there is no caller in a position to handle either.
 */
export interface WebVitalsSink {
  record(report: WebVitalReport): void;
}

/**
 * A sink that can be told to send what it is holding.
 *
 * Batching sinks queue reports and flush on a page-lifecycle event, which is a decision
 * the transport makes and the reporter has no business knowing about — so the reporter
 * depends on {@link WebVitalsSink} and this interface exists for the provider that owns
 * the sink's lifetime, and for specs.
 */
export interface FlushableWebVitalsSink extends WebVitalsSink {
  /** Send whatever is queued. Returns `false` if there was nothing to send, or if no transport accepted it. */
  flush(): boolean;

  /** Release the page-lifecycle listeners. Flushes first. */
  dispose(): void;
}

/**
 * Discards everything. The default, for the same reason `noopTelemetrySink` is the
 * default for HTTP spans: a boilerplate has no analytics backend to name, and a default
 * that guessed at one would either fail loudly in every application that has not
 * configured it or — worse — quietly send traffic somewhere.
 */
export const noopWebVitalsSink: WebVitalsSink = { record: () => undefined };

/**
 * Prints each report to the console in development and does nothing in production.
 *
 * For the case where the question is "is this page's LCP bad, and by how much" and
 * standing up a collector to find out is disproportionate. The rating is printed next to
 * the value because the value alone is not readable without the thresholds in your head:
 * 2.4 is a good LCP in seconds and a catastrophic CLS.
 */
export const consoleWebVitalsSink: WebVitalsSink = {
  record: (report) => {
    if (!isDevMode()) return;
    console.debug(
      `[vitals] ${report.name} ${formatValue(report)} ${report.rating} ` +
        `${report.entryPath}${report.path === report.entryPath ? '' : ` → ${report.path}`} ` +
        `(${report.navigationType})`
    );
  },
};

/**
 * A single sink, not a `multi: true` array — the same call as `HTTP_TELEMETRY_SINK`.
 * Fanning out to two collectors is one `record` that calls two others, written by the
 * application that has two; a multi-provider token would make every application pay for
 * the array and would turn a second registration in a lazy route into a silent
 * replacement of the first. `docs/strategy-tokens.md` has that hazard in full.
 */
export const WEB_VITALS_SINK = new InjectionToken<WebVitalsSink>('WEB_VITALS_SINK', {
  providedIn: 'root',
  factory: () => noopWebVitalsSink,
});

/**
 * CLS is a unitless score in the hundredths; everything else is milliseconds.
 *
 * Rounding CLS to the nearest millisecond would print every value a healthy page can
 * produce as `0`, which reads as "not measured" rather than "good".
 */
function formatValue(report: WebVitalReport): string {
  return report.name === 'CLS' ? report.value.toFixed(3) : `${Math.round(report.value)}ms`;
}
