# Zoneless change detection

This app runs without ZoneJS. `app.config.ts` provides
[`provideZonelessChangeDetection()`](../src/app/app.config.ts), the build's `polyfills`
array in [`angular.json`](../angular.json) is empty, and `zone.js` is a devDependency —
it is used by the test bundle only, for the reason in [Testing](#testing).

```
Initial bundle    raw        transfer (estimated)
with ZoneJS       579.05 kB  155.28 kB
zoneless          543.60 kB  143.63 kB
                  −35.45 kB  −11.65 kB
```

The bundle is the smaller half of the point. The larger half is that change detection
becomes something the code asks for explicitly instead of something a monkey-patched
`setTimeout` decides on its behalf.

## What schedules a refresh now

ZoneJS patched every async browser API and ran change detection whenever any of them
settled — correct by brute force, and the reason a single stray `setInterval` could
re-check the entire component tree many times a second. Zoneless replaces that with a
fixed set of notifications. Angular refreshes when, and only when:

- a **signal read in a template** changes value;
- a **bound template or host listener** fires — `(click)`, `(ngSubmit)`, and the
  `(input)`/`(blur)` host listeners that `ControlValueAccessor` registers for you;
- `ChangeDetectorRef.markForCheck()` is called;
- `ComponentRef.setInput()` sets an input;
- a view marked dirty by one of the above is **attached**, or any view is **removed**;
- the `async` pipe receives a value — it calls `markForCheck()` itself, and `toSignal()`
  writes a signal, which is why RxJS keeps working without ceremony either way.

Notice what is *not* on that list: a promise resolving, a `setTimeout` firing, an
`addEventListener` callback, an `XMLHttpRequest` completing, or a third-party library
invoking a callback. Those still run — nothing is patched, so nothing is slowed — they
just do not, by themselves, cause a re-render.

## The one migration rule

**State that a template reads must live in a signal, or the code that changes it must
say so.** Everything below follows from that.

```ts
// Breaks under zoneless: the field changes, the template never hears about it.
export class StatusComponent {
  status = 'idle';
  constructor() {
    setTimeout(() => (this.status = 'ready'), 1000);
  }
}

// Works: the signal write is the notification.
export class StatusComponent {
  readonly status = signal('idle');
  constructor() {
    setTimeout(() => this.status.set('ready'), 1000);
  }
}
```

`app.config.spec.ts` pins both halves of this as executable documentation: a signal
write refreshes the view, a plain-field write does not, and the stale field is picked
up by whatever refresh happens next — Angular was never refusing to read the field, it
was never told to look.

### When a signal is genuinely the wrong shape

Reach for `markForCheck()` only when the state cannot be a signal — most often an
object owned by a third-party library that you render through directly.

```ts
private readonly cdr = inject(ChangeDetectorRef);

chart.on('update', () => {
  this.cdr.markForCheck();
});
```

If you find yourself writing this more than occasionally, the state wants to be a
signal and the wrapper wants to be a `computed`.

### Getters over non-signal state

Getters are re-evaluated on every refresh, so they are not broken by zoneless — they
are only as fresh as the last refresh. Reactive forms used to be read that way here:

```ts
// Was in login.component.ts. Reads `control.touched` and `control.errors`, neither of
// which is a signal.
protected get emailError(): string | null {
  const control = this.form.get('email');
  if (!control?.invalid || !control.touched) return null;
  return (control.errors?.['zod'] as string | undefined) ?? null;
}
```

That worked for as long as everything changing a control's state arrived through a
bound listener: typing fires the value accessor's `(input)` host listener, blurring
fires `(blur)`, and submitting fires `(ngSubmit)` — each of which marks the view dirty.
A control mutated from outside that path — `markAllAsTouched()` from a timer, an async
validator settling, `setErrors` from a server response — had nothing to mark it, and
the message rendered late or not at all.

Which is a boundary problem, not a getter problem: a control publishes its state on
`AbstractControl.events`, an Observable, and no one had brought it into the graph.
`controlSignal` / `controlErrorSignal` from `@/app/core/reactivity` do, with `toSignal`,
and both auth forms now use them. See [`docs/rxjs-interop.md`](./rxjs-interop.md).

The general rule stands: a getter over non-signal state is fine when *every* writer of
that state already marks the view dirty. Check that before relying on it — and prefer
a signal when the state has a stream behind it.

### Async work that has to block stability

`ApplicationRef.whenStable()`, SSR serialization, and `fixture.whenStable()` need to
know when the app is busy. Zoneless tracks this through `PendingTasks` instead of
ZoneJS's macrotask queue. `HttpClient` and the router register their own; register
yours when you own an async operation that a test or the server has to wait for:

```ts
private readonly pendingTasks = inject(PendingTasks);

async load(): Promise<void> {
  await this.pendingTasks.run(() => this.thirdPartySdk.fetchEverything());
}
```

## Testing

Tests run zoneless too. Without that, the suite would be exercising a scheduler the app
does not use, and the one bug class this migration introduces — state a template reads
that nothing notifies Angular about — is exactly the class such a suite cannot see.

Angular's Karma builder synthesises a test entry point that checks for `window.Zone`
and, finding it, adds `provideZoneChangeDetection()`. So the suite is pointed at
[`src/testing/test-main.ts`](../src/testing/test-main.ts) via the `main` option in
`angular.json` instead. It does one thing: initialise the testing platform with a
module that provides `provideZonelessChangeDetection()`, so every spec is zoneless
with nothing to opt into per file.

That module is the one `@NgModule` in the repo. `TestBed.initTestEnvironment()` takes
an NgModule type and has no providers-only overload, so platform-level providers have
no other expression. It contains no declarations and never reaches the application.

**ZoneJS is still loaded in the test bundle**, and deliberately: `fakeAsync()` and
`tick()` are implemented against `Zone['fakeAsyncTest']` and throw
`"zone-testing.js is needed for the fakeAsync() test helper"` without it. Two spec
files use them to virtualise time — the debounce window in
[`debounced-signal.spec.ts`](../src/app/core/reactivity/debounced-signal.spec.ts) and
the interval period in
[`interval-signal.spec.ts`](../src/app/core/reactivity/interval-signal.spec.ts).
`jasmine.clock()` is not a substitute for either: it does not flush the microtasks that
Angular's effect scheduler runs on, and it has no equivalent of the end-of-spec leaked
-timer check that both files use to prove their cleanup actually clears a pending
timer. So ZoneJS stays as a timer implementation while Angular schedules zonelessly.
Angular notices the combination and logs it once per injector:

```
WARN: 'NG0914: The application is using zoneless change detection, but is still
loading Zone.js. …'
```

In `pnpm test` output that warning is expected and refers to the test bundle only. The
production build carries no ZoneJS at all, which is enforced rather than assumed — see
below.

Two consequences for writing specs:

- **Hold host-component state in signals.** `host.variant.set('secondary')` marks the
  view dirty; `host.variant = 'secondary'` does not, and the assertion then reads
  stale DOM and fails as if the component were broken.
- **Prefer `await fixture.whenStable()` to `fixture.detectChanges()`** for anything
  asynchronous. It drains the scheduler the app actually uses, rather than forcing one
  synchronous pass that may run before the work it is waiting on.

## What stops ZoneJS coming back

Neither half of this configuration fails loudly on its own, so each has a check:

| Regression | Caught by |
| --- | --- |
| `provideZoneChangeDetection()` back in `app.config.ts` | [`app.config.spec.ts`](../src/app/app.config.spec.ts) — `NgZone.isInAngularZone()` inside `zone.run()` becomes true, and the two refresh assertions flip |
| `"zone.js"` back in the build `polyfills` | [`scripts/ci/assert-no-zonejs.sh`](../scripts/ci/assert-no-zonejs.sh) — greps the emitted bundles for ZoneJS's `__load_patch` registrar, wired into the CI build job |

The second check reads the build output rather than `angular.json` on purpose: with
ZoneJS in the polyfills and zoneless providers in place, the app still works and every
test still passes. The only symptom is 35 kB of monkey-patched browser APIs nobody
asked for, which no gate would otherwise notice.

## Adapting this template

1. Replace `provideZoneChangeDetection()` with `provideZonelessChangeDetection()`.
2. Empty the build's `polyfills` array in `angular.json`; move `zone.js` to
   devDependencies.
3. Point the Karma builder at a `main` that initialises a zoneless testing platform,
   then run the suite. Failures cluster on plain fields mutated from callbacks —
   convert them to signals.
4. Exercise the app in a browser, not just in tests. Third-party widgets are the
   usual survivors: they were being re-rendered by ZoneJS patching their internal
   timers, and nothing in a unit test replicates that.
5. Add the two checks above, or the migration will quietly rot back.

## See also

- [`docs/signals.md`](./signals.md) — the signal/computed/effect decision table this
  migration rests on
- [`docs/rxjs-interop.md`](./rxjs-interop.md) — getting Observable-backed state, reactive
  forms included, into the graph in the first place
- [Angular: Zoneless](https://angular.dev/guide/zoneless)
