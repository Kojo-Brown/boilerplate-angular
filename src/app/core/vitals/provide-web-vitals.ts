import { DOCUMENT } from '@angular/common';
import type { EnvironmentProviders } from '@angular/core';
import {
  DestroyRef,
  afterNextRender,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { Router } from '@angular/router';
import type { BeaconHost, WebVitalsBeaconOptions } from './beacon-sink';
import { createBeaconWebVitalsSink } from './beacon-sink';
import { SUBSCRIBE_WEB_VITALS } from './subscribe-web-vitals';
import { WEB_VITALS_SINK } from './web-vitals-sink';

/**
 * Measure this page load's Core Web Vitals and report each metric to
 * {@link WEB_VITALS_SINK}.
 *
 * Does nothing on the server, by construction rather than by a platform check:
 * `afterNextRender` has no server-side counterpart and its callbacks are never run there.
 * That is also why the work is registered from inside an app initializer instead of
 * being one — an initializer runs *before* the first render, and starting a chunk
 * download at that moment delays the very paint LCP is about to measure.
 *
 * Nothing here schedules change detection, and nothing needs to: the callbacks arrive
 * from a `PerformanceObserver` and from page-lifecycle listeners, both outside anything
 * Angular tracks, and all they do is hand a plain object to a sink. Under zoneless that
 * is the well-behaved case rather than the hazard — see `docs/zoneless.md`.
 */
export function provideWebVitals(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      const subscribe = inject(SUBSCRIBE_WEB_VITALS);
      const sink = inject(WEB_VITALS_SINK);
      const router = inject(Router);

      // Read here, in the initializer, and not in the render callback: this runs before
      // the router's first navigation, so it is the path the *document* was requested at.
      // By the time anything renders, `authGuard` may already have replaced the URL, and
      // a page load that was abandoned at `/dashboard` would be filed under `/login`.
      const entryPath = normalisePath(inject(DOCUMENT).location.pathname);

      afterNextRender(() => {
        void subscribe((metric) => {
          // Copied field by field, never `{ ...metric }`. `WebVitalMetric` is a
          // structural *subset* of what the library hands over, and a subset is a
          // compile-time fact only: at runtime the object also carries `entries` — the
          // live `PerformanceEntry` objects behind the measurement, which for LCP name
          // the URL of the element that painted, and for TTFB are a whole
          // `PerformanceNavigationTiming` — plus three soft-navigation fields. A spread
          // puts all of it on the wire, unbounded and cross-origin, with nothing in the
          // type system objecting. `subscribe-web-vitals.spec.ts` pins the extra
          // properties as a fact about the library, and the spec below pins that they do
          // not reach the sink.
          sink.record({
            name: metric.name,
            value: metric.value,
            delta: metric.delta,
            rating: metric.rating,
            id: metric.id,
            navigationType: metric.navigationType,
            entryPath,
            // `navigated` rather than a truthiness check on the URL: before the first
            // navigation completes `Router.url` is `'/'`, which is a real route here and
            // would misreport a TTFB that settled during bootstrap as a metric for the
            // home page.
            path: router.navigated ? normalisePath(router.url) : entryPath,
          });
        });
      });
    }),
  ]);
}

/**
 * Provide {@link WEB_VITALS_SINK} as a batching beacon to `options.url`.
 *
 * Owns the sink's lifetime as well as its construction, which is the reason this exists
 * rather than a `useValue` at the call site: the sink holds two window listeners, and an
 * application destroyed without releasing them — a test bed, a micro-frontend unmounted
 * from a host page — leaks a closure over a dead injector that still answers
 * `visibilitychange`.
 */
export function provideWebVitalsBeacon(options: WebVitalsBeaconOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: WEB_VITALS_SINK,
      useFactory: () => {
        // `DOCUMENT.defaultView` rather than `window`, which does not exist on the
        // server and is a lint error under `src/app/**` for that reason. It is `null`
        // there, and `createBeaconWebVitalsSink` answers a null host with a sink that
        // records into nothing.
        const host: BeaconHost | null = inject(DOCUMENT).defaultView;
        const sink = createBeaconWebVitalsSink(host, options);
        inject(DestroyRef).onDestroy(() => sink.dispose());
        return sink;
      },
    },
  ]);
}

/**
 * A router URL or a location pathname reduced to its path.
 *
 * Query strings carry search terms, ids, tokens in a password-reset link and anything
 * else a caller put there, and a vitals collector is usually somewhere the rest of the
 * application's data is not. `HttpSpan.url` drops them for the same reason. The fragment
 * goes too — it never reaches a server, so nothing downstream can have been built to
 * expect it.
 */
export function normalisePath(url: string): string {
  const end = Math.min(...[url.indexOf('?'), url.indexOf('#')].filter((i) => i >= 0), url.length);
  const path = url.slice(0, end);
  return path === '' ? '/' : path;
}
