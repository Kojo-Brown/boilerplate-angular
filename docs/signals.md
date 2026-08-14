# Signal-based component state

How this codebase holds component state: `signal` for what the component owns,
`computed` for everything derivable from it, and `effect` only for the things that
have to happen *outside* the reactive graph — with a cleanup callback whenever the
effect acquires something that has to be released.

The reusable pieces live in [`src/app/core/reactivity/`](../src/app/core/reactivity)
and are re-exported from `@/app/core/reactivity`.

## Choosing between the three

| Need | Use | Why |
| --- | --- | --- |
| A value the component owns and mutates | `signal` | The only writable node. Keep it `private` and expose `asReadonly()` when callers should go through a method. |
| A value that is a pure function of other signals | `computed` | Lazy, memoised, and re-evaluated only when a dependency it actually read changes. Never needs cleanup. |
| A value the component owns, that something upstream has to *reset* | `linkedSignal` | Writable like a `signal`, recomputed from its source like a `computed`. Replaces the reset-only effect. |
| A value that has to be fetched | `resource` | Owns the request lifecycle — loading, error, and cancellation of a load that has been superseded. |
| A write to something the graph does not own — DOM, `localStorage`, an analytics call, a timer, a subscription | `effect` | Runs after the flush, re-runs when its dependencies change, and can register cleanup. |
| A subscription whose lifetime is the component's, with nothing reactive about it | `DestroyRef.onDestroy` | An effect with no dependencies runs once and exists only to hold a teardown callback. Say what you mean. |
| An RxJS stream | `toSignal` / `takeUntilDestroyed` | Covered separately in the RxJS interop section of `SPEC.md`. |

The rule that decides most cases: **if you can write it as a `computed`, it is not an
effect.** An effect that only copies one signal into another is a slower, harder to
debug `computed` that also runs one flush late.

```ts
// Don't: a derived value smuggled through an effect.
readonly fullName = signal('');
constructor() {
  effect(() => this.fullName.set(`${this.first()} ${this.last()}`));
}

// Do:
readonly fullName = computed(() => `${this.first()} ${this.last()}`);
```

## Cleanup semantics

`effect` hands its callback an `onCleanup` register function:

```ts
effect((onCleanup) => {
  const handle = setTimeout(() => this.expired.set(true), this.ttlMs());
  onCleanup(() => clearTimeout(handle));
});
```

Two things run that cleanup:

1. **The next run of the same effect.** Cleanup fires *before* the new run, so the
   previous timer, subscription, or request is already gone by the time the
   replacement is created. This is what makes `debouncedSignal` debounce rather than
   fire once per keystroke, and what stops `intervalSignal` from running two
   overlapping timers when its period changes.
2. **Destruction of the injector that owns the effect** — the component's, by default.
   Effects created in an injection context register themselves with the ambient
   `DestroyRef`; you do not call anything to opt in. `manualCleanup: true` opts out,
   and then the `EffectRef.destroy()` is yours to call.

Anything that survives its component leaks the component with it: a `setInterval`
callback closing over `this` keeps the instance, its signals, and its DOM references
reachable for the life of the page.

### Effects outside an injection context

`effect()` needs an injector. Inside a field initializer or constructor it finds one
implicitly. Anywhere else — a lifecycle hook, an event handler, a promise callback —
pass one explicitly, which is why every primitive here takes `{ injector }`:

```ts
private readonly injector = inject(Injector);

onSearchOpened(): void {
  this.debouncedTerm = debouncedSignal(this.term, 300, { injector: this.injector });
}
```

## The primitives

### `debouncedSignal(source, delayMs)`

A read-only signal that trails `source` and settles once it has been quiet for
`delayMs`. The initial value is available synchronously; only changes are delayed.

```ts
readonly term = signal('');
readonly debouncedTerm = debouncedSignal(this.term, 300);
readonly results = computed(() => this.index.search(this.debouncedTerm()));
```

Each change cancels the timer armed by the previous one — the cancellation *is* the
debounce. Destroying the component cancels the last one, so a pending update cannot
land in a component that is gone.

### `intervalSignal(period)`

A counter that increments once per `period`, starting at `0`. Derive from it rather
than storing a timestamp:

```ts
private readonly tick = intervalSignal(1_000);
readonly elapsed = computed(() => formatDuration(this.tick()));
```

`period` may itself be a signal. Changing it tears the old timer down before arming
the new one, and `null` pauses the clock without resetting the count:

```ts
private readonly visible = mediaQuerySignal('(prefers-reduced-motion: no-preference)');
private readonly tick = intervalSignal(computed(() => (this.visible() ? 1_000 : null)));
```

### `mediaQuerySignal(query)`

Tracks a CSS media query, so breakpoint-dependent state is derived instead of
recalculated in a resize handler:

```ts
readonly isDesktopViewport = mediaQuerySignal('(min-width: 768px)');
```

Note what it is *not*: an effect. `query` is a plain string, so an effect around the
subscription would have no reactive dependencies — it would run exactly once and exist
only to carry an `onCleanup`. `DestroyRef.onDestroy` states that directly. Where the
resource genuinely has to be re-acquired as a signal changes, the effect is the right
tool; see the other two primitives.

`LayoutShellComponent` uses it for a case `computed` cannot express: crossing to a
desktop viewport resets `isMobileDrawerOpen`, which the user also writes to. A one-way
reset of state with two writers is a side effect, not a derivation.

## Dependent state with `linkedSignal`

`linkedSignal` is the missing middle of the table above: a signal you can write to, that
a source signal resets. Reach for it the moment you catch yourself writing an effect
whose entire body is `this.something.set(<constant>)`.

```ts
readonly isDesktopViewport = mediaQuerySignal('(min-width: 768px)');

readonly isMobileDrawerOpen = linkedSignal<boolean, boolean>({
  source: this.isDesktopViewport,
  computation: (): boolean => false,
});
```

`LayoutShellComponent` is the production caller, and it is worth reading as a before /
after. It used to hold the drawer flag in a `signal` and reset it from an effect:

```ts
// Before.
readonly isMobileDrawerOpen = signal(false);
constructor() {
  effect(() => {
    if (this.isDesktopViewport()) this.isMobileDrawerOpen.set(false);
  });
}
```

Both versions close the drawer when the viewport crosses the breakpoint. The
`linkedSignal` is better on three counts:

1. **It is not a write into the graph.** The effect wrote one signal from another, which
   the section above calls out as the thing effects should not be doing. That it also
   had to stay writable is exactly why it could not simply become a `computed`.
2. **It settles immediately.** An effect runs on the flush *after* its dependency
   changes, so anything reading the flag in between saw a stale `true`. The linked
   computation is evaluated on read, like a `computed`.
3. **Reset and default are one expression.** The initial value and the reset value used
   to be written in two places that could drift; now there is a single computation.

Three things to know before reaching for it:

- **The reset fires on every source change**, not on a condition you pick. The version
  here resets on the way down through the breakpoint as well as on the way up; that is
  fine because the flag is unreadable above it. If you genuinely need "reset only when
  X becomes true", you need the effect.
- **Annotate the computation's return type.** `computation: () => false` infers
  `WritableSignal<false>`, and every `set(true)` in the component stops compiling. The
  explicit `(): boolean` in the snippet above is load-bearing.
- **Source equality gates the reset.** A source that re-emits an equal value does not
  reset anything, which is what keeps an open drawer open while the viewport is merely
  resized within the same breakpoint.

The two-argument form — `linkedSignal({ source, computation })` — also hands the
computation the previous source and value, which is how you carry state across a reset
(keeping a selected row if it still exists in the new page of results, say).

## Async state with `resource()`

`resource()` models an asynchronous read as signals: a reactive `params` function
decides *what* to load, a `loader` does the loading, and the result is exposed as
`value()` / `error()` / `status()` / `isLoading()`.

```ts
export function injectPostResource(id: Signal<string>): ResourceRef<Post | undefined> {
  const postsService = inject(PostsService);

  return resource({
    params: () => id() || undefined,
    loader: ({ params, abortSignal }) => postsService.getById(params, abortSignal),
  });
}
```

`PostDetailComponent` is the production caller. Its route input feeds `params`, so
navigating from one post to another re-loads without any subscription bookkeeping.

### Cancellation, and the part that is not automatic

The loader is handed an `AbortSignal` that Angular aborts when the params change or the
owning injector is destroyed. What it does with it is up to you — and the obvious
implementation quietly does nothing:

```ts
// Wrong. `lastValueFrom` throws the subscription away, and unsubscribing is the only
// cancellation `HttpClient` understands. The request runs to completion regardless.
loader: ({ params }) => lastValueFrom(this.api.get<Post>(`/posts/${params}`)),
```

`abortableRequest` from `@/app/core/reactivity` is the bridge: it keeps the subscription
and drops it when the signal fires, resolving exactly like `lastValueFrom` otherwise.
`PostsService` awaits its reads through it, which is why `getById` and `getAll` take an
optional `AbortSignal` and the mutations do not — aborting a write the server may have
already acted on is not a cancellation, it is a lost result.

Without a wired-up abort you keep the *stale-response* protection (a resource discards
the result of a load it has superseded) but lose the *request* cancellation: every
keystroke or click leaves an open connection to be paid for.

### Reading the state

`status()` moves through `idle → loading → resolved | error`, with `reloading` and
`local` for reloads and local writes. Two traps:

- **`value()` throws in the error state.** Check `error()` — or `hasValue()` — first.
  The template in `PostDetailComponent` orders its branches loading → error → value for
  exactly this reason.
- **`idle` is not `loading`.** `params` returning `undefined` never calls the loader,
  which is how "no id yet" is expressed — the resource equivalent of a query's `enabled`
  flag. `isLoading()` is `false` there, so a template that only checks `isLoading()`
  renders its empty state instead of a skeleton.

### `resource()` or TanStack Query?

Both ship here on purpose: `PostDetailComponent` uses a resource, `PostsListComponent`
uses `injectPostsQuery`.

| | `resource()` | TanStack Query |
| --- | --- | --- |
| Comes from | `@angular/core` | a dependency |
| Caching | none — one resource, one value, gone with its owner | keyed cache shared across components, with `staleTime` and background refetch |
| Invalidation | `reload()` on the instance you hold | `invalidateQueries` by key, from anywhere |
| Mutations | out of scope by design | first class, with optimistic updates |

Rule of thumb: **a resource is component state that happens to be async.** When the
value belongs to one screen and dies with it, `resource()` is less machinery and one
fewer dependency. When two components need the same server data, or a mutation has to
invalidate it, the cache is the whole point — use the query.

## Testing

- `TestBed.tick()` flushes pending effects. `TestBed.flushEffects()` is deprecated in
  Angular 22; specs written before this document still use it.
- `fixture.detectChanges()` runs a component's effects as part of change detection.
- Wrap timer-based specs in `fakeAsync` and drive them with `tick(ms)`. This doubles as
  the cleanup assertion: `fakeAsync` fails a spec that ends with a timer still queued,
  so "the interval was cleared on destroy" needs no spy — destroy the fixture, advance
  the clock, and let the zone check the queue.
- `installFakeMediaQuery()` from `@/testing` replaces `window.matchMedia` with a
  registry the spec drives, and reports the live listener count so teardown can be
  asserted rather than assumed.
- For a `resource`, `TestBed.tick()` only starts the load — the loader's promise still
  has to resolve. Wait on `ApplicationRef.whenStable()` (or `fixture.whenStable()`),
  which resolves once the pending task the resource registered has cleared. Counting
  `await Promise.resolve()` turns instead encodes Angular's internals in the spec and
  breaks on the next minor version.
- `HttpTestingController` makes cancellation directly assertable: `TestRequest.cancelled`
  flips when the request is unsubscribed, so "changing the params aborted the in-flight
  request" is one expectation rather than a spy on the transport. `verify()` ignores
  cancelled requests, so an aborted load does not fail the teardown check.
- A `linkedSignal` needs no flush at all. Change the source, read the signal — if a spec
  needs `detectChanges()` in between, it is testing change detection, not the reset.

```ts
it('clears a pending timer when the owning component is destroyed', fakeAsync(() => {
  const fixture = createHost();
  fixture.componentInstance.term.set('b');
  fixture.detectChanges();

  fixture.destroy();
  tick(300);

  expect(fixture.componentInstance.debouncedTerm()).toBe('a');
}));
```
