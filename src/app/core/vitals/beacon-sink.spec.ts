import type { BeaconFetchInit, BeaconHost, WebVitalsBeaconPayload } from './beacon-sink';
import { createBeaconWebVitalsSink } from './beacon-sink';
import type { WebVitalName, WebVitalReport } from './web-vitals.model';

const COLLECTOR = 'https://vitals.example.test/collect';

/**
 * A fake window, built from the four members {@link BeaconHost} asks for.
 *
 * The point of the structural host type: a spec can hide the page, fail a `sendBeacon`,
 * or remove `fetch` entirely without touching the document Karma is running in — where
 * `visibilitychange` cannot be provoked and a real beacon would leave a request in
 * flight after the suite ends.
 */
interface FakeBeaconHost extends BeaconHost {
  /** Every `sendBeacon` call, in order. */
  readonly beacons: { url: string; body: string }[];
  /** Every fallback `fetch` call, in order. */
  readonly fetches: { url: string; init: BeaconFetchInit | undefined }[];
  /** Fire a page-lifecycle event at whatever the sink registered. */
  dispatch(type: 'visibilitychange' | 'pagehide'): void;
  /** How many listeners are still registered, so `dispose` can be shown to release them. */
  listenerCount(): number;
}

interface FakeBeaconHostOptions {
  /** What `sendBeacon` returns. `'absent'` removes the method, as an old browser would. */
  readonly beacon?: boolean | 'absent' | 'throws';
  /** `'absent'` removes `fetch`, leaving the sink with no transport at all. */
  readonly fetch?: 'resolves' | 'rejects' | 'throws' | 'absent';
  readonly visibilityState?: 'visible' | 'hidden';
}

function createFakeBeaconHost(options: FakeBeaconHostOptions = {}): FakeBeaconHost {
  const beacons: { url: string; body: string }[] = [];
  const fetches: { url: string; init: BeaconFetchInit | undefined }[] = [];
  const listeners = new Map<string, (() => void)[]>();
  const visibilityState: string = options.visibilityState ?? 'visible';

  const navigator =
    options.beacon === 'absent'
      ? undefined
      : {
          sendBeacon(url: string, data?: string): boolean {
            if (options.beacon === 'throws') throw new TypeError('Failed to parse URL');
            beacons.push({ url, body: data ?? '' });
            return typeof options.beacon === 'boolean' ? options.beacon : true;
          },
        };

  const fetch =
    options.fetch === 'absent'
      ? undefined
      : (input: string, init?: BeaconFetchInit): Promise<unknown> => {
          if (options.fetch === 'throws') throw new TypeError('Failed to fetch');
          fetches.push({ url: input, init });
          return options.fetch === 'rejects'
            ? Promise.reject(new TypeError('NetworkError'))
            : Promise.resolve({ ok: true });
        };

  return {
    beacons,
    fetches,
    navigator,
    fetch,
    document: { visibilityState },
    addEventListener(type: string, listener: () => void): void {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener)
      );
    },
    dispatch(type): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listenerCount: () => [...listeners.values()].reduce((total, l) => total + l.length, 0),
  };
}

function report(name: WebVitalName, value: number): WebVitalReport {
  return {
    name,
    value,
    delta: value,
    rating: 'good',
    id: `${name.toLowerCase()}-1`,
    navigationType: 'navigate',
    entryPath: '/login',
    path: '/login',
  };
}

function payloadOf(body: string): WebVitalsBeaconPayload {
  return JSON.parse(body) as WebVitalsBeaconPayload;
}

describe('createBeaconWebVitalsSink', () => {
  describe('batching', () => {
    it('holds reports back until the batch is full, then sends them in one request', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 3 });

      sink.record(report('TTFB', 120));
      sink.record(report('FCP', 900));
      expect(host.beacons).toEqual([]);

      sink.record(report('LCP', 1800));

      expect(host.beacons.length).toBe(1);
      expect(payloadOf(host.beacons[0].body).reports.map((r) => r.name)).toEqual([
        'TTFB',
        'FCP',
        'LCP',
      ]);
    });

    it('defaults the batch to the five metrics of one page load', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      for (const name of ['TTFB', 'FCP', 'LCP', 'CLS'] as const) sink.record(report(name, 1));
      expect(host.beacons).toEqual([]);

      sink.record(report('INP', 1));
      expect(host.beacons.length).toBe(1);
      expect(payloadOf(host.beacons[0].body).reports.length).toBe(5);
    });

    it('empties the queue on send, so the next batch does not repeat the last one', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      sink.record(report('TTFB', 120));
      sink.record(report('FCP', 900));

      expect(host.beacons.map((b) => payloadOf(b.body).reports.map((r) => r.name))).toEqual([
        ['TTFB'],
        ['FCP'],
      ]);
    });

    it('treats a batch size below 1 as 1 rather than never sending', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 0 });

      sink.record(report('TTFB', 120));

      expect(host.beacons.length).toBe(1);
    });

    it('reports nothing when it is holding nothing', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      expect(sink.flush()).toBe(false);
      expect(host.beacons).toEqual([]);
    });
  });

  // The reason the sink exists. LCP, CLS and INP are not final until the page is hidden,
  // so a sink that only sent on a full batch would report TTFB and FCP and drop the three
  // metrics anyone actually asks about.
  describe('the page-lifecycle flush', () => {
    it('sends what it is holding when the tab is hidden', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      sink.record(report('TTFB', 120));
      host.dispatch('visibilitychange');

      expect(host.beacons.length).toBe(1);
      expect(payloadOf(host.beacons[0].body).reports.map((r) => r.name)).toEqual(['TTFB']);
    });

    // Not redundant with the above: a tab switch fires `visibilitychange` and never
    // `pagehide`, and a bfcache-eligible navigation has historically done the reverse.
    it('sends what it is holding on pagehide', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      sink.record(report('CLS', 0.02));
      host.dispatch('pagehide');

      expect(host.beacons.length).toBe(1);
    });

    it('does not send an empty request when the page hides with nothing queued', () => {
      const host = createFakeBeaconHost();
      createBeaconWebVitalsSink(host, { url: COLLECTOR });

      host.dispatch('visibilitychange');

      expect(host.beacons).toEqual([]);
    });
  });

  /**
   * `web-vitals` reports its three late metrics from its own `visibilitychange`
   * listener, and which of the two listeners runs first depends on when a lazy chunk
   * finished loading. Both orders have to work, so both are asserted.
   */
  describe('whichever order the visibilitychange listeners run in', () => {
    it('sends reports that arrive after the hide, one request each', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      // Ours first: the queue is empty, so the flush sends nothing.
      host.dispatch('visibilitychange');
      expect(host.beacons).toEqual([]);

      // Theirs second: three late metrics on a page that is already going away.
      sink.record(report('LCP', 1800));
      sink.record(report('CLS', 0.05));
      sink.record(report('INP', 240));

      expect(host.beacons.map((b) => payloadOf(b.body).reports[0].name)).toEqual([
        'LCP',
        'CLS',
        'INP',
      ]);
    });

    it('sends reports that arrive before the hide, in one request', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      // Theirs first.
      sink.record(report('LCP', 1800));
      sink.record(report('CLS', 0.05));
      sink.record(report('INP', 240));
      expect(host.beacons).toEqual([]);

      // Ours second.
      host.dispatch('visibilitychange');

      expect(host.beacons.length).toBe(1);
      expect(payloadOf(host.beacons[0].body).reports.map((r) => r.name)).toEqual([
        'LCP',
        'CLS',
        'INP',
      ]);
    });

    // A tab restored into the background, or a prerender: the hide event has been and
    // gone, and a sink seeded with `pageHidden = false` would queue everything behind an
    // event that is never coming.
    it('sends immediately when the page was already hidden at construction', () => {
      const host = createFakeBeaconHost({ visibilityState: 'hidden' });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      sink.record(report('TTFB', 120));

      expect(host.beacons.length).toBe(1);
    });
  });

  describe('the transports', () => {
    it('prefers sendBeacon and does not also fetch', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      sink.record(report('TTFB', 120));

      expect(host.beacons.length).toBe(1);
      expect(host.fetches).toEqual([]);
      expect(host.beacons[0].url).toBe(COLLECTOR);
    });

    // `sendBeacon` returns false rather than throwing when the browser's beacon queue is
    // over its 64 KiB budget — the case a fallback exists for.
    it('falls back to a keepalive fetch when sendBeacon refuses the payload', () => {
      const host = createFakeBeaconHost({ beacon: false });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      sink.record(report('TTFB', 120));

      expect(host.fetches.length).toBe(1);
      expect(host.fetches[0].init).toEqual(
        jasmine.objectContaining<BeaconFetchInit>({
          method: 'POST',
          keepalive: true,
          credentials: 'omit',
        })
      );
    });

    it('falls back to a keepalive fetch where there is no sendBeacon at all', () => {
      const host = createFakeBeaconHost({ beacon: 'absent' });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      sink.record(report('TTFB', 120));

      expect(host.fetches.length).toBe(1);
    });

    // A malformed collector URL throws out of `sendBeacon` rather than returning false,
    // and it would throw from inside a `visibilitychange` handler.
    it('survives a sendBeacon that throws, and still tries the fallback', () => {
      const host = createFakeBeaconHost({ beacon: 'throws' });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      expect(() => sink.record(report('TTFB', 120))).not.toThrow();
      expect(host.fetches.length).toBe(1);
    });

    it('survives a fetch that throws synchronously', () => {
      const host = createFakeBeaconHost({ beacon: 'absent', fetch: 'throws' });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      expect(() => sink.record(report('TTFB', 120))).not.toThrow();
      expect(sink.flush()).toBe(false);
    });

    // An unhandled rejection from a page that is unloading would surface in whatever
    // error tracker the host application runs, blamed on the application.
    it('swallows a rejected fallback fetch rather than leaving it unhandled', async () => {
      const host = createFakeBeaconHost({ beacon: 'absent', fetch: 'rejects' });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      sink.record(report('TTFB', 120));
      await Promise.resolve();
      await Promise.resolve();

      expect(host.fetches.length).toBe(1);
    });

    it('drops the batch where there is no transport, without throwing', () => {
      const host = createFakeBeaconHost({ beacon: 'absent', fetch: 'absent' });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      expect(() => sink.record(report('TTFB', 120))).not.toThrow();
      expect(sink.flush()).toBe(false);
    });

    // Not a retry queue: a beacon fails because the document is going away, and the next
    // best thing after "send it now" is nothing, not "send it later".
    it('does not hold a failed batch back for the next send', () => {
      const host = createFakeBeaconHost({ beacon: 'absent', fetch: 'absent' });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      sink.record(report('TTFB', 120));
      expect(sink.flush()).toBe(false);
    });
  });

  describe('the payload', () => {
    it('sends every field of every report under a single `reports` key', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });
      const inp: WebVitalReport = {
        name: 'INP',
        value: 312.5,
        delta: 312.5,
        rating: 'needs-improvement',
        id: 'v6-1700000000000-42',
        navigationType: 'back-forward-cache',
        entryPath: '/login',
        path: '/dashboard/activity',
      };

      sink.record(inp);

      expect(payloadOf(host.beacons[0].body)).toEqual({ reports: [inp] });
    });

    // A string body makes `sendBeacon` set `text/plain;charset=UTF-8`, which is
    // CORS-safelisted. The fallback sets the same value explicitly so a collector cannot
    // tell the two transports apart — and so the cross-origin case never needs a
    // preflight the unloading document would not survive.
    it('labels the fallback request with the content type sendBeacon would have used', () => {
      const host = createFakeBeaconHost({ beacon: 'absent' });
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR, maxBatchSize: 1 });

      sink.record(report('TTFB', 120));

      expect(host.fetches[0].init?.headers).toEqual({ 'Content-Type': 'text/plain;charset=UTF-8' });
    });
  });

  describe('lifetime', () => {
    it('registers exactly one listener per page-lifecycle event', () => {
      const host = createFakeBeaconHost();
      createBeaconWebVitalsSink(host, { url: COLLECTOR });

      expect(host.listenerCount()).toBe(2);
    });

    it('sends what it is holding when disposed, then releases its listeners', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      sink.record(report('TTFB', 120));
      sink.dispose();

      expect(host.beacons.length).toBe(1);
      expect(host.listenerCount()).toBe(0);
    });

    it('stops answering the page-lifecycle events once disposed', () => {
      const host = createFakeBeaconHost();
      const sink = createBeaconWebVitalsSink(host, { url: COLLECTOR });

      sink.dispose();
      sink.record(report('TTFB', 120));
      host.dispatch('visibilitychange');

      expect(host.beacons).toEqual([]);
    });
  });

  /**
   * Under server-side rendering `DOCUMENT.defaultView` is `null`, and this factory runs
   * there — `provideWebVitalsBeacon` is in the shared `appConfig`, not the server one.
   * Nothing measures on the server, so nothing should be sent from it, and the failure
   * mode to avoid is a `TypeError` thrown while the injector builds a root provider.
   */
  describe('with no window', () => {
    it('records into nothing rather than throwing', () => {
      const sink = createBeaconWebVitalsSink(null, { url: COLLECTOR, maxBatchSize: 1 });

      expect(() => sink.record(report('TTFB', 120))).not.toThrow();
      expect(sink.flush()).toBe(false);
      expect(() => sink.dispose()).not.toThrow();
    });
  });

  /**
   * A partial window — a server-side DOM's `defaultView` — is the case optional chaining
   * on the view alone would miss: `view?.navigator.sendBeacon` guards the missing window
   * and not the missing property, which is a `TypeError` rather than a skipped call.
   */
  describe('with a window that has none of the members', () => {
    it('records into nothing rather than throwing', () => {
      const sink = createBeaconWebVitalsSink({}, { url: COLLECTOR, maxBatchSize: 1 });

      expect(() => sink.record(report('TTFB', 120))).not.toThrow();
      expect(() => sink.dispose()).not.toThrow();
    });
  });
});
