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
