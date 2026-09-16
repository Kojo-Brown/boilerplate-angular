/**
 * The vocabulary of a Core Web Vitals report, as this application defines it.
 *
 * Deliberately not re-exported from `web-vitals`. The library is loaded from a lazy
 * chunk through {@link SUBSCRIBE_WEB_VITALS}, and a type imported from it would drag its
 * module specifier into every file that names a metric — which is fine for `import type`
 * and stops being fine the first time someone drops the `type` keyword and turns a
 * 9 kB analytics library into an eager dependency of the sink interface.
 *
 * The coupling that matters is checked where it should be: the real subscriber assigns
 * the library's `Metric` to {@link WebVitalMetric}, so a rename or a dropped field in
 * `web-vitals` is a compile error at exactly one call site.
 */

/**
 * The five metrics this application collects.
 *
 * LCP, INP and CLS are the Core Web Vitals proper — the three Google reports on and the
 * three a user can feel. FCP and TTFB are the diagnostics that say *why* LCP is what it
 * is: a slow LCP behind a slow TTFB is a server or network problem, and the same LCP
 * behind a fast FCP is a problem with one image or one font.
 *
 * FID is absent because it no longer exists: it was removed from the Core Web Vitals in
 * March 2024 and dropped from `web-vitals` in v5. INP replaced it and is strictly more
 * honest — FID measured only the delay before the first interaction's handler ran, so a
 * page whose handler then blocked the main thread for a second scored well.
 */
export type WebVitalName = 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';

/**
 * Which side of the published thresholds a value falls on.
 *
 * Carried on the wire rather than computed by the collector, because the thresholds move:
 * they are a property of the metric's definition at the time of measurement, and a
 * dashboard that re-derives them retroactively re-scores history every time the web
 * platform publishes a new number.
 */
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

/**
 * How the page load that produced this measurement began.
 *
 * `back-forward-cache` is the one worth knowing about: a bfcache restore is a *new*
 * measurement of the same document, with its own metric ids and — because nothing is
 * downloaded, parsed or executed — LCP and TTFB values an order of magnitude better than
 * a real load. Averaged in without distinction they quietly flatter every percentile, so
 * this field is what lets a query exclude them or report them apart.
 *
 * `prerender` and `restore` have the same property for the same reason. The union is the
 * Navigation Timing `type` plus those three, which is what `web-vitals` produces.
 */
export type WebVitalNavigationType =
  | 'navigate'
  | 'reload'
  | 'back-forward'
  | 'back-forward-cache'
  | 'prerender'
  | 'restore'
  | 'soft-navigation';

/**
 * One finalised measurement, on its way to a sink.
 *
 * The two paths are the part that is specific to a routed single-page application, and
 * they are not interchangeable — see `docs/web-vitals.md`. A Core Web Vital belongs to a
 * *page load*, not to a route: the browser starts measuring at navigation and stops at
 * the first hide, during which an Angular router can have moved the user through four
 * screens. Attributing LCP to wherever they happened to be standing when the tab lost
 * focus would blame the last route for the first route's images.
 */
export interface WebVitalReport {
  readonly name: WebVitalName;

  /** Milliseconds for every metric except CLS, which is a unitless layout-shift score. */
  readonly value: number;

  /**
   * How much {@link value} moved since this metric was last reported.
   *
   * Equal to `value` on the first report. It exists for collectors that sum deltas
   * rather than keep the last value per id, which is the shape Google Analytics
   * documents; with the default reporting cadence there is one report per metric per
   * page load and the two are the same number.
   */
  readonly delta: number;

  readonly rating: WebVitalRating;

  /**
   * Identifies this metric *instance*, not this report.
   *
   * The dedupe key. A bfcache restore produces a second LCP for the same document with a
   * fresh id, and a collector that keyed on `name` alone would overwrite the first.
   */
  readonly id: string;

  readonly navigationType: WebVitalNavigationType;

  /**
   * The path the document was requested at, captured before the router's first
   * navigation — so a guard redirect does not rewrite history.
   *
   * This is the attribution key. Every metric from one page load carries the same value,
   * whatever the user did afterwards.
   */
  readonly entryPath: string;

  /**
   * The router path in view when the metric finalised, or `entryPath` when nothing has
   * navigated since.
   *
   * Only INP and CLS can differ from {@link entryPath} in practice, and for those the
   * difference is the useful part: an INP of 600 ms reported from `/dashboard/activity`
   * on a page load that entered at `/login` is a slow interaction on the activity table,
   * not on the sign-in form.
   */
  readonly path: string;
}
