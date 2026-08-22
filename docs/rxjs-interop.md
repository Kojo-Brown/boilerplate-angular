# RxJS interop

Signals and Observables answer different questions. A signal holds **a value you can
read right now**; an Observable describes **a sequence of things that happen over
time**. Most interop bugs are a conversion made because the two were treated as the
same thing in different clothing.

The two bridges live in `@angular/core/rxjs-interop`:

- `toSignal(observable)` — Observable → Signal
- `toObservable(signal)` — Signal → Observable

Everything below is about when to reach for them, and — more often — when not to.

## Choosing a direction

| You have | You need | Use |
| --- | --- | --- |
| An Observable | A value the template renders | `toSignal` |
| An Observable | A side effect (navigate, focus, log, close a drawer) | `.pipe(takeUntilDestroyed()).subscribe()` |
| An Observable of HTTP | Loading/error state and cancellation | `rxResource` |
| A signal | Time-based operators: debounce, `switchMap`, `retry`, `withLatestFrom` | `toObservable` |
| A signal | To satisfy an API typed `Observable` or `Promise` — a guard, a resolver, `rxMethod` | `toObservable` |
| A signal | A derived value | `computed`. Not this document. |
| Both, in a store | A signal-triggered effect pipeline | `rxMethod` from `@ngrx/signals/rxjs-interop` |

The rule underneath the table: **convert at the edge, in the direction the consumer
demands, and only once.** A value that goes signal → Observable → signal has picked up
an extra flush of latency and an extra subscription to leak, and the pipeline in the
middle is usually a `computed` that has not admitted it yet.

## `toSignal`: Observable → Signal

### Where this codebase does it

Reactive forms. A control publishes its state on `AbstractControl.events` and is
otherwise invisible to the reactive graph: `control.touched` is a plain property, so a
`computed` reading it never re-runs and a template reading it is only as fresh as the
last refresh — which, [under zoneless](./zoneless.md), may never come.

[`controlSignal`](../src/app/core/reactivity/control-signal.ts) is the bridge, and
[`controlErrorSignal`](../src/app/core/reactivity/control-signal.ts) the shorthand both
auth forms use:

```ts
protected readonly emailError = controlErrorSignal(this.form.controls.email, 'zod');
// template: @if (emailError()) { <p>{{ emailError() }}</p> }
```

This is `toSignal`'s home ground: the stream carries **a value the view renders**, and
the view wants the latest one, not the history.

Two details worth copying:

- **The event is a trigger, not the value.** `events` says *that* something changed;
  the state is then read off the control. Bridging each property separately
  (`toSignal(control.valueChanges)`, `toSignal(control.statusChanges)`, …) gives you
  several signals that update on different events and disagree in between.
- **`events` has no replay**, so the initial value comes from reading the control, not
  from the stream. Any `Subject`-backed source has this property; a `BehaviorSubject`
  or a `shareReplay(1)` does not.

### The four traps

**1. The initial value is `undefined`.** `toSignal(source)` is `Signal<T | undefined>`
because nothing has been emitted yet. Say what you want instead of widening every
consumer:

```ts
toSignal(source)                                 // Signal<T | undefined>
toSignal(source, { initialValue: [] })           // Signal<T | never[]>
toSignal(source, { requireSync: true })          // Signal<T>, throws NG601 if async
```

`requireSync: true` is right for a `BehaviorSubject` or anything `shareReplay(1)`-ed and
wrong for HTTP — it is an assertion, and the runtime error it throws is the point.

**2. It subscribes immediately, not on first read.** Unlike `computed`, `toSignal` is
eager: the subscription is made where the call is, so a cold Observable's side effect —
an HTTP request — fires whether or not anything reads the signal. That is also why it
cannot miss an early emission.

**3. Errors are re-thrown on read, forever.** A source that errors makes the signal
throw that error on every subsequent read, including from a template. `toSignal` has no
error state; if the stream can fail, catch inside the pipe and model the failure as a
value (or use `rxResource`, which has `error()`):

```ts
toSignal(source.pipe(catchError(() => of(null))), { initialValue: null });
```

**4. It unsubscribes with its injector, so it needs one.** Called outside an injection
context it throws NG0203. Pass `{ injector }` — every primitive in
`@/app/core/reactivity` takes one for this reason — or `{ manualCleanup: true }` and own
the teardown.

### When *not* to convert

- **Side effects.** A stream you subscribe to for its effect is not a value, and
  wrapping it in `toSignal` produces a signal nobody reads, which then needs an `effect`
  to observe — two nodes in the graph to express one subscription.
  `LayoutShellComponent` closes the drawer on `NavigationEnd` and stays a subscription
  for exactly this reason:

  ```ts
  inject(Router)
    .events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed()
    )
    .subscribe(() => this.isMobileDrawerOpen.set(false));
  ```

- **HTTP you want loading and error state for.** `toSignal(http.get(...))` gives you the
  value and nothing else: no `isLoading`, no `error`, no cancellation of a superseded
  request. `rxResource` (or `resource` — see [`docs/signals.md`](./signals.md)) is the
  same conversion with the state you were about to hand-roll.

- **A stream you only need once.** A one-shot answer is a `Promise`, or a
  `firstValueFrom`. A signal implies something reads it repeatedly.

## `toObservable`: Signal → Observable

### Where this codebase does it

[`authGuard`](../src/app/core/guards/auth.guard.ts). On a hard reload the store restores
the tokens from `localStorage` synchronously, but `isAuthenticated` also requires the
user behind them, and that is an HTTP round trip — started by the `provideAppInitializer`
in [`app.config.ts`](../src/app/app.config.ts), which does not block bootstrap. So the
router's first navigation runs its guards while the answer is still unknown, and a guard
that read the signal alone would redirect a signed-in user to `/login` on every refresh
of a guarded route.

```ts
if (authStore.isAuthenticated()) return true;
if (!authStore.isRestoringSession()) return redirectToLogin();

return toObservable(authStore.isRestoringSession).pipe(
  filter((isRestoring) => !isRestoring),
  take(1),
  map((): boolean | UrlTree => (authStore.isAuthenticated() ? true : redirectToLogin()))
);
```

Both halves of the table's second `toObservable` row apply at once. `CanActivateFn` is
a **one-shot API**: it takes an Observable and waits for the first value, and a signal
could only ever hand it whatever happened to be true at the moment of the call. And
"the first settled answer, then stop" is `filter` + `take(1)` — there is no signal
spelling of it, because a signal has no notion of "later".

`take(1)` completing the stream is what disposes the effect `toObservable` created, so
the guard leaves nothing running behind it.

The other caller is the table's *first* `toObservable` row:
[`typeahead`](../src/app/core/reactivity/typeahead.ts) converts its query signal because
`debounceTime` and `switchMap` have no signal spelling — a signal has no "quiet for
300ms", and cancelling the request a superseded keystroke started is a subscription being
torn down, which is not something a `computed` can express. There the conversion is
disposed by `takeUntilDestroyed` rather than by the stream completing; see
[`docs/rxjs-flattening.md`](./rxjs-flattening.md) for why that pipe is `switchMap`.

### The three traps

**1. It emits asynchronously, on the effect flush.** `toObservable` watches the signal
with an `effect`, so even the current value arrives after the microtask queue drains —
subscribing does not synchronously hand you `signal()`. Read the signal if you want the
value now.

**2. It replays the current value on subscribe.** The stream starts with where the
signal is, not with its next change. The guard above relies on this being *filtered
out*: it subscribes while `isRestoringSession` is `true`, and treating that first
emission as an answer would defeat the wait. If you want changes only, `skip(1)`.

**3. Equality gates emissions, and it needs an injector.** A signal `set` to an equal
value produces no emission — which is usually what you want, and surprising if you were
expecting one event per write. And like every effect, the one underneath needs an
injection context or an explicit `{ injector }`.

### When *not* to convert

- **To derive a value.** `toObservable(a).pipe(map(f))` re-entering the graph through
  `toSignal` is `computed(() => f(a()))` with two subscriptions and a flush of latency.
- **To watch for a change.** An `effect` already runs when its dependencies change, and
  is cleaned up with its injector.
- **Inside an NgRx signal store.** `rxMethod` accepts a signal as its argument and does
  the conversion internally, re-running the pipeline on every change. `AuthStore`'s
  `login`, `loadCurrentUser` and `refreshAccessToken` are all `rxMethod`s, so a
  signal-driven caller never needs `toObservable` to reach them.

## Testing across the boundary

- **`toSignal`**: nothing special — drive the source and read the signal. A source
  bridged in a component still needs `await fixture.whenStable()` before asserting on
  the DOM, because the refresh it triggers is scheduled, not synchronous.
- **`toObservable`**: the effect has to flush before anything is emitted. `TestBed.tick()`
  does it; `expect` immediately after a `set` sees nothing.
  [`auth.guard.spec.ts`](../src/app/core/guards/auth.guard.spec.ts) collects emissions
  into an array and asserts on the array *after* the flush, which also makes "emitted
  exactly once" — the `take(1)` contract — directly assertable.
- **Assert the non-emission too.** The guard's most important property is that it does
  *not* answer while the session is unknown. That is a spec that flushes and expects an
  empty array, and it is the one that fails if the `filter` is dropped.

## See also

- [`docs/rxjs-flattening.md`](./rxjs-flattening.md) — once you have converted a signal to
  an Observable for `switchMap`, which flattening operator that should have been
- [`docs/signals.md`](./signals.md) — `signal` / `computed` / `effect` / `linkedSignal`
  / `resource`, and the decision table this one hangs off
- [`docs/zoneless.md`](./zoneless.md) — why a value a template reads has to reach the
  graph at all
- [Angular: RxJS interop](https://angular.dev/ecosystem/rxjs-interop)
