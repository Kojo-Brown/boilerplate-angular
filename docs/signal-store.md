# `createSignalStore`: a store with a history you can walk

`createSignalStore` is a small signal-backed store where **every write carries a label
and lands in an ordered log**. That log is the feature. It buys two things a bare
`signal` cannot give you:

- **Time travel in the app** — `undo()`, `redo()`, `jumpTo(index)` over recorded states.
- **Time travel in the browser** — a bridge to the [Redux DevTools extension][ext], with
  the monitor's jump buttons driving the real store.

[ext]: https://github.com/reduxjs/redux-devtools

It lives in `src/app/core/store/`, and `ThemeService` is its production caller.

## When to reach for it — and when not to

This repo now has three ways to hold state. They are not interchangeable:

| Use | For | Why not the others |
| --- | --- | --- |
| `signal` / `computed` | Local component state, derived values | A history log for a dropdown's open flag is dead weight |
| `@ngrx/signals` `signalStore` | Global state with async work | `rxMethod`, entity helpers, store features, DI integration |
| `createSignalStore` | Small global state where *history* is the point | The other two have no answer for time travel |

`AuthStore` stays an `@ngrx/signals` store and should. Its value is `rxMethod` and the
flattening control that comes with it — see [docs/rxjs-flattening.md](./rxjs-flattening.md)
— and replaying a login backwards is not a thing anyone wants. `ThemeService` moved
because its state is durable, user-visible, and written by named actions, which is
exactly the shape a history log pays off on.

**`createSignalStore` is not a general-purpose store and does not try to be.** It has no
async story, no effects, no entity adapters. If you need those, use `signalStore`.

## The API

```ts
const store = createSignalStore<ThemeState>({ theme: 'light' }, {
  name: 'theme',        // DevTools instance name
  historyLimit: 25,     // entries kept; oldest dropped first
});

store.patch('theme/set', { theme: 'dark' });        // merge a partial
store.update('theme/toggle', (s) => ({ ... }));     // compute from current

store.state();          // Signal<ThemeState>
store.select('theme');  // Signal<Theme>, memoized per key
store.history();        // Signal<readonly Transition<ThemeState>[]>
store.cursor();         // index of the applied entry
store.canUndo();        // Signal<boolean>
store.canRedo();

store.undo();
store.redo();
store.jumpTo(2);
store.reset();          // back to the initial state, log cleared
store.commit();         // current state becomes the new baseline, log cleared

store.subscribe((event) => { ... });  // synchronous; returns an unsubscribe
```

Labels are free-form. The convention here is `slice/action` — `theme/toggle`,
`theme/set` — because that is what the DevTools log shows, and `set` alone in a list of
twenty entries tells you nothing.

## Four decisions worth knowing about

### History holds snapshots, not patches

Each entry carries the **whole state** after its transition. So `jumpTo` is an index
assignment, not a fold over every patch since the beginning, and a jump can never drift
from what a replay would have produced.

The cost is memory: `historyLimit × sizeof(state)`. That is why `historyLimit` exists and
defaults to a bounded 50 rather than growing for the life of the tab. Put big state in
here and you will feel it — which is the honest signal that big state does not belong in
here.

### Trimming shifts indexes, so ids are not indexes

Once the log is full, the oldest entry is dropped and **every index shifts down by one**.
`history()[0]` stops being the initial state. Anything that needs to name an entry across
time must hold `Transition.id`, which is monotonic and never reused.

This is not academic. It is the difference between a DevTools jump landing on the state
you clicked and landing on a neighbour, and it is why `reset()` keeps its own reference to
the initial state instead of being a synonym for `jumpTo(0)`.

### Writing while travelled truncates the redo tail

History is a line, not a tree. Jump back three steps, write, and the three entries ahead
of the cursor are discarded — otherwise `redo` would step into a future that no longer
follows from the present. This is the standard undo-stack rule and matches what every
editor does.

### `subscribe` is synchronous, and that is the point

The obvious way to notify a devtools bridge is an `effect` on `history()`. It is wrong:
**effects coalesce**. Two writes in one tick produce one effect run, and the bridge would
send one action where two happened. A log that silently drops actions is worse than no log
at all, because you trust it.

So the store notifies listeners synchronously, in order, one call per event. Listeners
must not write back to the store.

## DevTools

Install the [Redux DevTools extension][ext], run `pnpm start`, open the panel and pick the
`theme` instance. Toggling the theme appends `theme/toggle`; clicking an earlier row jumps
the real store, and the `dark` class on `<html>` follows.

Wiring is one guarded block, in `ThemeService`:

```ts
if (!environment.production) {
  void import('@/app/core/store/devtools').then(({ connectDevtools }) => {
    destroyRef.onDestroy(connectDevtools(this.store));
  });
}
```

The dynamic `import()` is load-bearing, not stylistic. It puts the bridge in its own lazy
chunk, and combined with the `environment.production` guard — which is a literal `true`
after `angular.json`'s file replacement — esbuild removes the branch and the chunk from a
production build entirely. Verified, not assumed:

```
$ pnpm build && grep -rl REDUX_DEVTOOLS dist/     # → no matches
$ ng build --configuration development            # → chunk-XXXX.js contains the bridge
```

Because that import resolves asynchronously, transitions can already be recorded when the
bridge connects. It replays what it finds — `init` with the oldest entry, one `send` per
entry after it — so the monitor opens on the store's real history rather than on whatever
was current when the chunk finished loading.

### Action ids are mapped, not assumed

The monitor numbers actions sequentially from its own `init`. The store numbers
transitions monotonically and trims old ones. The two sequences agree right up until the
first trim or `reset()`, after which an unmapped jump lands on the wrong state.

So the bridge keeps its own `sentIds` array in monitor order and resolves every jump
through it. A jump to an entry the store has since trimmed reports into the monitor via
`connection.error` rather than silently doing nothing or, worse, jumping somewhere
plausible.

### Monitor buttons

| Button | Effect |
| --- | --- |
| Jump / slider | `store.jumpTo` the mapped entry |
| Reset | `store.reset()` — back to initial, log cleared |
| Commit | `store.commit()` — current state becomes the baseline |
| Rollback | Back to the oldest entry held, then commit |
| Import | **Refused**, with a reason in the monitor |
| Dispatch | **Refused**, with a reason in the monitor |

The last two are refused deliberately rather than left unimplemented:

- **Import** uploads a session JSON. Honouring it means widening arbitrary parsed JSON
  into `T`. There is no runtime schema here to validate against, so it would take an
  unchecked cast capable of putting a shape into the store that no type in the app admits.
  This repo bans `any`; smuggling one in through the debug path is not a loophole worth
  having.
- **Dispatch** sends a hand-written action. Same problem, plus this store has no action
  registry to look a name up in — only labels attached to writes that already happened.

One real limitation, which no amount of care fixes: **programmatic travel does not move
the monitor's cursor.** `store.undo()` from app code changes the state correctly and the
log stays accurate, but the extension's protocol has no message for "the store moved", so
the highlighted row can lag. The DevTools buttons themselves are unaffected.

## Testing

`createSignalStore` injects nothing and owns no teardown — no timers, no subscriptions, no
effects — so `signal-store.spec.ts` uses **no `TestBed` at all**. If a store ever needs one,
that is a design smell rather than a test detail.

`connectDevtools` takes an `extension` option so a test can pass a fake in place of
`window.__REDUX_DEVTOOLS_EXTENSION__` and assert both directions: what the bridge sends,
and what the store does when the monitor sends back. See `devtools.spec.ts`.
