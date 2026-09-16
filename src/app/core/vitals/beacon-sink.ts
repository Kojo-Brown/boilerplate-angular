import type { FlushableWebVitalsSink } from './web-vitals-sink';
import type { WebVitalReport } from './web-vitals.model';

/**
 * The slice of `Window` a beacon needs, as a structural type.
 *
 * A real `Window` satisfies it, so the production call is
 * `createBeaconWebVitalsSink(inject(DOCUMENT).defaultView, …)` with no cast — and a spec
 * can build the three or four members it wants to exercise without standing up a DOM or
 * monkey-patching the page the test runner is itself running in. `QueryLike<T>` in
 * `shared/directives` is the same move for the same reason.
 *
 * Every member is optional, which is not defensiveness: under server-side rendering
 * `DOCUMENT.defaultView` is either `null` or a partial window, and `view?.navigator.sendBeacon`
 * guards against the missing *window* and not the missing *property* — the exact
 * `TypeError` `storageOf` exists to prevent, one object over.
 */
export interface BeaconHost {
  readonly navigator?: {
    sendBeacon?(url: string, data?: string): boolean;
  };
  readonly document?: {
    readonly visibilityState?: string;
  };
  fetch?(input: string, init?: BeaconFetchInit): Promise<unknown>;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

/** The `fetch` options the fallback transport sets. Narrowed from `RequestInit` so a fake host stays small. */
export interface BeaconFetchInit {
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly keepalive?: boolean;

  /**
   * The literal union and not `string`, so that a real `Window` satisfies
   * {@link BeaconHost}.
   *
   * `Window.fetch` is declared as a property rather than a method, which means its
   * parameters are compared contravariantly instead of bivariantly: widening this to
   * `string` makes `BeaconFetchInit` something `RequestInit` cannot accept, and the
   * assignment in `provideWebVitalsBeacon` stops compiling. Worth writing down because
   * the error it produces points at `fetch` and names `credentials` eight lines down.
   */
  readonly credentials?: 'omit' | 'same-origin' | 'include';
}

export interface WebVitalsBeaconOptions {
  /** Where the batch is POSTed. */
  readonly url: string;

  /**
   * Send once this many reports are queued, without waiting for the page to hide.
   *
   * Defaults to `5`, the number of metrics one page load produces, so the common case is
   * exactly one request. Lowering it to `1` trades requests for the guarantee that
   * nothing is lost to a tab the operating system kills without a lifecycle event.
   */
  readonly maxBatchSize?: number;
}

/** The five metrics of one page load. See {@link WebVitalsBeaconOptions.maxBatchSize}. */
const DEFAULT_MAX_BATCH_SIZE = 5;

/**
 * What both transports send, and the reason the body is JSON in a `text/plain` envelope.
 *
 * `sendBeacon` with a string body sets exactly this, and the point is that it is one of
 * the three CORS-safelisted content types. Labelling the same bytes `application/json`
 * makes a cross-origin POST preflightable, and a preflight issued from
 * `visibilitychange` is precisely the round trip that does not finish: the browser is
 * free to discard the document before the `OPTIONS` response arrives, and the beacon goes
 * with it. The `fetch` fallback sets the header explicitly so a collector cannot tell the
 * two transports apart.
 */
const BEACON_CONTENT_TYPE = 'text/plain;charset=UTF-8';

/** The wire format. One request carries every report the sink was holding. */
export interface WebVitalsBeaconPayload {
  readonly reports: readonly WebVitalReport[];
}

/**
 * A sink that batches reports and ships them with `navigator.sendBeacon`, falling back to
 * `fetch(…, { keepalive: true })`.
 *
 * ## Why batching, and why it flushes when it does
 *
 * With the default reporting cadence the five metrics do not arrive together: TTFB and
 * FCP settle in the first second, while LCP, CLS and INP are only *final* when the page
 * is hidden, because until then a later element can still paint, shift, or be clicked. So
 * a sink that sent on every `record` would issue five requests for five numbers, and a
 * sink that only sent early would miss the three worth having.
 *
 * Flushing on hide is therefore not an optimisation — it is the only moment at which the
 * interesting metrics exist. `pagehide` is listened for alongside `visibilitychange`
 * because the two are not redundant: a tab switch fires `visibilitychange` and never
 * `pagehide`, while a bfcache-eligible navigation fires `pagehide` and — in Safari,
 * historically — not reliably `visibilitychange`.
 *
 * ## The ordering hazard this is built not to have
 *
 * `web-vitals` reports LCP, CLS and INP from *its own* `visibilitychange` listener. Two
 * listeners on one event have an order, and that order is registration order per target
 * and phase — which here depends on when a lazy chunk happened to finish loading. If ours
 * ran first we would flush an empty queue and then receive three reports on a document
 * that is being discarded, with nothing left to send them.
 *
 * Rather than assume an order, the sink remembers that the page has been hidden and sends
 * immediately on any `record` that arrives afterwards. Both orders then work, and the
 * spec asserts both:
 *
 * - ours first — flushes what is queued, and each late report sends on arrival;
 * - theirs first — the reports queue, and our flush sends them in one request.
 *
 * ## What it deliberately does not do
 *
 * No retry, and no queue that outlives the page. A beacon that failed did so because the
 * document is going away; the next best thing after "send it now" is not "send it later",
 * it is nothing. Persisting a batch to `localStorage` for the next page load is a real
 * design — with its own decisions about staleness, clock skew and the session it would
 * then be attributing to — and a different one, not a flag on this.
 */
export function createBeaconWebVitalsSink(
  host: BeaconHost | null,
  options: WebVitalsBeaconOptions
): FlushableWebVitalsSink {
  const maxBatchSize = Math.max(1, options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE);

  let queued: WebVitalReport[] = [];

  // Seeded from the page's current state rather than `false`: a sink constructed while
  // the document is already hidden — a tab restored into the background, a prerender —
  // must not queue its first report behind a hide event that has been and gone.
  let pageHidden = host?.document?.visibilityState === 'hidden';

  const onHide = (): void => {
    pageHidden = true;
    send();
  };

  host?.addEventListener?.('visibilitychange', onHide);
  host?.addEventListener?.('pagehide', onHide);

  function send(): boolean {
    if (queued.length === 0) return false;

    const payload: WebVitalsBeaconPayload = { reports: queued };
    queued = [];

    const body = JSON.stringify(payload);
    return sendBeacon(body) || sendKeepaliveFetch(body);
  }

  function sendBeacon(body: string): boolean {
    const navigator = host?.navigator;
    if (navigator?.sendBeacon === undefined) return false;

    try {
      // Called through its owner rather than as a detached function: `const send =
      // navigator.sendBeacon; send(…)` is an "Illegal invocation" TypeError in every
      // browser, because the method needs its `this`.
      return navigator.sendBeacon(options.url, body);
    } catch {
      // A malformed URL throws here rather than returning `false`. Falling through to
      // `fetch` is right either way: it will fail too, asynchronously, instead of taking
      // a `visibilitychange` handler down with it.
      return false;
    }
  }

  function sendKeepaliveFetch(body: string): boolean {
    if (host?.fetch === undefined) return false;

    try {
      // `keepalive` is what makes this outlive the document. Without it the request is
      // cancelled the moment the page unloads, which is the only moment it runs.
      //
      // `credentials: 'omit'` because a collector has no business receiving this origin's
      // cookies, and sending them would make the request preflightable for a second
      // reason on top of the content type.
      //
      // The rejection is swallowed rather than logged: this runs on a page that is going
      // away, and an unhandled rejection from a dying document is noise in someone else's
      // error tracker.
      void host
        .fetch(options.url, {
          method: 'POST',
          body,
          headers: { 'Content-Type': BEACON_CONTENT_TYPE },
          keepalive: true,
          credentials: 'omit',
        })
        .then(
          () => undefined,
          () => undefined
        );
      return true;
    } catch {
      return false;
    }
  }

  return {
    record(report: WebVitalReport): void {
      queued.push(report);
      if (pageHidden || queued.length >= maxBatchSize) send();
    },
    flush: send,
    dispose(): void {
      send();
      host?.removeEventListener?.('visibilitychange', onHide);
      host?.removeEventListener?.('pagehide', onHide);
    },
  };
}
