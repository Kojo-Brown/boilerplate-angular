import { InjectionToken } from '@angular/core';
import type { WebVitalName, WebVitalNavigationType, WebVitalRating } from './web-vitals.model';

/**
 * A metric as the measuring library hands it over, before this application has attached
 * a route to it.
 *
 * Structurally a subset of `web-vitals`' own `Metric`, which is what makes
 * {@link SUBSCRIBE_WEB_VITALS}'s default factory typecheck: the handler declared here is
 * passed straight to `onLCP` and friends, so a field renamed or narrowed upstream is a
 * compile error at that one call site rather than a silently absent property on the wire.
 *
 * The four members of `Metric` that are not here are left out on purpose. `entries` is
 * an array of live `PerformanceEntry` objects — unbounded, unserialisable, and full of
 * URLs from other origins. `navigationId`, `navigationURL` and `navigationStartTime`
 * only carry anything under the soft-navigation API, which is behind a flag and which
 * this application does not opt into; see `docs/web-vitals.md`.
 */
export interface WebVitalMetric {
  readonly name: WebVitalName;
  readonly value: number;
  readonly delta: number;
  readonly rating: WebVitalRating;
  readonly id: string;
  readonly navigationType: WebVitalNavigationType;
}

/**
 * Start measuring, calling back once per metric per page load.
 *
 * Asynchronous because the real implementation loads the measuring library from a lazy
 * chunk. The promise resolves when the observers are registered, which is a fact a spec
 * can await and nothing in production needs.
 */
export type SubscribeWebVitals = (onReport: (metric: WebVitalMetric) => void) => Promise<void>;

/**
 * The seam between this application and `web-vitals`.
 *
 * It exists for two reasons, and the second is the one that pays for it.
 *
 * **It is the only place the library is named.** `import('web-vitals')` inside the
 * factory is a dynamic import, so the bundler gives it its own chunk and the 9 kB of
 * measuring code is not in the initial bundle. That is not a micro-optimisation dressed
 * up as a principle: an analytics library downloaded during page load competes for
 * bandwidth and main-thread time with the page whose load it is measuring, and makes the
 * numbers it reports worse. `PerformanceObserver` is registered with `buffered: true`
 * throughout `web-vitals`, so entries that occurred before the chunk arrived are still
 * delivered — arriving late costs nothing except in the one case written up in
 * `docs/web-vitals.md`, where the page is hidden before the chunk lands and the load goes
 * unreported.
 *
 * **It is what makes the reporting testable.** LCP cannot be provoked in a unit test: it
 * is whatever the browser decides the largest paint was, it is not final until the page
 * is hidden, and Karma's page is never hidden. Overriding this token with a function that
 * keeps the handler lets a spec produce an INP of 3 000 ms on demand and assert on what
 * came out of the sink — the mapping, the route attribution, the batching — which is all
 * of this application's own behaviour. What is left unasserted is the library's
 * correctness, which is its own suite's job.
 */
export const SUBSCRIBE_WEB_VITALS = new InjectionToken<SubscribeWebVitals>('SUBSCRIBE_WEB_VITALS', {
  providedIn: 'root',
  factory: () => async (onReport) => {
    const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals');

    // Called one by one rather than looped over. The five handler types differ in
    // their metric parameter, so an array of them has a union type whose call
    // signature TypeScript resolves to the *intersection* of the parameters — a
    // callback that would have to accept a metric that is simultaneously a CLSMetric
    // and an LCPMetric. Five lines, no cast.
    //
    // Each is left on its default cadence: report once, when the value is final. The
    // alternative — `{ reportAllChanges: true }` — is for a live overlay, and through a
    // beacon it would send a request per layout shift.
    onCLS(onReport);
    onFCP(onReport);
    onINP(onReport);
    onLCP(onReport);
    onTTFB(onReport);
  },
});
