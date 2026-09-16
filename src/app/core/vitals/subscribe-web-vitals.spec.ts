import { TestBed } from '@angular/core/testing';
import { SUBSCRIBE_WEB_VITALS, type WebVitalMetric } from './subscribe-web-vitals';

/**
 * The default subscriber, exercised against the real library.
 *
 * Everything else under `core/vitals/` overrides this token, which is the point of it —
 * so this is the one spec that would notice `web-vitals` moving its entry point,
 * renaming an export, or changing the shape of what it hands a handler. None of that is
 * a compile error at the call site of a dynamically imported module until the chunk is
 * actually loaded.
 *
 * What it does not do is assert any metric's *value*. LCP is whatever Chrome decides the
 * largest paint in Karma's iframe was and is not final until that page is hidden, which
 * never happens during a run. TTFB is the one metric whose arrival is a property of a
 * document that has finished loading rather than of anything the suite does, so it is
 * the one asserted.
 */
describe('SUBSCRIBE_WEB_VITALS', () => {
  it('loads the library and registers the observers', async () => {
    const subscribe = TestBed.inject(SUBSCRIBE_WEB_VITALS);

    await expectAsync(subscribe(() => undefined)).toBeResolved();
  });

  it('reports a real metric with every field this codebase reads', async () => {
    const ttfb = await firstTtfb();

    expect(ttfb.value).toBeGreaterThanOrEqual(0);
    expect(ttfb.delta).toEqual(ttfb.value);
    expect(['good', 'needs-improvement', 'poor']).toContain(ttfb.rating);
    expect(ttfb.id).toBeTruthy();
    expect(ttfb.navigationType).toBeTruthy();
  });

  /**
   * The reason `provideWebVitals` copies six fields instead of spreading the metric.
   *
   * `WebVitalMetric` declaring six properties is a compile-time fact and nothing more:
   * the object that arrives at runtime is the library's own, and it carries the live
   * `PerformanceEntry` objects the measurement was derived from — for TTFB an entire
   * `PerformanceNavigationTiming`, for LCP an entry naming the URL of the element that
   * painted — plus three soft-navigation fields. `{ ...metric }` would put all of it into
   * a beacon, unbounded and cross-origin, with the type system raising no objection.
   *
   * Asserted rather than described, because it is a claim about a dependency: if
   * `web-vitals` ever stops attaching `entries`, the copying in `provideWebVitals` costs
   * nothing and this spec is what says the reason for it has gone.
   */
  it('hands over an object carrying more than the declared fields', async () => {
    const ttfb: object = await firstTtfb();

    expect(Object.keys(ttfb)).toContain('entries');
  });

  async function firstTtfb(): Promise<WebVitalMetric> {
    const reported: WebVitalMetric[] = [];
    await TestBed.inject(SUBSCRIBE_WEB_VITALS)((metric) => reported.push(metric));
    return waitFor(() => reported.find((m) => m.name === 'TTFB'));
  }

  /** How many macrotask turns {@link waitFor} waits before giving up. */
  const MAX_TURNS = 25;

  /**
   * Poll until `found()` returns something.
   *
   * `whenStable()` is no help here: `web-vitals` schedules through `PerformanceObserver`
   * and `setTimeout`, neither of which registers a `PendingTask`, so Angular considers
   * itself idle throughout — the same reason `settleUntil` exists for TanStack Query.
   */
  async function waitFor<T>(found: () => T | undefined): Promise<T> {
    for (let turn = 0; turn <= MAX_TURNS; turn++) {
      const value = found();
      if (value !== undefined) return value;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    throw new Error(`No metric arrived within ${MAX_TURNS} turns.`);
  }
});
