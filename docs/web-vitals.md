# Core Web Vitals: measuring the page load, and getting the numbers out

Every other performance gate in this repository measures the *artifact*: how many
kilobytes a route costs, whether a `@defer` block still splits its chunk, whether the
initial bundle has grown. All of them run on a build agent with a fast disk and no
network, and none of them can tell you that the largest image on the dashboard takes
four seconds to paint on a phone in a lift.

This is the other half. `src/app/core/vitals/` measures the five metrics the browser
itself computes during a real page load and hands them to a sink.

```
core/vitals/
  web-vitals.model.ts      the wire shape — what a collector receives
  subscribe-web-vitals.ts  the seam over the `web-vitals` library
  web-vitals-sink.ts       where reports go: the token, the no-op, the console sink
  beacon-sink.ts           the transport: batching, sendBeacon, keepalive fetch
  provide-web-vitals.ts    the wiring, and the route attribution
```

---

## 1. What is measured, and why these five

| Metric | What it is | Final when |
| --- | --- | --- |
| **LCP** | Largest Contentful Paint — when the biggest thing above the fold appeared | the page is hidden, or the first interaction |
| **INP** | Interaction to Next Paint — the slowest interaction, near enough | the page is hidden |
| **CLS** | Cumulative Layout Shift — how much the page moved under the reader | the page is hidden |
| **FCP** | First Contentful Paint — when *anything* appeared | early |
| **TTFB** | Time to First Byte | early |

The first three are the Core Web Vitals proper. FCP and TTFB are here as diagnostics,
because LCP on its own does not say what to fix: a 4-second LCP behind a 3-second TTFB is
a server or a network, and the same LCP behind a 400 ms FCP is one image or one font.

**FID is absent because it no longer exists.** It was removed from the Core Web Vitals in
March 2024 and dropped from `web-vitals` in v5. It measured only the delay before the
first interaction's handler began running, so a page whose handler then blocked the main
thread for a second scored perfectly. INP replaced it and measures the whole interaction,
through to the next paint.

Measuring is not our code. `web-vitals` v6 handles the parts that are genuinely hard —
CLS's session windows, INP's percentile over the interactions of a page, discarding
metrics for a page that was hidden before they occurred, re-reporting after a
back/forward-cache restore — and a hand-rolled `PerformanceObserver` would get some subset
of that right and quietly differ from what Chrome's field data reports.

---

## 2. The library is loaded late, on purpose

`SUBSCRIBE_WEB_VITALS`'s default factory is the only place the library is named, and it
names it in a dynamic `import()`:

```ts
factory: () => async (onReport) => {
  const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals');
  onCLS(onReport); onFCP(onReport); onINP(onReport); onLCP(onReport); onTTFB(onReport);
},
```

That gives it its own chunk — **8.80 kB raw, 3.02 kB transferred** — instead of a place in
the 565 kB initial bundle. The reason is not the kilobytes. An analytics library
downloaded during page load competes for bandwidth and main-thread time with the page
whose load it is measuring, and makes the numbers it reports worse. Measuring the thing
should not move the thing.

`provideWebVitals` then registers the subscription from `afterNextRender` rather than
from the app initializer that contains it, so even the request for that chunk is issued
after the first paint. An initializer runs *before* the browser has painted anything,
which is precisely the window LCP is about to be measured in.

Arriving late is almost free, because `web-vitals` registers every `PerformanceObserver`
with `buffered: true`: entries the browser recorded before the chunk landed are still
delivered. v6 also reconstructs the page's first-hidden time from
`performance.getEntriesByType('visibility-state')`, so a metric that should have been
discarded still is.

**The case where it is not free** is a page abandoned within the first few hundred
milliseconds — a visitor who hits back immediately, or a bot. The chunk never arrives, no
observer is ever registered, and that page load is not reported at all. This biases the
dataset towards sessions that lasted long enough to be measured. It is the same bias any
deferred analytics has, it is worth knowing about when a p75 looks too good, and the fix
if it ever matters is to stop deferring and pay the 3 kB in the initial bundle.

### The chunk no budget watches

`pnpm check:routes` prices a route by walking the `import()` chain out of a `*.routes.ts`
file. The vitals chunk is reached from eager application code, not from a route, so it
appears in no route's total — and being lazy, it is not in the `initial` total either. An
8.80 kB chunk that every page load downloads is therefore invisible to both gates.

Left as it is rather than gated. Its size is a property of a pinned dependency version,
so it can only change in a version bump, which is a visible line in a diff — unlike the
failures those gates exist for, which are all *silent*. Recorded here so that the next
person reading the route table knows the cold-start column is 8.80 kB light.

---

## 3. What a page-load metric means in a routed application

This is the part that is specific to a single-page application, and the part that is
easiest to get quietly wrong.

**A Core Web Vital belongs to a page load, not to a route.** The browser starts measuring
at navigation and stops at the first hide. In between, the Angular router can move
someone through four screens without a single page load. LCP is the largest paint of the
*document*, which in practice means the first screen; CLS accumulates across every route
the session touched; INP is the slowest interaction anywhere in it.

So every report carries two paths:

| Field | Read from | Means |
| --- | --- | --- |
| `entryPath` | `DOCUMENT.location.pathname`, in the app initializer | the URL the document was requested at |
| `path` | `Router.url`, when the metric settled | where the user was standing at the end |

`entryPath` is the attribution key — every metric from one page load carries the same
value. It is read in the initializer, which runs *before* the router's first navigation,
and that timing is the whole point: by the time anything renders, `authGuard` may already
have replaced `/dashboard` with `/login`, and a page load that was abandoned on the
dashboard would be filed against the sign-in page.

`path` is only ever different for INP and CLS, and for those the difference is the useful
part. An INP of 600 ms reported from `/dashboard/activity` on a page load that entered at
`/login` is a slow interaction on the activity table — not on the sign-in form, which is
where a single-path report would have pinned it.

Before the router's first navigation, `path` falls back to `entryPath`. `Router.url` is
`'/'` until then, and `'/'` is a real route in this application rather than a null value,
so a TTFB that settles during bootstrap would otherwise be reported as a metric for the
home page.

Both are stripped of query string and fragment, the same call `HttpSpan.url` makes: a
query string carries search terms, ids, and the token in a password-reset link, and a
vitals collector is usually somewhere the rest of the application's data is not.

### Soft navigations, and why they are not used

Chrome has an experimental Soft Navigations API that reports a router navigation as a
navigation, giving per-route LCP and CLS. `web-vitals` supports it behind
`{ reportSoftNavs: true }`, and `Metric` carries `navigationId`, `navigationURL` and
`navigationStartTime` for it.

Not opted into. It is behind a flag, it is Chromium-only, and the heuristic for what
counts as a soft navigation is still moving — so it would produce a metric that exists for
some visitors and not others, silently, which is worse than a metric that is honest about
being per-document. Those three fields are absent from `WebVitalMetric` for the same
reason: they would be `undefined` on every report this application produces.

### The spread that would have leaked the page

`WebVitalMetric` declares six fields. The object `web-vitals` hands over has ten, and the
four it does not declare are the expensive ones — `entries`, the live `PerformanceEntry`
objects the measurement was derived from, plus the three soft-navigation fields above.

A subset type is a compile-time fact and nothing more. `{ ...metric }` copies what is
*there*, so the first version of `provideWebVitals` put a whole
`PerformanceNavigationTiming` into every TTFB beacon and, for LCP, an entry naming the URL
of the element that painted — which on an image-heavy page is a third-party CDN URL,
leaving the application's origin, with the type system raising no objection whatsoever.

The reporter copies the six fields by name instead. Two specs hold it there: one asserts
against the real library that the extra properties exist, and one emits a metric carrying
a decoy `entries` and asserts that what reached the sink has exactly eight keys.

---

## 4. Where reports go

The sink interface is deliberately the same shape as `HttpTelemetrySink` — one method, no
lifecycle, nothing to await:

```ts
export interface WebVitalsSink {
  record(report: WebVitalReport): void;
}
```

`record` is called from a `PerformanceObserver` callback and from a `visibilitychange`
handler on a page that is being torn down, so it must return promptly and must not throw.
There is no caller in a position to handle either.

`WEB_VITALS_SINK` defaults to `noopWebVitalsSink`, which discards. That is the same call
`HTTP_TELEMETRY_SINK` makes and for the same reason: a boilerplate has no collector to
name, and a default that guessed at one would send every downstream application's field
data somewhere its author never chose.

It is a single token rather than a `multi: true` array. An application with two collectors
writes one `record` that calls two others; a multi-provider token would make every
application pay for the array, and would turn a second registration in a lazy route into a
silent *replacement* of the first — see `docs/strategy-tokens.md`, where that hazard is
worth accepting and here it is not.

`app.config.ts` picks between two sinks on `environment.vitalsUrl`:

```ts
environment.vitalsUrl === ''
  ? { provide: WEB_VITALS_SINK, useValue: consoleWebVitalsSink }
  : provideWebVitalsBeacon({ url: environment.vitalsUrl }),
```

Both checked-in environments leave it empty, so the shipped default prints in development
and is silent in production, and nothing is sent anywhere. The comparison is a build-time
constant, so the branch not taken is dropped by the bundler rather than shipped unused.

---

## 5. The beacon

`createBeaconWebVitalsSink` batches reports and ships them with `navigator.sendBeacon`,
falling back to `fetch(…, { keepalive: true })`.

### Why it flushes when it does

The five metrics do not arrive together. TTFB and FCP settle in the first second; LCP, CLS
and INP are only *final* when the page is hidden, because until then a later element can
still paint, shift, or be clicked. A sink that sent on every `record` would issue five
requests for five numbers. A sink that only sent early would miss the three anyone
actually asks about.

So the flush is on hide, with a batch size of 5 as a ceiling. `pagehide` is listened for
alongside `visibilitychange` because the two are not redundant: a tab switch fires
`visibilitychange` and never `pagehide`, while a bfcache-eligible navigation fires
`pagehide` and — in Safari, historically — not reliably `visibilitychange`.

### The ordering hazard it is built not to have

`web-vitals` reports its three late metrics from *its own* `visibilitychange` listener.
Two listeners on one event have an order, and that order is registration order per target
and phase — which here depends on when a lazy chunk finished loading, i.e. on the network.

If ours ran first we would flush an empty queue and then receive three reports on a
document that is being discarded, with nothing left to send them with. That is a data-loss
bug that appears only on some page loads and never in a test.

Rather than depend on an order, the sink remembers that the page has been hidden and sends
immediately on any `record` that arrives afterwards. Both orders then work:

- **ours first** — the flush sends whatever is queued, and each late report sends on
  arrival, one request each;
- **theirs first** — the reports queue, and our flush sends them in one request.

Both are asserted. The same flag is seeded from `document.visibilityState` at
construction, so a sink built while the page is already hidden — a tab restored into the
background — does not queue its first report behind a hide event that has been and gone.

### `text/plain`, holding JSON

`sendBeacon` with a string body sets `Content-Type: text/plain;charset=UTF-8`, and that is
one of the three CORS-safelisted values. Labelling the same bytes `application/json` makes
a cross-origin POST preflightable — and a preflight issued from `visibilitychange` is
precisely the round trip that does not finish, because the browser is free to discard the
document before the `OPTIONS` response arrives. The beacon goes with it.

The `fetch` fallback sets the header explicitly so a collector cannot tell the two
transports apart, and sends `credentials: 'omit'`: a collector has no business receiving
this origin's cookies, and sending them would make the request preflightable for a second
reason.

### What it deliberately does not do

**No retry, and no queue that outlives the page.** A beacon fails because the document is
going away. The next best thing after "send it now" is not "send it later", it is nothing.
Persisting a batch to `localStorage` for the next page load is a real design — with its
own decisions about staleness, clock skew, and which session it would then be attributing
to — and a different one, not a flag on this.

**No timer.** Early metrics sit in the queue until the page hides, which is one request per
page load and the recommended shape. The failure mode is a tab the operating system kills
without firing either lifecycle event; `maxBatchSize: 1` trades requests for that
guarantee if an application wants it.

---

## 6. Testing something that cannot be provoked

LCP cannot be produced in a unit test. It is whatever the browser decided the largest
paint was, it is not final until the page is hidden, and Karma's page is never hidden.

`SUBSCRIBE_WEB_VITALS` is what makes the rest testable. Overriding it with a function that
keeps the handler lets a spec produce an INP of 3 000 ms on demand and assert on what came
out of the sink — the field mapping, the route attribution, the batching, the flush — which
is all of this application's own behaviour. What is left unasserted is the library's
correctness, which is its own suite's job.

The default token still gets one spec of its own, against the real library, because
nothing else would notice `web-vitals` moving its entry point or renaming an export: a
dynamic import is not a compile error until the chunk is actually loaded. It asserts on
TTFB, the one metric whose arrival is a property of a document that has finished loading
rather than of anything a suite does.

`BeaconHost` is a structural type — a real `Window` satisfies it, so the production call
takes `inject(DOCUMENT).defaultView` with no cast, and a spec can build the four members
it needs. That is what lets the transport be tested at all: the suite can hide the page,
fail a `sendBeacon`, or remove `fetch` entirely without touching the document Karma is
itself running in.

Every member of `BeaconHost` is optional, which is not defensiveness. Under server-side
rendering `DOCUMENT.defaultView` is either `null` or a partial window, and
`view?.navigator.sendBeacon` guards against the missing *window* and not the missing
*property* — the exact `TypeError` `storageOf` exists to prevent, one object over. See
`docs/ssr.md`.

One existing spec had to change: `app.config.spec.ts` bootstraps the real configuration
many times over, and with the real subscriber in place each of those runs registered a
fresh set of `PerformanceObserver`s and page-lifecycle listeners that no `TestBed`
teardown removes — they belong to the page, not to the injector — which then reported
against Karma's own document as the suite ended. It stubs the token now, next to the
`localStorage.clear()` that is there for the same class of reason.

---

## 7. Reading the numbers

Two fields exist to stop a dashboard lying to itself.

`id` identifies the metric *instance*, not the report. A back/forward-cache restore
produces a second LCP for the same document with a fresh id, and a collector keyed on
`name` alone would overwrite the first.

`navigationType` is what tells those restores apart. A bfcache restore downloads, parses
and executes nothing, so its LCP and TTFB are an order of magnitude better than a real
load. Averaged in without distinction they flatter every percentile — quietly, and more so
the better the site's caching gets. Query them apart, or exclude them; `prerender` and
`restore` have the same property for the same reason.

`rating` is carried on the wire rather than derived by the collector, because the
thresholds move. It is a property of the metric's definition at the time of measurement,
and a dashboard that re-derives it retroactively re-scores its own history every time the
web platform publishes a new number.
