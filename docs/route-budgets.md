# Route-level code splitting and per-route budgets

`angular.json` budgets the **initial** bundle. That is the cost of the first paint and
nothing else. Every feature in this repo sits behind a lazy route, so the initial budget
is deliberately blind to the thing route splitting was done for: what a user pays *on top
of it* to reach a page.

Nothing else covers that gap either. A route's chunk can double, or start dragging a
100 kB library in through a chunk it shares with a sibling, and the initial total does not
move by a byte — the same silent failure mode as a de-optimised `@defer` block, one level
up. `pnpm check:routes` is the gate for it, and this document is the audit it came from.

## What a route costs

Not "the size of its chunk". Reaching `/dashboard/posts` loads three chunks in sequence —
`dashboard.routes.ts`, then `DashboardShellComponent`, then `PostsListComponent` — and
each of those statically imports further chunks that arrive with it. Some are shared: the
shell's chunks are also the dashboard's, and the reactivity helpers are also the login
page's.

So the number the gate compares is the **union** of every chunk the browser has downloaded
once the route is on screen, counted once, minus everything the initial bundle already
provided. That is why `/dashboard/posts` costs 31.46 kB rather than the 47 kB its three
chunks add up to in isolation, and why adding a fourth route under the shell would cost
only what that route itself brings.

`scripts/ci/assert-route-budgets.mjs` computes it from the esbuild metafile the Angular
builder writes as `stats.json`, walking the chain of `loadChildren`/`loadComponent` calls
each route declares:

```
loaded = static closure of the initial chunk
for each step in the route's chain:
    loaded += static closure of that step's chunk
cost = bytes(loaded) - bytes(initial closure)
```

Minification erases module boundaries, so the metafile is the only artifact in which the
question has an answer. `pnpm build` does not emit one on purpose — it would ship inside
`dist/` beside the bundles — so CI runs `pnpm stats` once and points both bundle gates at
the result.

## The audit

Measured at the commit that added the gate, against a 561.47 kB initial bundle
(148.58 kB transferred):

| Route                  |   Lazy JS | Transfer |  Budget | Cold start |
| ---------------------- | --------: | -------: | ------: | ---------: |
| `/login`               | 109.69 kB | 27.48 kB |  112 kB |  671.23 kB |
| `/register`            | 111.78 kB | 27.85 kB |  114 kB |  673.33 kB |
| `/unauthorized`        |   0.52 kB |  0.38 kB |    2 kB |  562.06 kB |
| `/dashboard`           |  29.17 kB | 10.81 kB |   31 kB |  590.71 kB |
| `/dashboard/posts`     |  31.46 kB | 11.62 kB |   33 kB |  593.00 kB |
| `/dashboard/posts/:id` |  26.02 kB |  9.73 kB |   28 kB |  587.56 kB |
| `/admin`               |   0.50 kB |  0.43 kB |    2 kB |  562.04 kB |

> **Since measured.** `/login` is now **2.94 kB** against a **4 kB** budget. The 108 kB it
> used to carry is still there — it is the same shared Zod and `@angular/forms` chunk
> `/register` pays for — but the page is prerendered and its form is behind
> `@defer (hydrate on interaction)`, so that chunk is fetched on the visitor's first click
> rather than on the way to the route. The budget moved with the measurement, for the
> reason given under *When a budget is crossed* below. See [`ssr.md`](./ssr.md).
> `/dashboard/activity` (55.37 kB against 58 kB) post-dates this table too; `pnpm
> check:routes` prints the current figures.

"Lazy JS" is what the route adds to the initial bundle; "cold start" is everything a first
visit fetches, the global stylesheet included. Transfer sizes are gzipped and reported
only — zlib's output moves a few bytes between Node builds, and a budget that shifts under
the runtime is a flake. Budgets compare raw bytes, like `angular.json`'s.

Three things the numbers say:

**The auth routes cost twenty times what the dashboard's do, and none of it is the form.**
`/login` and `/register` share a 101.89 kB chunk that is 51 kB of Zod v3 and 39 kB of
`@angular/forms`. Zod arrives through `auth.schemas.ts`, which the two components import
for validation, and it is the single largest lazily-loaded artifact in the application —
larger than the entire dashboard feature. Worth knowing before reaching for a schema
library in a third place. Options, none of them taken here: Zod v4's `zod/mini` tree-shakes
far better than v3's monolithic `types.js`; the schemas could move behind the submit
handler rather than being imported at module scope; or validation could be expressed with
Angular's own validators and Zod kept for API-boundary parsing, where the payoff is
clearer. That is a change with its own trade-offs, so it is written down rather than
smuggled in beside a CI gate — but the budget now means it cannot get quietly worse first.

**The dashboard's widgets are on the wrong side of a route boundary.** `stat-widget`,
`activity-widget` and `sample-widgets` are in the `dashboard.routes.ts` chunk rather than
the board's, because the route's `providers` name them. Every dashboard route pays the
5.5 kB, including `/dashboard/posts` and `/dashboard/posts/:id`, which render no widgets.
That is the documented cost of configuring the board through DI (see
`docs/dependency-inversion.md`); moving `provideDashboardWidgets` down onto the board's own
route would fix it and give up the ability to swap the widget list per route.

**`/unauthorized` and `/admin` are essentially free**, at half a kilobyte each, which is
what a correctly-split route with no dependencies of its own looks like. They are the
control group: when one of them grows, something has been imported that should not be.

## What the gate asserts beyond the number

A budget alone would miss the failures that keep the number flat:

1. **Every lazily-imported entry in a `*.routes.ts` file appears in a declared chain.**
   Without this, adding a route silently shrinks what the gate covers, which reads as a
   green run rather than as a gap. The entries are read out of the metafile — esbuild has
   already resolved each `import()` — rather than parsed back out of the source.
2. **No step is already downloaded when the router reaches it.** From the initial bundle
   means route code leaked into the eager graph; from an earlier step means two routes'
   components merged into one chunk, or a parent started importing a child statically.
   Neither moves any total the CI already watches.
3. **Every step is dynamically imported by something already loaded**, so a chain that has
   gone stale — a moved file, a route rewritten around an eager import — fails loudly
   instead of quietly measuring the wrong thing.

Each of those failure modes has been provoked against a doctored metafile; the messages
name the file, the chunk, and which of the three it is.

## Changing a budget

Headroom is for noise, not for growth — a couple of kilobytes, on the same reasoning as
the thin margin on `initial`. Crossing a budget is a prompt to look at what was just added
to that route's graph, and the failure prints every chunk beyond the initial bundle with
its size, which is usually enough to see it.

Raise a number only with a reason, in the commit that earns it. A budget that absorbs
whatever arrives is not a budget; and one raised in a separate "fix CI" commit hides the
change that needed it.

To see where a route's bytes go:

```bash
pnpm stats                                        # build once, into .stats/
STATS_JSON=.stats/stats.json pnpm check:routes    # the table above, for your tree
node -e "const s=require('./.stats/stats.json');console.table(
  Object.entries(s.outputs['<chunk>.js'].inputs)
    .map(([f,i])=>({file:f,bytes:i.bytesInOutput}))
    .sort((a,b)=>b.bytes-a.bytes).slice(0,15))"
```

## What this does not measure

Only JavaScript reachable through the module graph, plus the global stylesheet in the
cold-start column. Not images, fonts, or anything fetched at runtime; not the API calls a
route makes on arrival, which are frequently the larger share of time-to-content; and not
`@defer` blocks, which are correctly excluded — code behind a defer block is not
downloaded by navigating to the route, which is the point of it. `pnpm check:defer` is the
gate for that half; see [`docs/defer.md`](./defer.md).

Nor is it a runtime measurement. A route that is small and slow — a resolver blocking
navigation, a waterfall of dependent requests — passes this gate untouched.
