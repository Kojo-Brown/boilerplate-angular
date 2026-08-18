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
