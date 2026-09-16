import { ApplicationRef, ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { normalisePath, provideWebVitals, provideWebVitalsBeacon } from './provide-web-vitals';
import type { SubscribeWebVitals, WebVitalMetric } from './subscribe-web-vitals';
import { SUBSCRIBE_WEB_VITALS } from './subscribe-web-vitals';
import { WEB_VITALS_SINK } from './web-vitals-sink';
import type { WebVitalReport } from './web-vitals.model';

@Component({
  selector: 'app-blank',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class BlankComponent {}

function metric(overrides: Partial<WebVitalMetric> = {}): WebVitalMetric {
  return {
    name: 'LCP',
    value: 1800,
    delta: 1800,
    rating: 'good',
    id: 'v6-1700000000000-1',
    navigationType: 'navigate',
    ...overrides,
  };
}

describe('provideWebVitals', () => {
  let recorded: WebVitalReport[];
  /** The handler `provideWebVitals` passed to the subscriber, or `null` before it has. */
  let emit: ((m: WebVitalMetric) => void) | null;

  beforeEach(() => {
    recorded = [];
    emit = null;

    const subscribe: SubscribeWebVitals = async (onReport) => {
      emit = onReport;
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'dashboard/activity', component: BlankComponent },
          { path: '**', component: BlankComponent },
        ]),
        { provide: WEB_VITALS_SINK, useValue: { record: (r: WebVitalReport) => recorded.push(r) } },
        { provide: SUBSCRIBE_WEB_VITALS, useValue: subscribe },
        provideWebVitals(),
      ],
    });
  });

  /**
   * Bootstrap far enough for the render callback to run.
   *
   * `afterNextRender` fires from `ApplicationRef.tick()`, not from a change detection
   * pass, so a fixture alone is not enough — and the subscriber is async, so the handler
   * only exists a microtask later.
   */
  async function renderAndSubscribe(): Promise<void> {
    TestBed.createComponent(BlankComponent).detectChanges();
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();
  }

  /**
   * The point of registering from inside an app initializer rather than as one: an
   * initializer runs before the first paint, and starting a chunk download there delays
   * the largest contentful paint it is about to measure.
   */
  it('does not start measuring before the first render', () => {
    TestBed.inject(ApplicationRef);

    expect(emit).toBeNull();
  });

  it('starts measuring once the application has rendered', async () => {
    await renderAndSubscribe();

    expect(emit).not.toBeNull();
  });

  it('passes each metric on to the sink', async () => {
    await renderAndSubscribe();
    emit?.(metric({ name: 'INP', value: 312, rating: 'needs-improvement' }));

    expect(recorded.length).toBe(1);
    expect(recorded[0]).toEqual(
      jasmine.objectContaining<WebVitalReport>({
        name: 'INP',
        value: 312,
        rating: 'needs-improvement',
        id: 'v6-1700000000000-1',
        navigationType: 'navigate',
      })
    );
  });

  /**
   * The library hands over its own metric object, which carries the live
   * `PerformanceEntry` objects behind the measurement as well as the six fields
   * `WebVitalMetric` declares — a fact `subscribe-web-vitals.spec.ts` pins against the
   * real library. A spread would beacon all of it, including the URL of whichever element
   * produced the largest paint, and nothing in the type system would say so.
   */
  it('sends only the declared fields, whatever else the metric is carrying', async () => {
    await renderAndSubscribe();
    emit?.({
      ...metric(),
      entries: [{ name: 'https://images.example.test/hero.jpg' }],
      navigationURL: 'https://app.example.test/dashboard?token=not-a-real-token',
    } as WebVitalMetric);

    expect(Object.keys(recorded[0]).sort()).toEqual([
      'delta',
      'entryPath',
      'id',
      'name',
      'navigationType',
      'path',
      'rating',
      'value',
    ]);
  });

  /**
   * The entry path is the document's, read in the initializer — before the router's first
   * navigation and before any guard has had the chance to redirect. Asserted against the
   * live value rather than a literal, because Karma serves the suite from a path of its
   * own choosing.
   */
  it('attributes every metric to the path the document was requested at', async () => {
    await renderAndSubscribe();
    emit?.(metric());

    expect(recorded[0].entryPath).toBe(normalisePath(document.location.pathname));
  });

  it('reports the route in view when the metric settled', async () => {
    await renderAndSubscribe();
    await TestBed.inject(Router).navigateByUrl('/dashboard/activity');
    emit?.(metric({ name: 'INP' }));

    expect(recorded[0].path).toBe('/dashboard/activity');
  });

  /**
   * A page load that entered at `/login` and was still being measured three routes later
   * has one entry path and a different current path, and the pair is the useful part: a
   * slow INP on the activity table is not a slow INP on the sign-in form.
   */
  it('keeps the entry path fixed while the current path follows the router', async () => {
    await renderAndSubscribe();
    emit?.(metric({ name: 'TTFB', value: 90 }));
    await TestBed.inject(Router).navigateByUrl('/dashboard/activity');
    emit?.(metric({ name: 'INP', value: 312 }));

    expect(recorded.map((r) => r.entryPath)).toEqual([
      recorded[0].entryPath,
      recorded[0].entryPath,
    ]);
    expect(recorded.map((r) => r.path)).toEqual([recorded[0].entryPath, '/dashboard/activity']);
  });

  /**
   * Before the first navigation `Router.url` is `'/'` — a real route in this application,
   * not a null value — so a TTFB that settles during bootstrap would otherwise be filed
   * against the home page.
   */
  it('falls back to the entry path while the router has not navigated', async () => {
    await renderAndSubscribe();
    expect(TestBed.inject(Router).navigated).toBeFalse();

    emit?.(metric({ name: 'TTFB', value: 90 }));

    expect(recorded[0].path).toBe(recorded[0].entryPath);
  });

  it('drops the query string from the current path', async () => {
    await renderAndSubscribe();
    await TestBed.inject(Router).navigateByUrl('/dashboard/activity?q=alice&page=3');
    emit?.(metric({ name: 'CLS', value: 0.02 }));

    expect(recorded[0].path).toBe('/dashboard/activity');
  });
});

describe('provideWebVitalsBeacon', () => {
  let sendBeacon: jasmine.Spy<typeof navigator.sendBeacon>;

  beforeEach(() => {
    // Stubbed rather than pointed at a dead URL: a real beacon would leave a request in
    // flight after the suite finished, and the failure would land in Karma's console
    // attributed to whichever spec happened to be running.
    sendBeacon = spyOn(navigator, 'sendBeacon').and.returnValue(true);
  });

  it('provides a beacon as the sink, wired to the real window', () => {
    TestBed.configureTestingModule({
      providers: [provideWebVitalsBeacon({ url: '/vitals', maxBatchSize: 1 })],
    });

    TestBed.inject(WEB_VITALS_SINK).record(reportFor('LCP'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.calls.mostRecent().args[0]).toBe('/vitals');
  });

  /**
   * The reason the provider owns the sink's lifetime rather than a `useValue` at the call
   * site: an application torn down without disposing it drops whatever the batch was
   * holding, and leaves two window listeners closed over a dead injector.
   */
  it('flushes what the sink is holding when the injector is destroyed', () => {
    // Asserted rather than assumed, because the batch below only stays queued while the
    // page is visible — a headless runner that reported itself hidden would make this
    // spec pass for the wrong reason.
    expect(document.visibilityState).toBe('visible');

    TestBed.configureTestingModule({
      providers: [provideWebVitalsBeacon({ url: '/vitals', maxBatchSize: 5 })],
    });
    TestBed.inject(WEB_VITALS_SINK).record(reportFor('TTFB'));
    expect(sendBeacon).not.toHaveBeenCalled();

    TestBed.resetTestingModule();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  function reportFor(name: WebVitalReport['name']): WebVitalReport {
    return {
      name,
      value: 1,
      delta: 1,
      rating: 'good',
      id: `${name}-1`,
      navigationType: 'navigate',
      entryPath: '/',
      path: '/',
    };
  }
});

describe('normalisePath', () => {
  it('leaves a bare path alone', () => {
    expect(normalisePath('/dashboard/activity')).toBe('/dashboard/activity');
  });

  // The same call `HttpSpan.url` makes: query strings carry search terms, ids, and the
  // token in a password-reset link, and a vitals collector is usually somewhere the rest
  // of the application's data is not.
  it('drops a query string', () => {
    expect(normalisePath('/posts?q=alice&page=3')).toBe('/posts');
  });

  it('drops a fragment', () => {
    expect(normalisePath('/docs#installation')).toBe('/docs');
  });

  it('drops both, whichever comes first', () => {
    expect(normalisePath('/docs#top?not-a-query')).toBe('/docs');
    expect(normalisePath('/docs?tab=2#top')).toBe('/docs');
  });

  it('reports a path that is nothing but a query as the root', () => {
    expect(normalisePath('?redirect=/dashboard')).toBe('/');
  });
});
