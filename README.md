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

## Scripts

| Script             | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `pnpm start`       | Dev server on http://localhost:4200                        |
| `pnpm build`       | Production bundle into `dist/`                             |
| `pnpm typecheck`   | `tsc --noEmit` against `tsconfig.app.json`                  |
| `pnpm lint`        | ESLint over `src/`, `--max-warnings=0`                       |
| `pnpm format:check`| Prettier check (use `pnpm format` to rewrite)               |
| `pnpm test`        | Karma unit tests, single run                                |
| `pnpm test:ci`     | Same, pinned to the sandboxed `ChromeHeadlessCI` launcher   |
| `pnpm e2e`         | Playwright end-to-end tests                                 |

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
`jwtInterceptor` leaves unsigned). `PostsService` additionally publishes three
role interfaces — `PostReader`, `PostSearcher`, `PostWriter` — so a consumer can
depend on the slice it uses.

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

Current thresholds, against a 544 kB initial bundle (144 kB transfer):

| Budget              | Error at |
| ------------------- | -------- |
| `initial`           | 565 kB   |
| `anyComponentStyle` | 4 kB     |

Both are tighter than what they replaced (1 MB and 8 kB errors). The headroom on
`initial` is deliberately thin — 21 kB, unchanged when dropping ZoneJS took 35 kB
off the bundle, because a budget that absorbs a win stops being a budget:
crossing it should mean looking at what was just added to the eager graph, not
raising the number. Route-level code splitting is
already in place — every feature under `src/app/features/` is lazy — so growth in
the initial chunk means something leaked into a shared eager import.

## Spec Progress
See [SPEC.md](./SPEC.md).
