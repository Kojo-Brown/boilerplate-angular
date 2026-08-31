# Interceptors as decorators, and composing them

An `HttpInterceptorFn` takes the handler beneath it and returns a handler. That is the
decorator pattern's signature exactly, and Angular's HTTP stack is a decorator chain
whether or not anyone calls it one: `provideHttpClient(withInterceptors([a, b, c]))`
wraps the transport in `c`, wraps that in `b`, wraps that in `a`.

Three decorators arrive with this item — retry, cache and telemetry — plus the two
combinators that let a chain be built out of pieces rather than written out flat.

---

## The combinators

`src/app/core/http/interceptors/compose.ts`

```ts
composeInterceptors(...interceptors): HttpInterceptorFn
interceptWhen(predicate, interceptor): HttpInterceptorFn
```

`composeInterceptors` is a right fold with `next` as the seed, in the same order
`withInterceptors` would have applied the same list — first argument outermost. What it
adds over that list is that the result is *itself* an `HttpInterceptorFn`, so a group of
decorators can be named, scoped, or provided in a lazy route as one thing.

It runs each inner interceptor through `runInInjectionContext`, and that is not
ceremony. Angular's own chain does the same, because an interceptor that defers its
`next()` call resumes on a later microtask:

```ts
// jwtInterceptor, waiting for a token refresh to finish
return refreshTokenSubject.pipe(
  filter((token): token is string => token !== null),
  take(1),
  switchMap((token) => next(withBearerToken(req, token)))
);
```

By the time that `switchMap` runs, the ambient injection context is gone. A naive fold
would hand the interceptor beneath it an `NG0203: inject() must be called from an
injection context` instead of a request — intermittently, only when a token happens to
be expiring. `compose.spec.ts` pins this with a deliberately deferring interceptor.

`interceptWhen` scopes a decorator to the requests a predicate accepts. It exists
because "which requests does this apply to?" belongs to the application and "what does
it do to them?" belongs to the decorator. `cacheInterceptor` should not have to know
this application talks to exactly one API, and an application that grows a second one
should not have to edit it.

## The chain, and why it is in that order

`app.config.ts`:

```ts
provideHttpClient(
  withInterceptors([
    telemetryInterceptor,
    loggingInterceptor,
    errorInterceptor,
    jwtInterceptor,
    interceptWhen(
      requestsUnder(environment.apiUrl),
      composeInterceptors(cacheInterceptor, retryInterceptor)
    ),
  ])
);
```

| Position | Decorator | Why there |
| --- | --- | --- |
| outermost | `telemetry` | Measures what the caller waited for — backoff and refresh queue included. Nothing below it can see either. |
| | `logging` | Dev console, inside telemetry so its own work never lands in the measurement. |
| | `error` | Normalises failures. Everything above it sees an `ApiError`; everything below still sees the `HttpErrorResponse` that `retryInterceptor` needs to read a status off. |
| | `jwt` | Owns the `Authorization` header and the 401 refresh queue. |
| | `cache` | Beneath `jwt`, so the request it keys on is the one that will actually be sent — credential included. |
| innermost | `retry` | Nearest the transport, so one *request* can be several *attempts*. |

Two of those positions are load-bearing enough to be worth spelling out.

**`cache` beneath `jwt`.** The default cache key is method, URL with query string, and
the `Authorization` header. Above `jwt` the header does not exist yet, so `/users/me`
would be a single slot shared by every identity the tab has held — and a sign-out
followed by a sign-in would serve the previous person's profile. Beneath it, the key
changes with the credential, which also means nothing needs to clear the cache on
logout: the anonymous request simply does not match the authenticated entry, and the
orphan ages out by TTL and LRU eviction.

**`retry` beneath `cache`.** Re-subscribing `next(req)` is what issues a second attempt,
so every decorator below the retry runs again per attempt and every one above it runs
once per request. That is the right split: a cache hit is never retried, and three
attempts write one cache entry and produce one telemetry span rather than three of each.
`decorator-chain.spec.ts` asserts exactly that.

`cache` and `retry` are scoped to this application's own API because neither is safe to
apply blind to an arbitrary URL. The cache would key a third party's endpoint by *our*
`Authorization` header, and the retry would decide on our behalf that another service's
503 is worth a second request.

## How the decorators talk to each other

A decorator only ever sees the layer directly beneath it. `retryInterceptor` has no way
to *return* "that took three attempts" to `telemetryInterceptor` four layers above — the
response it hands back is the same `HttpResponse` a first-attempt success would have
produced.

The `HttpContext` is the one thing every layer shares. `HttpRequest.clone()` passes it
through by reference, and `HttpContext.get` memoises its token's factory, so the object
one decorator mutates on the way down is the object another reads on the way back:

```ts
// request-trace.ts
export interface RequestTrace {
  retries: number;
  cache: CacheOutcome;
}
export const REQUEST_TRACE = new HttpContextToken<RequestTrace>(() => ({
  retries: 0,
  cache: 'bypass',
}));
```

Mutable, which is unusual enough to want a reason. Re-cloning the request with a new
context value loses every write made after the downstream call was issued — which is all
of them, since a decorator learns what it did on the way back up. A request-scoped
injector would work, and Angular's HTTP stack does not have one.

`bypass` and `miss` are separate outcomes on purpose. A cache hit rate of 0% because
nothing was ever cacheable is a different problem from 0% because everything expires
first, and telemetry that collapsed the two could not tell them apart.

## `retryInterceptor`

Policy comes from `RETRY_POLICY`, patched per request by a `RETRY_OVERRIDE` context
token. The default:

```ts
{
  maxRetries: 2,
  baseDelayMs: 300,
  maxDelayMs: 5_000,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  statuses: [0, 408, 425, 429, 500, 502, 503, 504],
  jitter: fullJitter,
}
```

`POST` and `PATCH` are absent by design. A request that timed out may well have been
received and applied, so retrying it risks a duplicate write; this codebase has no
idempotency-key mechanism to make that safe, and adding methods to that list without one
is how a retry decorator becomes a double-charge bug. `PUT` and `DELETE` are idempotent
by HTTP's definition but are left out too — that guarantee is the server's to keep, and
not every implementation does.

`jitter` is a policy field rather than a `Math.random()` call in the interceptor, for
the same reason `TOAST_SCHEDULER` and `TOAST_ID_FACTORY` are tokens: a spec substitutes
the identity function and asserts on exact delays. The default is "full jitter" — a
uniform draw from `[0, delay]` rather than `delay ± something` — because it spreads a
thundering herd's early retries across the whole window instead of the top half of it.

A `Retry-After` header outranks the computed backoff and is **not** jittered: the server
named a time, and spreading clients around it would put some of them back before it. It
is still clamped to `maxDelayMs`, or a misconfigured `Retry-After: 3600` on a 503 would
hang the request for an hour with nothing to distinguish it from a dead connection. Both
forms RFC 9110 allows are read — delta-seconds, which GitHub and Stripe send, and an
HTTP date, which a CDN serving a maintenance page usually sends.

`retryDelayMs` takes `now` as an argument rather than calling `Date.now()`, so the
HTTP-date branch is testable without moving the system clock.

## `cacheInterceptor`

**Nothing is cached by default.** A response is stored only when the server sends a
`Cache-Control: max-age`, or when the call site overrides that with an explicit
`{ ttlMs }`. Adding this decorator to an application whose API sends no cache headers
changes exactly one thing: two identical GETs issued at the same moment become one round
trip.

That is deliberate. A decorator that guessed a TTL would be inventing a freshness
guarantee nobody made, and its failure mode — a stale page after a write that
succeeded — looks like a bug in the write.

`no-store` and `no-cache` both mean "do not store" here. The second is a slight
over-reading: `no-cache` permits storage and requires revalidation first, and this cache
has no revalidation step — no conditional request, no `ETag` handling. Treating it as
"do not store" is the only reading that cannot serve a response the server said to
check.

In-flight deduplication uses `shareReplay({ refCount: true })`, so cancellation still
works: if every subscriber walks away — a component destroyed, a `switchMap` superseding
the request — the underlying request is aborted exactly as it would be without the
decorator. `finalize` then unregisters the key, so the next caller starts a fresh
request rather than subscribing to a torn-down stream.

Two things this cache does not do, both worth knowing before relying on it:

- A hit emits the `HttpResponse` alone, with no preceding `HttpEventType.Sent` — nothing
  was sent. A caller using `observe: 'events'` to drive an activity indicator should opt
  out with `{ bypass: true }`. `reportProgress` requests are bypassed automatically.
- A `Vary` response header is not honoured beyond the `Authorization` the default key
  already includes. An API that varies on `Accept-Language` needs an `HTTP_CACHE_KEY`
  that says so.

Responses are stored by reference and handed out by reference, so every hit shares one
body object. Callers must not mutate a response body — the same rule that already
applies to a body shared between two components subscribed to one request.

## `telemetryInterceptor`

Reports an `HttpSpan` to `HTTP_TELEMETRY_SINK` once a request has ended, whichever way it
ended. `finalize` rather than `tap`'s `complete`, because unsubscription is an ending too
and `tap` has no callback for it.

`cancelled` is its own outcome rather than a kind of error. Under a `switchMap` typeahead
or a component destroyed mid-flight it is the *expected* ending, and an error-rate
dashboard that counted those would report an incident every time someone typed quickly.

The span carries the URL **without** its query string. Query parameters carry search
terms, ids and whatever else a caller passed, and a telemetry sink is usually somewhere
the rest of the application's data is not.

The default sink discards everything. A boilerplate has no analytics backend to name, and
a default that guessed at one would either fail loudly in every application that has not
configured it or, worse, quietly send traffic somewhere. `consoleTelemetrySink` is
available for the case where the question is "which of these is slow" and standing up a
collector to answer it is disproportionate.

One sink, not a `multi: true` array — the deliberate contrast with `API_ERROR_MAPPERS` in
[docs/strategy-tokens.md](./strategy-tokens.md). Error mapping genuinely has several
implementations chosen at runtime by the data. Telemetry has one destination, and fanning
out to two collectors is one `record` that calls two others, written by the application
that has two. A multi-provider token would make every application pay for the array and
would quietly turn a second registration in a lazy route into a *replacement* of the
first.

## Seams

| Token | Default | For |
| --- | --- | --- |
| `RETRY_POLICY` | `DEFAULT_RETRY_POLICY` | Application-wide retry behaviour |
| `RETRY_OVERRIDE` (context) | `null` | One request that knows better |
| `HTTP_CACHE_CONFIG` | 100 entries, 5 min ceiling | Cache bounds |
| `HTTP_CACHE_KEY` | method + URL + `Authorization` | What makes two requests the same |
| `CACHE_OVERRIDE` (context) | `null` | `{ ttlMs }` or `{ bypass: true }` |
| `HTTP_TELEMETRY_SINK` | `noopTelemetrySink` | Where spans go |
| `HTTP_CLOCK` | `() => Date.now()` | Expiry and duration |

`HTTP_CLOCK` is one clock rather than a monotonic one for durations and a wall clock for
expiry, because a decorator cannot ask for "the other clock" and `Retry-After`'s date
form is only meaningful against wall time. Duration measurement inherits that choice's
one weakness: an NTP step mid-request skews that request's `durationMs`. An application
that cares more about durations than about `Retry-After` dates can provide
`() => performance.now()` instead — `retryDelayMs` takes its `now` as an argument, so the
two are separable.
