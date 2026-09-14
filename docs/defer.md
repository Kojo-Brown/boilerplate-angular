# `@defer`: triggers, prefetching, and the failure nobody sees

`@defer` moves a block of template — and the code behind it — out of the chunk its host
lives in, and loads it when a trigger fires. `DashboardComponent` is this application's
worked example, with three blocks and three triggers:

| Block                    | Trigger                                | Prefetch          | Placeholder      |
| ------------------------ | -------------------------------------- | ----------------- | ---------------- |
| `app-insights-panel`     | `on viewport`                          | `on idle`         | shared skeleton  |
| `app-insights-breakdown` | `on interaction(breakdownTrigger)`     | `on hover(ref)`   | none — see below |
| `app-release-notes`      | `on timer(4s)`                         | `on idle`         | none — deliberate |

Each component's own file argues for its trigger. This document is about the parts that
are not obvious from any one of them.

## The failure mode: a `@defer` block that defers nothing

The Angular compiler emits a **dynamic** import for a component whose only uses in a
template are inside `@defer` blocks, and an ordinary **static** import otherwise. There is
no diagnostic for crossing that line, and crossing it is easy:

```html
@defer (on viewport) {
  <app-insights-panel />
} @placeholder {
  <app-insights-panel />   <!-- ← the block now loads eagerly -->
}
```

Also enough to do it: rendering the component once outside the block, naming it in
`@error`, or importing a *value* from its file — a constant, a helper, an enum used at
runtime — anywhere in eager code.

What makes this worth a CI gate rather than a code-review note is how completely silent it
is. Deleting the placeholder above and re-running `pnpm build` was measured while writing
this document:

```
$ pnpm build     # correct
chunk-BxceUr6B.js   | insights-panel-component     |   3.18 kB
                    | Initial total                | 561.47 kB

$ pnpm build     # component also named in the @placeholder
                    | Initial total                | 561.47 kB
```

No warning, no named chunk, and **the initial-bundle budget does not move** — because the
dashboard is itself behind a lazy route, so the code went from one lazy chunk to another.
Every spec still passes; the page still works. The only thing that changed is that the
panel now downloads for every session that opens the dashboard.

`pnpm check:defer` (`scripts/ci/assert-deferred-chunks.mjs`) is what notices. It reads the
bundler's own metafile and, for each block declared in its `DEFERRED_BLOCKS` list, asserts
three things:

1. the component's source is in a different output chunk from its host's;
2. the host's chunk cannot reach the component's through **any chain of static imports** —
   which is what "deferred" means, and is stricter than "the chunk is lazy";
3. the host's chunk *does* dynamically import it, so a deleted block fails here rather than
   passing as trivially-deferred.

A lint rule could not do this: whether a symbol is deferred is a property of the compiled
template plus the whole module graph around it, not of any one file's syntax. Adding a
`@defer` block means adding an entry to that list.

### Barrel files, which are the same mistake one step removed

A deferred component should be imported from its own file, not from an `index.ts`. The
emitted dynamic import targets the module the symbol was imported *from*, so deferring
`PanelSkeletonComponent` through `@/app/shared/ui` would put the button, the dialog, the
toast service and the layout shell in the deferred chunk with it. That is why
`dashboard.component.ts` reaches for
`@/app/shared/ui/skeleton/panel-skeleton.component` directly while the barrel still
re-exports it for everyone else.

## Choosing a trigger

Triggers are additive: `@defer (on viewport; on timer(10s))` loads on whichever fires
first. `prefetch` is a separate clause with the same trigger vocabulary, and it decides
when the *code* is fetched rather than when the block is *shown*.

| Trigger              | Fires when                                        | Reach for it when                                                  |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `on idle` (default)  | the main thread goes quiet (`requestIdleCallback`) | you want the content eventually and have no better signal           |
| `on viewport`        | the placeholder scrolls into view                  | content below the fold                                              |
| `on interaction`     | click or keydown on the placeholder or a reference | content behind a disclosure                                         |
| `on hover`           | pointer enters, or `focusin`                       | almost always as `prefetch`, rarely as the trigger itself           |
| `on timer(<t>)`      | `<t>` after the block is created                   | the delay is the point, not a stand-in for "when things are calm"   |
| `on immediate`       | as soon as rendering finishes                      | splitting the chunk matters but the content is wanted straight away |
| `when <expr>`        | the expression becomes truthy                      | a condition the application already computes                        |

Two of these deserve warnings.

**`on timer` is usually not what you want.** The timer starts when the block is rendered
and fires regardless of what the browser is doing, so it will happily contend with a page
that is still settling — which is exactly the situation people reach for a delay to avoid.
`on idle` waits for quiet and is the better default. The one block on a timer here is the
"what's new" strip, where the delay is a deliberate piece of the design: it is an
interruption, and it should arrive after the dashboard has been read.

**`when` never un-renders.** A `@defer (when x())` block that loads when `x` is true stays
loaded when `x` goes false again — the trigger is one-way, and the block is not an `@if`.
Wrap it in one if the content genuinely has to come back out of the DOM.

## Placeholders, and what a trigger observes

`on viewport`, `on interaction` and `on hover` need a DOM element to attach to. Without an
explicit reference they use the `@placeholder`'s root element, which means such a block
**must have a placeholder**, and that placeholder must have **exactly one root element
node** — Angular throws at runtime otherwise, on the one path a slow device reaches.
`PanelSkeletonComponent` is written to satisfy that, and `panel-skeleton.component.spec.ts`
asserts it, because a wrapper element added there would break every host at once.

The alternative is an explicit trigger reference, which is what the breakdown block uses:

```html
<button #breakdownTrigger type="button">Show post-length breakdown</button>

@defer (on interaction(breakdownTrigger); prefetch on hover(breakdownTrigger)) {
  <app-insights-breakdown />
}
```

The reference has to be in the same template (or a parent view), and the trigger element
survives the load because it is outside the block. That last part matters for keyboard
users: a trigger *inside* a `@placeholder` is destroyed when the content replaces it, and
whoever activated it is left with nothing focused.

### Timing: `minimum` and `after`

```
@placeholder (minimum 400ms) { … }
@loading (after 100ms; minimum 400ms) { … }
```

These solve opposite problems and are usually written together. Without the `minimum`, a
chunk that arrives in two frames swaps the skeleton for content fast enough to read as a
flicker. Without the `after`, a load that finishes in 40ms still puts a second element on
screen for those 40ms. Together, nothing appears for less time than the eye can follow.

### When to skip the placeholder entirely

A placeholder trades a stable layout for space the content may never fill. That is worth it
when the content is what the user is waiting for, and not worth it for the release-notes
strip, where four seconds of reserved empty space for a notice most sessions dismiss is
worse than the shift of it arriving.

## Prefetching code is not prefetching data

`prefetch on idle` fetches the chunk. It does not run the component, does not call its
`queryFn`, and does not warm any cache. A deferred block that then reads data has **two**
waits in a row.

This application handles the second one with the same component as the first.
`PanelSkeletonComponent` is what `DashboardComponent` renders as the `@placeholder`, and it
is also what `InsightsPanelComponent` passes to `*appAsync` as its `loading:` template — so
the frame the user is looking at while the chunk downloads is the same element, unchanged,
while the query resolves. Two different skeletons here would produce a visible jump at the
moment the JavaScript lands, which reads as a layout bug rather than as progress.

Warming the *data* is the query cache's job, and it is why both deferred panels call
`injectPostsQuery()` with no parameters: that is the key `PostsListComponent` uses, so
arriving at the dashboard from the posts list renders them on the first frame.

## `@error` is terminal

There is no API to re-run a failed `@defer` block. Once it is in the error state it stays
there for the life of that block, and the only recovery is to recreate it — which means an
`@if` around the whole block, toggled by a signal, plus a `when` trigger to make the new
block load. Both blocks with an `@error` here tell the user to reload, because reload is
what actually works and a "Try again" button that did nothing would be worse than no button.

## Testing `@defer` blocks

`TestBed` has two modes, and both are used in `dashboard.component.spec.ts`.

**`DeferBlockBehavior.Manual`** takes the triggers away and hands the spec each state:

```ts
TestBed.configureTestingModule({ deferBlockBehavior: DeferBlockBehavior.Manual, … });
const [panel] = await fixture.getDeferBlocks();
await panel.render(DeferBlockState.Placeholder);   // or Loading, Complete, Error
```

`Error` is the state that has no other route to it — you cannot make a TestBed import fail
on demand — so this is the only way that branch is ever exercised. Blocks come back in
template order and have no names, which is why the spec keeps `PANEL`/`BREAKDOWN`/
`RELEASE_NOTES` index constants and asserts the count first: a fourth block added
mid-template would otherwise quietly re-point every later assertion.

**`DeferBlockBehavior.Playthrough`** (the default) runs the real triggers. `on interaction`
is a `.click()` away; `on timer` needs `fakeAsync` and a `tick` past the delay, plus one
more turn for the import promise. `on viewport` is the one that does not test well —
`IntersectionObserver` in a headless browser depends on layout the fixture does not really
have — so the viewport block is covered in manual mode, and what the trigger *needs* (a
single-root placeholder) is asserted directly instead.

## Not covered here

- **`hydrate` triggers.** `@defer (hydrate on interaction)` — incremental hydration — is a
  different feature wearing the same syntax, and it lives in [`ssr.md`](./ssr.md). The
  short version: a `hydrate` trigger renders the block's *main* content on the server and
  defers only the JavaScript that makes it interactive, so it needs a server-rendered
  route and does nothing on the client-rendered ones every block in this file sits on. It
  also needs no placeholder — it resolves against the main view — and it changes what a
  `<button type="submit">` inside the block means. `/login` is the one caller.
- **`@defer` inside `@for`.** Legal, and each iteration gets its own block; the chunk is
  fetched once and shared. No view here needs it.
- **Route-level splitting.** `loadComponent`/`loadChildren` already split every route in
  `app.routes.ts`; `@defer` is for splitting *within* a route.
