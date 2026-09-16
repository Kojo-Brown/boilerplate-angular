import { TestBed } from '@angular/core/testing';
import {
  WEB_VITALS_SINK,
  consoleWebVitalsSink,
  noopWebVitalsSink,
  type WebVitalsSink,
} from './web-vitals-sink';
import type { WebVitalReport } from './web-vitals.model';

function report(overrides: Partial<WebVitalReport> = {}): WebVitalReport {
  return {
    name: 'LCP',
    value: 1842.7,
    delta: 1842.7,
    rating: 'good',
    id: 'v6-1700000000000-1',
    navigationType: 'navigate',
    entryPath: '/login',
    path: '/login',
    ...overrides,
  };
}

describe('WEB_VITALS_SINK', () => {
  /**
   * The same call `HTTP_TELEMETRY_SINK` makes. A default that named a collector would
   * send every downstream application's field data somewhere its author never chose, and
   * a default that threw would break every application that has not configured one.
   */
  it('discards by default', () => {
    expect(TestBed.inject(WEB_VITALS_SINK)).toBe(noopWebVitalsSink);
    expect(() => TestBed.inject(WEB_VITALS_SINK).record(report())).not.toThrow();
  });

  it('is a single sink, so an application that has two writes the one that calls both', () => {
    const first: WebVitalReport[] = [];
    const second: WebVitalReport[] = [];
    const fanOut: WebVitalsSink = {
      record: (r) => {
        first.push(r);
        second.push(r);
      },
    };

    TestBed.configureTestingModule({
      providers: [{ provide: WEB_VITALS_SINK, useValue: fanOut }],
    });
    TestBed.inject(WEB_VITALS_SINK).record(report());

    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
  });
});

describe('consoleWebVitalsSink', () => {
  it('prints one line naming the value, the rating and the page load', () => {
    const debug = spyOn(console, 'debug');

    consoleWebVitalsSink.record(report());

    expect(debug).toHaveBeenCalledOnceWith('[vitals] LCP 1843ms good /login (navigate)');
  });

  /**
   * CLS is a unitless score in the hundredths. Rounded to the nearest millisecond, every
   * value a healthy page can produce prints as `0` — which reads as "not measured" rather
   * than "good".
   */
  it('prints CLS as a score rather than a duration', () => {
    const debug = spyOn(console, 'debug');

    consoleWebVitalsSink.record(report({ name: 'CLS', value: 0.042, rating: 'good' }));

    expect(debug).toHaveBeenCalledOnceWith('[vitals] CLS 0.042 good /login (navigate)');
  });

  it('names both paths when the route moved before the metric settled', () => {
    const debug = spyOn(console, 'debug');

    consoleWebVitalsSink.record(
      report({
        name: 'INP',
        value: 312,
        rating: 'needs-improvement',
        path: '/dashboard/activity',
      })
    );

    expect(debug).toHaveBeenCalledOnceWith(
      '[vitals] INP 312ms needs-improvement /login → /dashboard/activity (navigate)'
    );
  });

  /**
   * A bfcache restore produces a second set of metrics for the same document, with values
   * an order of magnitude better than a real load because nothing was downloaded, parsed
   * or executed. Printing the navigation type is what stops a reader averaging them in.
   */
  it('names the navigation type, so a bfcache restore is not read as a fast load', () => {
    const debug = spyOn(console, 'debug');

    consoleWebVitalsSink.record(report({ value: 41, navigationType: 'back-forward-cache' }));

    expect(debug).toHaveBeenCalledOnceWith('[vitals] LCP 41ms good /login (back-forward-cache)');
  });
});

describe('noopWebVitalsSink', () => {
  it('does nothing at all', () => {
    const debug = spyOn(console, 'debug');

    noopWebVitalsSink.record(report());

    expect(debug).not.toHaveBeenCalled();
  });
});
