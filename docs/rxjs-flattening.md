# Flattening: `switchMap` vs `concatMap` vs `exhaustMap` vs `mergeMap`

Every one of these takes a stream of inputs, starts an inner stream per input, and
flattens the results back into one stream. They differ in exactly one thing: **what
happens when an input arrives while the previous inner stream is still running.**

That is the whole decision. It is not a style question — each answer is correct for some
flows and produces a specific, reproducible bug in the others.

## The decision, in one table

| A new input arrives, previous inner stream still running | Operator | In flight at once | Result order |
| --- | --- | --- | --- |
| Cancel the previous one, keep the new one | `switchMap` | 1 | latest input wins |
| Ignore the new one | `exhaustMap` | 1 | first input wins |
| Queue it; start it when the current one completes | `concatMap` | 1 | input order |
| Start it immediately, alongside | `mergeMap` | unbounded¹ | completion order |

¹ `mergeMap(project, n)` bounds it; at `n = 1` it *is* `concatMap`.

Two questions get you there:

1. **Must every input run?**
   - No → is the newest the one that matters (`switchMap`), or the first (`exhaustMap`)?
   - Yes → question 2.
2. **Does the order of the effects matter?** (Would running B before A leave a different
   world than A before B?)
   - Yes → `concatMap`.
   - No → `mergeMap`.

And the mirror image — what each wrong answer costs, using the two flows in this app:

| | Typeahead (`"a"`, `"an"`, `"ang"`) | Login submit (double click) |
| --- | --- | --- |
| `switchMap` | ✅ one answer, always the newest | ❌ aborts a `POST` the server may have committed |
| `exhaustMap` | ❌ shows results for `"a"`; later keystrokes dropped | ✅ the duplicate is ignored |
| `concatMap` | ❌ three requests, answer lags by their total latency | ⚠️ logs in twice, one after the other |
| `mergeMap` | ❌ three requests, whichever lands last wins the screen | ⚠️ two logins race for `localStorage` |

The typeahead row is not hypothetical: `"ang"` genuinely can come back after `"angular"`,
because request latency has nothing to do with typing order, and under `mergeMap` the
stale response overwrites the fresh one.
[`typeahead.spec.ts`](../src/app/core/reactivity/typeahead.spec.ts) lands the responses in
that order deliberately and asserts the newest one survives.

## What "cancel" actually means

`switchMap` cancels by **unsubscribing** from the inner Observable. Everything else
follows from that:

- **`HttpClient` aborts the request** when its last subscriber leaves, so a superseded
  search really does stop occupying a connection. Asserted, not assumed:
  [`posts.service.spec.ts`](../src/app/features/posts/posts.service.spec.ts) unsubscribes
  and expects `req.cancelled`.
- **The abort is client-side only.** For a `GET`, that is the end of it. For a write, the
  server may already have committed: cancelling a `POST /auth/login` un-issues nothing,
  it only throws away the response — and with it the tokens for a session that now
  exists. That asymmetry is the whole argument for `exhaustMap` on a submit.
- **A Promise has no teardown**, so `switchMap(() => somePromise)` cancels nothing; it
  only ignores the result. This is why
  [`PostsService.search`](../src/app/features/posts/posts.service.ts) is the one read in
  that service that stays an Observable while `getAll`/`getById` return Promises: its
  caller is a `switchMap`, and a Promise would quietly turn cancellation into a comment.

## Where this codebase does it

### `switchMap` — the typeahead

[`typeahead`](../src/app/core/reactivity/typeahead.ts) is the primitive;
[`PostTypeaheadComponent`](../src/app/features/posts/post-typeahead.component.ts) is its
caller. The core of it:

```ts
toObservable(query, { injector }).pipe(
  map((raw) => raw.trim()),
  debounceTime(debounceMs),
  distinctUntilChanged(),
  switchMap((term) =>
    term.length < minLength
      ? of(idle(term))
      : concat(of(searching(term)), search(term).pipe(map(ready), catchError(failed)))
  ),
  takeUntilDestroyed(destroyRef)
);
```

Order inside the pipe matters as much as the operator does:

- **`debounceTime` before `switchMap`.** `switchMap` alone already yields the right
  answer, but it issues — and cancels — one request per keystroke. Debouncing first means
  a fast typist costs one request. The two solve different problems and neither replaces
  the other.
- **`distinctUntilChanged` after the trim and after the debounce**, so it compares the
  terms that were actually going to be sent, and `"ng "` → `"ng"` is not a new search.
- **`catchError` on the inner Observable.** See the traps below — this is the one that
  bites hardest.

### `exhaustMap` — submits, and the token refresh

[`AuthStore.login` and `AuthStore.register`](../src/app/store/auth/auth.store.ts) ignore a
second submit while one is in flight. Both forms disable their button on `isLoading()`,
but that guard is a *rendered* one: under [zoneless](./zoneless.md) the `patchState` that
sets the flag schedules a refresh rather than performing one, so a double click inside a
single frame reaches the store twice. `exhaustMap` makes the store itself idempotent
under concurrent calls instead of trusting the view to be fast enough.

`AuthStore.refreshAccessToken` is the same shape for a different reason: two 401s should
produce one refresh, and the second refresh — issued with a token the first has already
rotated — would fail and log the user out.

Note the limit of that guarantee. `exhaustMap` dedupes **within one stream**. Concurrent
401s reach [`jwtInterceptor`](../src/app/core/http/interceptors/jwt.interceptor.ts) as
separate pipelines, so nothing in RxJS can see them as duplicates; that is what the
`isRefreshing` flag and the shared `BehaviorSubject` in that file are for. If you find
yourself hand-rolling that, check first whether the inputs could have been one stream.

### `concatMap` — no caller here, and what would earn one

Nothing in this app currently needs it, and inventing a caller to fill the table would be
worse than saying so. It earns its place when **every input must run** *and* **the effects
do not commute** — a queue of edits replayed against a document, a paginated fetch where
page N+1's cursor comes out of page N, a sequence of writes to the same row.

Before choosing it, check the drain rate. `concatMap` queues without bound: if inputs
arrive faster than the inner stream completes, the backlog grows forever and the visible
symptom is lag, not an error. A queue that can outrun its consumer wants `mergeMap` with
a concurrency limit, or backpressure the operator cannot supply.

### `mergeMap` — also absent, deliberately

Unbounded concurrency is rarely what a UI wants, and `mergeMap`'s result order is
whatever the network decides. Reach for it when the inputs are genuinely independent and
you want them overlapping — parallel uploads, fan-out reads — and pass a concurrency
limit when the source can burst.

### When the choice does not matter

`jwtInterceptor` chains `switchMap` twice on streams that emit exactly once. With one
input there is no overlap, so all four operators behave identically and the choice is
documentation rather than behaviour. `switchMap` is the conventional default there; say
so in review rather than "fixing" it.

## The four traps

**1. `catchError` on the outer stream kills the pipeline.** An error that reaches the
outer Observable terminates it, and a terminated stream does not restart: the box goes
permanently dead, and typically nobody notices until a user's first failed search.

```ts
// Wrong — one failure and the pipeline is over.
source.pipe(switchMap((t) => search(t)), catchError(() => of([])));

// Right — the failure is contained in the inner stream and modelled as a value.
source.pipe(switchMap((t) => search(t).pipe(catchError((err) => of(failed(err))))));
```

[`typeahead.spec.ts`](../src/app/core/reactivity/typeahead.spec.ts) asserts exactly this:
after a failed search, the next term still searches.

**2. `switchMap` over a write.** Cancelling a request is not undoing it. If the input can
fire twice for one user intention, `exhaustMap` (ignore the duplicate) or `concatMap`
(run both, in order) are the honest choices; which one depends on whether the second
intention is real.

**3. An `exhaustMap` whose inner stream never completes is a permanent block.**
`exhaustMap` starts accepting inputs again on inner *completion*. An inner stream that
emits and stays open — a `BehaviorSubject`, a socket, `interval` — means the first input
is the last one the pipeline will ever see. `take(1)` or `first()` on the inner stream is
the usual fix. `HttpClient` completes on its own, which is why it is not a problem above.

**4. Nothing here bounds retries.** `retry({ count })` sits *inside* the inner pipe, next
to `catchError`; put it outside and a retry re-subscribes the outer source instead.

## Inside a signal store

`rxMethod` from `@ngrx/signals/rxjs-interop` takes the pipe, so the operator choice lives
in exactly the same place — see `AuthStore`. The input is the argument stream: every call
to the method is one input, and concurrent calls are the overlap the operator resolves.
Reading `store.isLoading()` and returning early instead is the imperative spelling of
`exhaustMap`, and it races: the flag is set in a `tap` that has not necessarily run when
the second call arrives.

## Testing the choice

An operator choice is only three assertions, and each is worth writing separately:

1. **Which requests were issued.** `httpTesting.match(predicate).length`, or the probe's
   call list. Distinguishes `switchMap`/`mergeMap`/`concatMap` (all three issue every
   request) from `exhaustMap` (which does not).
2. **Which were cancelled.** `TestRequest.cancelled` — the only assertion that separates
   `switchMap` from `mergeMap`, since both issue every request and both end up rendering
   whichever answer arrives last *unless* the stale one was aborted.
3. **Which answer is on screen.** Land the responses out of order on purpose. Under
   `mergeMap` this test fails; under `switchMap` the stale response has nowhere to go.

Two mechanics worth knowing, both learned the hard way here:

- **Construct the component inside `fakeAsync`.** A component that builds its pipeline in
  its field initialisers hands the `toObservable` effect — and every timer `debounceTime`
  goes on to arm — to whatever zone constructed it. A fixture created in a plain
  `beforeEach` schedules them on the real clock, where `tick()` cannot reach them: no
  request is ever issued, and "expect no request yet" passes for the wrong reason.
  `TestBed.tick()` does not rescue it, because the flush it forces still runs outside the
  fake clock.
- **Settle responses by hand, not by `flush()`ing in arrival order.** The bug being
  prevented *is* an arrival order, so the spec has to be able to produce it.

## See also

- [`docs/rxjs-interop.md`](./rxjs-interop.md) — `toSignal` / `toObservable`, and which
  direction to convert in
- [`docs/signals.md`](./signals.md) — `resource` / `rxResource`, which wrap this same
  cancellation in a status API when what you want is one request per params change
- [RxJS: `switchMap`](https://rxjs.dev/api/operators/switchMap)
