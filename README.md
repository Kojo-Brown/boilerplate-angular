# boilerplate-angular

> Angular 22 · TypeScript 6 · TailwindCSS 4 · NgRx Signal Store · Standalone Components

Enterprise Angular starter with modern patterns (no NgModules).

## Stack

| Layer | Tech |
|-------|------|
| Framework | Angular 22 |
| Language | TypeScript 6 |
| Styles | TailwindCSS 4 |
| State | NgRx Signal Store |
| Forms | Angular Reactive Forms + Zod |
| Rendering | Prerendered public routes + Node SSR, with incremental hydration |
| Testing | Jasmine + Karma + Playwright |

## Requirements

Node `^22.22.3 || ^24.15.0 || ^26.0.0` and pnpm 10. The Angular 22 CLI refuses
to run on older Node patch releases, so the floor is declared in `engines`
rather than left to be discovered at build time. `.npmrc` sets
`engine-strict=true`, so an unsupported Node fails `pnpm install` instead of
producing a warning and an opaque CLI abort three commands later.

The range is closed at `^26.0.0` rather than left open at `>=26.0.0` on purpose:
CI runs every gate on 22, 24, and 26, and a version nobody tests should not be
advertised as supported. Widen it in the same commit that widens the matrix.

## Quick Start

```bash
git clone https://github.com/Kojo-Brown/boilerplate-angular.git
cd boilerplate-angular
pnpm install
cp src/environments/environment.example.ts src/environments/environment.ts
pnpm start  # http://localhost:4200
```

To run the production build the way it is deployed — Node, server-rendered, with
the prerendered pages in place:

```bash
pnpm build
NG_ALLOWED_HOSTS=localhost pnpm serve:ssr  # http://localhost:4000
```

`NG_ALLOWED_HOSTS` is required and deliberately has no default; see
[Server-side rendering](#server-side-rendering).

## Scripts

| Script             | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `pnpm start`       | Dev server on http://localhost:4200                        |
| `pnpm build`       | Production bundle into `dist/` — browser, server, and prerendered pages |
| `pnpm serve:ssr`   | Runs the built Node server (needs `NG_ALLOWED_HOSTS`)       |
| `pnpm typecheck`   | `tsc --noEmit` against `tsconfig.app.json`                  |
| `pnpm lint`        | ESLint over `src/`, `--max-warnings=0`                       |
| `pnpm format:check`| Prettier check (use `pnpm format` to rewrite)               |
| `pnpm test`        | Karma unit tests, single run                                |
| `pnpm test:ci`     | Same, pinned to the sandboxed `ChromeHeadlessCI` launcher   |
| `pnpm e2e`         | Playwright end-to-end tests                                 |
| `pnpm check:onpush`| Fails on a production component without `OnPush`            |
| `pnpm stats`       | Production build into `.stats/`, carrying the bundler metafile |
| `pnpm check:defer` | Fails when a `@defer` block has stopped splitting its chunk |
| `pnpm check:routes`| Fails when a route exceeds its bundle budget, and prints the audit |
| `pnpm check:ssr`   | Starts the built server and checks what each route answers  |

CI runs lint, typecheck, format, and tests in parallel on Node 22, 24, and 26,
then builds on all three once they are green — see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

**Warnings fail the build.** `--max-warnings=0` covers ESLint;
`--strict-peer-dependencies` plus a WARN scan of the install log covers pnpm;
`NODE_OPTIONS=--throw-deprecation` covers Node runtime deprecations; and
[`scripts/ci/assert-no-warnings.sh`](./scripts/ci/assert-no-warnings.sh) covers
esbuild and the Angular CLI, which exit 0 on warnings. That last one is what
gives the bundle budget teeth — see [Bundle budgets](#bundle-budgets).

Use `pnpm test:ci` rather than `pnpm test -- --browsers=…` in scripted contexts:
the extra `--` makes the Angular CLI read `--no-watch`/`--no-progress` as unknown
positional arguments and abort before Karma starts.

## Testing notes

**TestBed runs zoneless**, matching the app — via `src/testing/test-main.ts`, since
the Angular CLI's generated test entry point would otherwise put the suite back on
zone-driven change detection. `fixture.detectChanges()` only refreshes views that
something has marked dirty, so assigning to a plain field on a host component does
*not* re-render the component under test — the assertion then sees stale DOM and
fails in a way that looks like a component bug. Hold host state in **signals**:

```ts
class HostComponent {
  readonly variant = signal<ButtonVariant>('primary');
}
// host.variant.set('secondary') marks the view dirty; host.variant = … does not.
```

Shared helpers live in `src/testing` (re-exported from `@/testing`):

- `host(fixture)` — `fixture.nativeElement` typed as `HTMLElement`. The raw
  property is `any`, so `fixture.nativeElement.querySelector<T>()` is a TS2347
  compile error under this repo's `strict` config.
- `installFakeMediaQuery(initial)` — replaces `window.matchMedia` with a registry
  the spec drives. Headless Chrome answers `matchMedia` from a viewport a unit
  test cannot resize, and the fake also reports its live listener count so
  teardown can be asserted instead of assumed.
- `requireEl(root, selector)` / `fillInput(root, selector, value)` — query or fill
  an element the spec depends on, throwing with the selector when it is missing
  instead of returning `null`.
- `settleUntil(fixture, rendered)` — render repeatedly until a condition holds, for a
  read Angular is not tracking. `whenStable()` only covers pending tasks the framework
  knows about, so a TanStack Query `queryFn` settles with the fixture already reporting
  itself stable; waiting on the outcome beats guessing a turn count.
- `loadChildRoutes(route)` / `loadRouteComponent(route)` — **invoke** a lazy route
  loader and return what it resolves to. Asserting only that `loadChildren` is
  defined passes even when the dynamic import points at a moved file or renamed
  export; that failure would otherwise surface in production, on navigation.

Prefer a real `provideRouter([])` over a stubbed `Router` for any component whose
template uses `routerLink` — the directive calls `createUrlTree`/`serializeUrl`
and injects `ActivatedRoute`, none of which a spy object provides.

## Signals

Component state is signal-first: `signal` for what a component owns, `computed`
for anything derivable from it, and `effect` only for writes that leave the
reactive graph — always with an `onCleanup` when the effect acquires a timer or a
subscription. Reusable primitives (`debouncedSignal`, `intervalSignal`,
`mediaQuerySignal`) live in `src/app/core/reactivity` and are re-exported from
`@/app/core/reactivity`.

See [docs/signals.md](./docs/signals.md) for the decision table, the cleanup
contract, and how to test it.

## RxJS interop

Signals and Observables are converted at the edges, in the direction the
consumer demands. `toSignal` brings a stream in when the view renders its latest
value — `controlSignal` / `controlErrorSignal` in `@/app/core/reactivity` do it
for reactive forms, whose state is otherwise invisible to the graph. Streams
subscribed to for a side effect stay subscriptions, with `takeUntilDestroyed`.
`toObservable` goes the other way for the two cases a signal cannot cover:
time-based operators, and APIs typed `Observable` — `authGuard` uses it to wait
for a session restore to settle before deciding.

See [docs/rxjs-interop.md](./docs/rxjs-interop.md) for the decision table, the
traps in each direction, and how to test across the boundary.

## Flattening operators

`switchMap`, `concatMap`, `exhaustMap` and `mergeMap` differ in one thing: what
happens to an input that arrives while the previous inner stream is still
running. Reads where only the newest answer matters cancel the previous one
(`switchMap` — the `typeahead` primitive in `@/app/core/reactivity`, whose
caller is the post search box on `/dashboard/posts`); submits ignore the
duplicate (`exhaustMap` — `AuthStore.login`, `register` and
`refreshAccessToken`), because cancelling a write aborts the response, not the
write.

See [docs/rxjs-flattening.md](./docs/rxjs-flattening.md) for the decision table,
what each wrong answer costs, the four traps, and the three assertions that pin
an operator choice in a test.

## Store with time travel

`createSignalStore` in `@/app/core/store` is a signal-backed store where every
write carries a label and lands in a bounded, ordered log — which is what makes
`undo()`, `redo()` and `jumpTo()` possible, and what the Redux DevTools bridge
drives. `ThemeService` is the production caller: theme state is durable,
user-visible, and written by named actions, so a jump backwards is something you
can see happen to the page.

It does not replace `@ngrx/signals`. `AuthStore` stays a `signalStore`, because
`rxMethod` and its flattening control are worth more there than a history log.
The devtools bridge is reached through a dynamic `import()` behind an
`environment.production` guard, so it ships in its own lazy chunk in
development and is absent from a production bundle entirely.

See [docs/signal-store.md](./docs/signal-store.md) for the three-way choice
between `signal`, `signalStore` and this, the four design decisions behind the
log, and what the DevTools bridge deliberately refuses to do.

## Zoneless

The app runs without ZoneJS: `provideZonelessChangeDetection()` in
`app.config.ts`, an empty `polyfills` array, and `zone.js` demoted to a
devDependency where the test bundle still needs it for `fakeAsync`. Change
detection is scheduled by signal writes, bound listeners, and `markForCheck()`
rather than by patched browser APIs — 35 kB smaller, and explicit about when the
app re-renders.

Both halves are pinned, because neither fails loudly on its own:
`src/app/app.config.spec.ts` catches a zone-based provider coming back, and
[`scripts/ci/assert-no-zonejs.sh`](./scripts/ci/assert-no-zonejs.sh) greps the
emitted bundles for ZoneJS in the CI build job.

See [docs/zoneless.md](./docs/zoneless.md) for what does and does not trigger a
refresh, the patterns that need converting, and how to migrate an existing app.

## Change detection

Every production component is `OnPush`. Zoneless changes *when* a refresh runs;
`OnPush` changes *how much* of the tree it visits — under the same set of
notifications, Default re-checks every descendant view and OnPush skips
subtrees whose inputs and signals have not changed. Neither the compiler nor
ESLint flags a Default component, so
[`scripts/ci/assert-onpush-everywhere.sh`](./scripts/ci/assert-onpush-everywhere.sh)
runs in the `lint` job and fails a PR that adds one. Test host components
inside spec files are excluded — they never ship, and forcing them OnPush
would change what a change-detection test observes.

See [docs/change-detection-profiling.md](./docs/change-detection-profiling.md)
for the DevTools workflow, an in-code `afterRenderEffect` counter you can copy
into a component while measuring, and the four wins that pay the most.

## SOLID seams

Four injection seams in the app exist because a SOLID audit found a cost, not
because a principle said so: `THEME_PREFERENCE_STORE` (where a theme choice is
remembered), `TOAST_SCHEDULER` and `TOAST_ID_FACTORY` (deferred work and ids, as
dependencies rather than globals), and `AUTH_BYPASS_PATHS` (which endpoints
`jwtInterceptor` leaves unsigned). The posts backend additionally publishes
three roles — `PostReader`, `PostSearcher`, `PostWriter` — so a consumer can
depend on the slice it uses; they are abstract classes, and therefore tokens as
well as types (see below).

See [docs/solid.md](./docs/solid.md) for the before/after on each of the five
principles, the tests they made possible, and the three violations that are
recorded there and deliberately left alone.

## The auth facade

Components do not inject `AuthStore`. They inject `AuthFacade`
(`src/app/core/auth`), which publishes four reads — `currentUser`, `isSignedIn`,
`isBusy`, `errorMessage` — and four commands — `signIn`, `signUp`, `signOut`,
`dismissError`. The store's twenty members stay behind it, tokens and session
lifecycle included, and `store.login`'s `rxMethod` signature (which accepts an
observable and returns a subscription) becomes `signIn(credentials): void`.

`core/` is exempt: `authGuard`, `roleGuard`, `jwtInterceptor` and
`app.config.ts` own the session lifecycle and hold the store directly. The rule
for everything else is enforced by `no-restricted-imports` in
`eslint.config.mjs`, so `inject(AuthStore)` in a component fails `pnpm lint`
rather than quietly removing the seam.

See [docs/facade.md](./docs/facade.md) for what a component could reach before
and cannot now, why the facade passes the store's signals through instead of
wrapping them, and what the typed `createFakeAuthFacade` double replaced.

## API error strategies

How a failed response becomes an `ApiError` is a list, not a function body.
`errorInterceptor` injects `API_ERROR_MAPPERS` — a `multi: true` token holding
`ApiErrorMapper` strategies — and takes the first one that recognises the
response. Four ship: `offline` (no status at all), `problem-json` (RFC 9457),
`message-envelope` (this API's own `{ message, errors }`) and `string-body`
(`text/plain`). `app.config.ts` registers them with
`provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS)`, so supporting one more
backend format is one entry in that call and no change under `core/http`.

See [docs/strategy-tokens.md](./docs/strategy-tokens.md) for why `map()` returns
`ApiError | null` instead of pairing with a `canMap()`, why the token carries no
`providedIn` default, and why a lazy route that provides mappers **replaces**
the set rather than adding to it.

## HTTP decorators

An `HttpInterceptorFn` takes the handler beneath it and returns a handler, so
the interceptor chain is already a decorator stack. Three decorators use that:
`retryInterceptor` (exponential backoff with full jitter, idempotent methods
only, `Retry-After` honoured), `cacheInterceptor` (in-flight deduplication
always, storage only when the response's `Cache-Control` or the call site says
so) and `telemetryInterceptor` (one span per request, counting `cancelled`
separately from `error`). `composeInterceptors` folds several into one and
`interceptWhen` scopes the result, so `app.config.ts` can apply the cache and
the retry to this application's own API and nothing else.

The three are ordered, not merely listed: telemetry outermost so it measures the
backoff, cache beneath `jwtInterceptor` so its key carries the credential, retry
innermost so three attempts are one cache entry and one span. What each learned
travels back up through a mutable `REQUEST_TRACE` on the `HttpContext`.

See [docs/interceptor-decorators.md](./docs/interceptor-decorators.md) for the
position-by-position argument, why nothing is cached by default, why `POST` is
absent from the retry policy, and the `runInInjectionContext` hazard that
`composeInterceptors` exists to avoid.

## Dependency inversion

The posts backend is reached through three **abstract classes** — `PostReader`,
`PostSearcher`, `PostWriter` — which in Angular are one symbol that is both a
type and an injection token. Consumers inject the role they use and no longer
import an implementation; `core/routing` no longer reaches into `features/` for
one. Two backends satisfy them: `HttpPostsService`, chosen by the lazy dashboard
route that owns the posts pages, and `InMemoryPostsService`, which lets a
component spec exercise the real read-write cycle with no `HttpTestingController`
at all.

`providePostsBackend(Backend)` binds all three roles to one instance with
`useExisting`, and takes a `Type<PostsBackend>` so the class is checked — which
Angular's own `useClass`/`useValue`/`useExisting` literals, all typed `any`, are
not.

See [docs/dependency-inversion.md](./docs/dependency-inversion.md) for why an
abstract class here and an `InjectionToken` in `docs/solid.md`, what `useClass`
would have cost, and where the in-memory backend's fidelity stops.

## Dynamic components

`ViewContainerRef.createComponent()` renders a component the template does not
name, and `inputBinding`/`outputBinding`/`twoWayBinding` carry values into it —
all of them taking a `string` name and an `unknown` value, so nothing checks that
the input exists or that the value fits. `dynamicComponent(Type, bind => [...])`
in `src/app/shared/dynamic/` closes that: names are `keyof` the component's
`input()`/`model()`/`output()` declarations, values are the types those declare,
and a transformed input widens to what its transform accepts exactly as it does
in a template. `[appDynamicOutlet]` renders the result.

The two names the compiler cannot see — an aliased input, an `@Input()` field —
are checked at construction with `reflectComponentType()`, so binding `total`
when the alias is `count` fails with both names in the message instead of
silently binding nothing.

`WidgetBoardComponent` is the payoff: it renders whatever is registered under
`DASHBOARD_WIDGETS`, imports no widget, and knows no widget's inputs, because
each definition binds its own component under the compiler's eye.

See [docs/dynamic-components.md](./docs/dynamic-components.md) for what each
declaration maps to, why the descriptor's reference is the identity of the
rendering, when `NgComponentOutlet` is the better trade, and the five things
this deliberately does not cover.

## Structural directives

`src/app/shared/directives/` holds the two structural directives this
application needed after `@if` and `@for` became language features.
`*appAsync="post; let data; loading: skeleton; error: failed"` renders the
loaded branch of an asynchronous read with `data` typed, over an
`AsyncSnapshot<T>` built by `resourceSnapshot()` or `querySnapshot()` — which is
also where each library's ordering hazard is handled once, `resource.value()`
throwing in the error state and a failed TanStack refetch keeping the data it
had. `*appRepeat="6"` renders a template a fixed number of times, which `@for`
has no spelling for.

`data` is a `Post` and not `any` because of four lines: a directive that omits
`ngTemplateContextGuard` does not get `unknown` in its template, it switches
template type-checking off inside it. With the guard, `{{ data.titel }}` fails
`pnpm build`; without it, the same typo builds clean and renders nothing.

See [docs/structural-directives.md](./docs/structural-directives.md) for both
guard forms and why only one of them is here, what a `TemplateRef` passed as an
input can and cannot type, and why the loaded view is updated rather than
recreated.

## Deferred loading

`DashboardComponent` defers everything below the widget board, each block with
the trigger that matches how it is reached: `on viewport; prefetch on idle` for
the insights panel past the fold, `on interaction(ref); prefetch on hover(ref)`
for the breakdown behind a disclosure button, and `on timer(4s); prefetch on
idle` for the "what's new" strip, where the delay is the design and not a
stand-in for `on idle`.

Prefetching fetches *code*, never data, so a deferred block that then reads
something has two waits in a row. `PanelSkeletonComponent` covers both: it is
the block's `@placeholder` and it is the `loading:` template of the `*appAsync`
inside the deferred component, so the frame holds still from first paint until
real content replaces it.

The reason there is a CI gate for this is that the failure is silent. Naming a
deferred component in its own `@placeholder`, or importing a value from its file
anywhere eager, turns the dynamic import back into a static one — no warning, no
lost chunk name in a diff, and, because the host is itself a lazy route, an
initial-bundle budget that does not move by a single byte. `pnpm check:defer`
reads the bundler's metafile and fails when a block's chunk becomes statically
reachable from its host's.

See [docs/defer.md](./docs/defer.md) for the trigger decision table, why `on
timer` is usually the wrong answer and `when` never un-renders, what a
placeholder-less block has to name instead, why `@error` cannot retry, and how
to drive each block state from a spec.

`/login` uses the same syntax for a different job — see
[Server-side rendering](#server-side-rendering).

## Server-side rendering

`pnpm build` produces three things: the browser bundle, a Node server that
renders it, and a static HTML file for every route that can be produced ahead of
time. Which is which is one line per route in
[`src/app/app.routes.server.ts`](./src/app/app.routes.server.ts):

| Route | Mode | Why |
| ----- | ---- | --- |
| `/login`, `/register`, `/unauthorized` | `Prerender` | Identical bytes for everyone. |
| everything else | `Client` | Depends on who is asking, which the server cannot know. |

The session lives in `localStorage` and nothing carries it to the server, so on
the server `AuthStore` is signed out for *everyone* — signed-in visitors
included. Rendering `/dashboard` there therefore has two possible outcomes and
both are wrong: run `authGuard` and every request is a 302 to `/login`, or skip
it and an anonymous request is served a dashboard frame the client takes back
the moment it hydrates. `RenderMode.Client` says the honest thing instead.
Phase 10's httpOnly refresh cookie is what would change the answer.

`provideClientHydration(withEventReplay())` in `app.config.ts` makes the browser
adopt the server's DOM rather than rebuild it. Event replay is the only feature
named because it is the only one still opt-in — Angular 22 brings DOM hydration,
the `HttpClient` transfer cache and incremental hydration by default, which is
why `withIncrementalHydration()` is deprecated and absent here.

### Incremental hydration

`/login` is prerendered, so the whole sign-in card is visible with no JavaScript
at all. Being *usable* is what costs: 101.89 kB of `@angular/forms` and Zod
against ~5 kB for the rest of the page. `@defer (hydrate on interaction)` splits
the two — the server renders the form's real markup, and the browser fetches and
hydrates it on the first click or keystroke.

| | `/login` | `/register` (the control) |
| --- | ---: | ---: |
| Lazy JS to reach the route | **2.94 kB** | 111.15 kB |
| …before | 109.65 kB | 111.74 kB |

Two hazards came out of it, both measured against the production build with
scripts delayed.

A dehydrated form is live HTML. Angular's event replay runs *after* the browser
has dispatched the event and suppresses the default action of nothing but a
click on an `<a>`, so a `<button type="submit">` inside the block still submits
the form natively on a pre-hydration click — a navigation back to `/login` that
discards what was typed. The markup is made inert instead: a `type="button"`
submit control, and Enter bound on the fields.

And hydrating a reactive form *empties* it: `setUpControl` writes each control's
initial value over the node the visitor has been typing into. That one is not
about `@defer` — `/register` lost a typed value after 2.5 s and `/login` after
5.1 s — so both forms now seed their controls from the server-rendered DOM in
their constructor, before the `formControlName` directives run.

`pnpm check:ssr` starts the built server and checks all of it — that the
prerendered pages carry hydration annotations, that the sign-in block arrives
dehydrated, that `/dashboard` comes back as an empty shell, and that a request
with an unknown `Host` is rejected.

`NG_ALLOWED_HOSTS` has no default and the server refuses to start without it.
Angular validates `Host` and `X-Forwarded-Host` against that list, which is
empty unless something fills it — so an unconfigured server would otherwise
start, pass a health check, and answer every real request with a 400 about
server-side request forgery.

See [docs/ssr.md](./docs/ssr.md) for the full reasoning: why a provider that
exists on only one platform breaks hydration, what `storageOf` fixes that
`view?.localStorage` does not, the ESLint rule that keeps browser globals out of
code that now runs twice, what a `hydrate` block falls back to when nothing is
hydrating, and why a top-level `throw` in `server.ts` exits 0.

## Virtual scrolling

`src/app/shared/virtual-table/` renders a table of any size with only a
screenful of rows in the DOM, over `@angular/cdk/scrolling`.
`/dashboard/activity` is the caller: 10,000 audit-log entries, about sixteen
`role="row"` elements, sortable by five of its six columns.

It is not a `<table>`, and cannot be: the CDK positions rows inside a
`transform`ed wrapper `div` and sizes the scrollbar with a spacer `div`, neither
of which is a legal child of `<table>`. So it is CSS grid with explicit ARIA
roles — which makes the accessibility tree the component's problem. With ~16 of
10,000 rows in the DOM, a screen reader announces "row 3 of 16" unless
`aria-rowcount` and `aria-rowindex` supply the real numbers; the header must sit
outside the viewport or it scrolls away with the rows; the CDK's two scaffolding
divs must be hidden or the rows belong to no rowgroup; and the viewport needs a
`tabindex` or a keyboard user cannot scroll it at all.

Three hazards the API closes rather than documents: `rowKey` takes a row and not
a `TrackByFunction`, because the index `cdkVirtualFor` passes a `trackBy` is
relative to the rendered window and tracking by it hands one row's DOM node to
another row's data; `itemSize` and the row height are the same input, because the
spacer is `itemSize × rows.length` and a disagreement makes the scrollbar
describe a document that does not exist; and the zebra stripe is bound from the
data index, because `:nth-child(even)` counts the sliding window and strobes as
it scrolls.

See [docs/virtual-scrolling.md](./docs/virtual-scrolling.md) for when *not* to
use it (the CDK costs 24.39 kB against 9.22 kB of table), why sorting belongs to
the caller, what a cell cannot contain and why, and the five things this
deliberately does not do — a paged `DataSource` among them.

## Dependency notes

Two deliberate `pnpm` overrides live in `package.json`:

- **`peerDependencyRules.allowedVersions`** — `@ngrx/signals` 21.1.1 declares a
  peer of `@angular/core@^21.0.0`; the only v22-compatible release is
  `22.0.0-beta.0`, which is too green for a production template. The Signal
  Store API this repo uses is unchanged across the majors, so Angular 22 is
  accepted explicitly. Drop the rule once `@ngrx/signals@22` goes stable.
- **`ignoredBuiltDependencies`** — `esbuild`, `lmdb`, `msgpackr-extract`, and
  `@parcel/watcher` ship optional native postinstall scripts. Nothing in the
  build needs them (pnpm resolves the platform-specific prebuilt packages), so
  they are declined by name to keep installs deterministic and warning-free
  instead of relying on pnpm's default refusal.

## Bundle budgets

`angular.json` declares budgets with `maximumError` only — no `maximumWarning`
band. A warning nobody can merge past is just an error with extra steps, and a
warning CI *does* let through is a budget that does not exist: `ng build` exits 0
when a budget is exceeded, so for its first weeks this template shipped 79 kB
over its 500 kB initial budget with a green pipeline.

Current thresholds, against a 563.09 kB initial bundle (157.48 kB transfer):

| Budget              | Error at |
| ------------------- | -------- |
| `initial`           | 567 kB   |
| `anyComponentStyle` | 4 kB     |

Both are tighter than what they replaced (1 MB and 8 kB errors). The headroom on
`initial` is deliberately thin — unchanged when dropping ZoneJS took 35 kB off the
bundle, because a budget that absorbs a win stops being a budget: crossing it
should mean looking at what was just added to the eager graph, not raising the
number. Route-level code splitting is
already in place — every feature under `src/app/features/` is lazy — so growth in
the initial chunk means something leaked into a shared eager import.

`initial` has been *lowered* once, from 571 kB, when server-side rendering was
turned on: the builder stopped emitting one 535 kB `main` chunk and started
emitting thirteen initial chunks sharing code with the server graph, which took
4.49 kB off the raw total. The headroom was kept at its old ~4 kB rather than
banked. (Raw is what the budget compares, and raw is what fell; the gzipped
transfer went the other way, 149.79 kB → 157.48 kB, because thirteen small
chunks compress worse than one large one. That is the cost of the split, and it
is recorded here rather than hidden behind the number that improved.)

`initial` has been raised exactly once, from 565 kB, by the virtual-scrolling
item — and only after establishing that the 5.30 kB it added was unreachable from
any route-level change. 13 eager files import the `rxjs` barrel, which
chunk-assigns every rxjs module to `main`; the CDK's `auditTime` and
animation-frame scheduler therefore *survive* tree-shaking in the initial bundle
rather than moving into the lazy chunk that uses them. The lever is the barrel
imports, not the route. See
[`docs/virtual-scrolling.md`](./docs/virtual-scrolling.md#the-530-kb-that-lands-in-main).

What a budget cannot see is code moving *between* lazy chunks, which is exactly
what a de-optimised `@defer` block does: the initial total is unchanged to the
byte while a panel that used to arrive on scroll now arrives with the route.
`pnpm check:defer` is the gate for that half; see
[Deferred loading](#deferred-loading).

### Per-route budgets

`initial` also cannot see what a route costs *after* the first paint, which is the
whole point of putting every feature behind a lazy route. `pnpm check:routes`
prices each one — the union of every chunk the browser has downloaded once the
route is on screen, minus what the initial bundle already provided — and fails
when a route exceeds its own budget:

| Route                  |   Lazy JS | Error at |
| ---------------------- | --------: | -------: |
| `/register`            | 111.15 kB |   114 kB |
| `/dashboard/activity`  |  55.37 kB |    58 kB |
| `/dashboard/posts`     |  32.05 kB |    33 kB |
| `/dashboard`           |  29.62 kB |    31 kB |
| `/dashboard/posts/:id` |  26.49 kB |    28 kB |
| `/login`               |   2.94 kB |     4 kB |
| `/admin`               |   0.55 kB |     2 kB |
| `/unauthorized`        |   0.54 kB |     2 kB |

`/register` costs two hundred times what `/login` does, and none of the
difference is the form: both render one, and both draw it from the same 101.89 kB
chunk of Zod v3 (51 kB) and `@angular/forms` (39 kB). `/login` is prerendered and
hydrates its form on first interaction, so that chunk is no longer part of
*reaching* the route — see [Incremental hydration](#incremental-hydration).
`/login`'s budget moved from 112 kB to 4 kB in the same commit, because a budget
left at its old ceiling would pass just as happily on the day the block stopped
deferring.

The gate also fails when route splitting collapses — a route's code reaching the
initial bundle, two routes merging into one chunk, a parent importing a child
statically — none of which moves a total anything else watches.
[`docs/route-budgets.md`](./docs/route-budgets.md) has the full audit, the
measurement, and what to do when a budget is crossed.

## Spec Progress
See [SPEC.md](./SPEC.md).
