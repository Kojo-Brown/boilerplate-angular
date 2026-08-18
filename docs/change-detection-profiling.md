# Change detection profiling

The rule: **every production component in this app is `OnPush`.** The convention
is stated in [`CLAUDE.md`](../CLAUDE.md), and enforced by
[`scripts/ci/assert-onpush-everywhere.sh`](../scripts/ci/assert-onpush-everywhere.sh)
in the `lint` CI job. Test host components inside spec files are deliberately
excluded — they never ship, and when a test is *about* change detection,
forcing them OnPush would change what the test observes.

This document is the *why* and the *how to measure* behind that rule.

## Why OnPush, under zoneless

The naïve reading of "we are zoneless, so change detection only runs when we
ask" is that OnPush is redundant. It is not.

Zoneless changes **what schedules a refresh**. See
[`docs/zoneless.md`](./zoneless.md) for the full list — signal writes read in a
template, template and host listeners, `markForCheck()`, `setInput()`, the
`async` pipe, and view attach/remove.

OnPush changes **how much of the tree that refresh checks**. When Angular
runs a change-detection cycle, it walks the view tree from a "root" it picks
by looking at which views are marked dirty. For a `Default` component, every
descendant view is checked on every cycle whether or not it changed. For an
`OnPush` component, Angular skips its subtree unless the component is itself
dirty — dirty meaning:

- one of its `@Input`s or signal inputs got a new value,
- a signal read from its template changed,
- one of its template or host listeners fired,
- something called `markForCheck()` (or the `async` pipe did on its behalf),
- a view under it was attached or removed.

So under zoneless the two strategies schedule the same set of cycles. OnPush
just skips the work of re-checking bindings whose inputs are provably
unchanged. On a large route this is the difference between "check the seven
things that actually changed" and "check the whole route because one leaf
did."

## How to profile

Two answers, at two altitudes.

### 1. Angular DevTools Profiler — the default tool

Install the [Angular DevTools](https://angular.dev/tools/devtools) browser
extension. Open the app, open DevTools → **Angular** → **Profiler**, press
**Start recording**, take the action you want to measure, press
**Stop recording**.

What each panel is telling you:

- **Bar chart of cycles.** Each bar is one change-detection cycle. Height is
  wall time for the cycle. A single interaction that produces one bar is
  usually fine; a single interaction that produces a *stack* of bars means
  something scheduled another refresh from inside the first (typically an
  `effect` writing a signal that another template already read).
- **Flame graph inside a bar.** Each box is a component checked in that cycle.
  Width is time spent in `ngDoCheck` + template bindings + `ngAfterContentChecked`
  + `ngAfterViewChecked` for that component. A wide box high in the tree is
  where OnPush usually pays for itself — the widest common ancestor of the
  parts that actually changed is where the cycle should have stopped.
- **"Change detection skipped" annotations.** Under an OnPush component that
  did not change, DevTools shades the subtree and labels it "skipped." When
  you convert a Default component to OnPush, this is the immediate visible
  win: subtrees that used to render as full flame branches turn into flat
  skipped strips.
- **Source of the cycle.** The label above the bar names what triggered it —
  the signal, the DOM event, or `applicationRef.tick()`. A cycle labelled
  with a signal name that fires more often than you expected is usually the
  problem, not the components under it.

For a routed app the useful recording length is one full interaction — click
a menu item, wait for the destination to render, stop. Longer than that and
the flame graphs are unreadable.

### 2. In-code counter — for numbers you can commit to a PR

DevTools numbers are only reproducible on the machine that recorded them. For
"this change makes route X do N fewer refreshes per second" claims that
survive a code review, the counter goes in the code.

The pattern uses `afterRenderEffect` (Angular 22's post-render callback) plus
a plain `signal` for the count. Because it runs *after* Angular finishes a
cycle, incrementing the counter does not cause another cycle.

```ts
// src/app/core/reactivity/cd-counter.ts (illustrative — not shipped)
import { afterRenderEffect, DestroyRef, inject, signal } from '@angular/core';

/**
 * Counts the change-detection cycles that touched this component's view.
 * `read()` returns the running total; `reset()` clears it. Intended for
 * temporary in-flight profiling, not a production dependency.
 */
export function cdCounter() {
  const count = signal(0);
  afterRenderEffect(() => {
    count.update((n) => n + 1);
  });
  inject(DestroyRef).onDestroy(() => count.set(0));
  return { read: count.asReadonly(), reset: () => count.set(0) };
}
```

Use it around the interaction under test:

```ts
export class PostsListComponent {
  private readonly cd = cdCounter();

  onFilterChanged() {
    this.cd.reset();
    // trigger the interaction …
    // some ticks later …
    console.log('CD cycles that touched this view:', this.cd.read()());
  }
}
```

The counter reflects *this component's* cycles, not the app's. That is
usually the number worth citing: "the filter change used to check `PostsList`
14 times; after moving the filter into a signal read from the template, it
checks 1."

### 3. `ApplicationRef.isStable` — for "did anything schedule more work"

`ApplicationRef.isStable` is a boolean stream that reports `true` when
Angular has no pending change-detection work and `false` while a cycle is
queued. Under zoneless it is the closest thing to an app-wide profile of
"how often is something scheduling a refresh."

```ts
import { ApplicationRef, inject } from '@angular/core';
import { pairwise } from 'rxjs';

const appRef = inject(ApplicationRef);
appRef.isStable.pipe(pairwise()).subscribe(([prev, next]) => {
  if (prev && !next) {
    console.log('cycle scheduled at', performance.now().toFixed(0));
  }
});
```

An interaction that logs one entry per user event is healthy. An interaction
that logs a burst is the same signal DevTools would show as a stack of bars.

## Recommended workflow

1. **Baseline** — with a clean tree, record one Profiler run of the
   interaction you care about and count cycles + widest box.
2. **Measure the target component in code** with `cdCounter` around the
   interaction. Copy the number into the PR description.
3. **Change one thing** — usually converting a `getter` in the template to a
   `computed`, or a plain field write inside a callback to a `signal.set`.
4. **Re-measure**. Both the DevTools cycle count and the `cdCounter` reading
   should drop. If they do not, the change is not doing what it claims.
5. **Delete the counter** before opening the PR — it is a probe, not a
   dependency. The DevTools recording is enough for the review.

## Common wins, ranked

1. **A getter that runs on every check.** `{{ heavyDerivation() }}` in a
   template is called once per binding per cycle. Replace with a `computed`
   and it runs once per input change.
2. **An `effect` writing a signal another template reads.** That effect ran
   after the first cycle, and its write scheduled a second one. Rewrite as a
   `computed` — no second cycle, no double render.
3. **A `Default` component high in the tree.** The gate above catches this
   for new code. For an existing route, look at the flame graph's root box:
   if it says "checked" and it is your app shell, that is the cheapest fix
   with the largest effect.
4. **Rendering large arrays without `track`.** `@for` without a stable
   `track` expression re-creates every child view when the array reference
   changes, even under OnPush. `track item.id` — see
   [Angular's guide](https://angular.dev/guide/templates/control-flow#track).
