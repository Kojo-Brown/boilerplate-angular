# Spec: boilerplate-angular

> Spec-driven. Mark `[x]` only after pushing.

## Phase 0 — Green Baseline (blocks all feature work)
- [x] Verify every dependency version actually exists on the registry and fix the ones that do not, then commit a lockfile — all 30 ranges resolve; `@eslint/js` was undeclared, so `pnpm lint` had never run (PR #16)
- [x] Get `install`, `typecheck`, `lint`, `test`, and `build` all passing locally from a clean clone — the spec files did not compile, so the unit suite had never run either (PR #16)
- [x] Promote `workflow-templates/ci.yml` to `.github/workflows/ci.yml` and confirm it runs green on a PR — green on run #1 (PR #16)
- [x] Add a CI job matrix covering the supported Node version and fail the build on any warning — every gate runs on Node 22, 24, and 26; `engines.node` narrowed from `>=26.0.0` to `^26.0.0` so the declared range matches the matrix (PR #17)

Phase 0 complete as of PR #17 (2026-08-01): install (frozen lockfile,
`--strict-peer-dependencies`, 0 WARN lines), lint, typecheck, format check, 220
unit tests, and build all green in CI on Node 22, 24, and 26. Coverage 89.20%
statements / 80.99% branches / 84.53% functions / 89.18% lines against unchanged
`karma.conf.js` thresholds.

Warnings are now failures, not log noise: `--max-warnings=0` for ESLint,
`engine-strict=true` for an unsupported Node, `--throw-deprecation` for Node
runtime deprecations, and `scripts/ci/assert-no-warnings.sh` for esbuild and the
Angular CLI, neither of which signals a warning through its exit code. That last
one is what exposed a standing 500 kB budget overrun that had been passing CI —
`angular.json` budgets now carry `maximumError` only (initial 600 kB,
anyComponentStyle 4 kB), both tighter than the 1 MB / 8 kB they replaced.
`prettier --check` was gated for the first time, which reformatted 18 files.
`workflow-templates/ci.yml` was deleted as the stale pre-promotion copy.

Known gaps carried into Phase 1: Playwright E2E is still not wired into CI;
`format:check` covers `src/**/*.{ts,html,css}` only, so root configs and `e2e/`
are unformatted; and nothing in CI builds the Dockerfile, whose `node:22-alpine`
tag satisfies the engine range today only by luck of what `22` resolves to.

## Phase 1 — Foundation
- [x] Angular 22 + TypeScript 6 + standalone components (no NgModules)
- [x] TailwindCSS 4 via PostCSS with CSS variable design tokens
- [x] ESLint 9 + Prettier + Husky pre-commit hooks
- [x] Path alias `@/` via tsconfig + angular.json
- [x] Typed env with `environment.ts` pattern

## Phase 2 — State & Data
- [x] NgRx Signal Store for global state (auth slice)
- [x] Angular 22 `HttpClient` typed service layer with interceptors
- [x] JWT interceptor: attach Bearer token, handle 401 → refresh
- [x] TanStack Query Angular adapter for server state

## Phase 3 — Routing & Auth
- [x] Functional route guards: `authGuard`, `roleGuard`
- [x] Lazy-loaded feature routes with `loadComponent`
- [x] Auth pages: login, register with Angular Reactive Forms + Zod
- [x] Route title strategy

## Phase 4 — UI System
- [x] Angular CDK + CSS variables component library: Button, Input, Dialog, Toast
- [x] Dark mode via class strategy + Angular service
- [x] Responsive layout shell with sidebar + mobile drawer

## Phase 5 — Testing & DevOps
- [x] Jasmine + Karma unit tests with Angular TestBed
- [x] Playwright E2E: login flow, route guard, form validation
- [x] GitHub Actions: lint → typecheck → test → build
- [x] Dockerfile (multi-stage nginx)

## Phase 6 — Signals & Reactivity
- [x] Signal-based component state: `signal`, `computed`, `effect` with cleanup semantics — `src/app/core/reactivity/` covers the three teardown classes: `debouncedSignal` (effect `onCleanup` clearing a timer, where cancelling the previous timer *is* the debounce), `intervalSignal` (reactive period; changing it tears the old timer down before arming the new one, `null` pauses without resetting the count) and `mediaQuerySignal` (`DestroyRef.onDestroy`, kept deliberately effect-free as the contrast case — a string query gives an effect no reactive dependencies) (PR #18)
- [x] `linkedSignal` and `resource()` for async state with automatic request cancellation — `linkedSignal` replaces the layout shell's reset effect; `resource()` drives `PostDetailComponent`, with cancellation made real by `abortableRequest`, since `resource` aborts through an `AbortSignal` and `HttpClient` only cancels on unsubscribe (PR #19)
- [x] Zoneless change detection enabled end-to-end with a migration guide — no component needed converting, because the four writes that leave the reactive graph already land on `signal.set`; the work was in the test platform and in stopping the migration from rotting back (PR #20)
- [x] `OnPush` everywhere + a documented change-detection profiling method — all 15 production components are OnPush, enforced by `scripts/ci/assert-onpush-everywhere.sh` in the `lint` job (spec-file test hosts excluded); profiling method in `docs/change-detection-profiling.md` (DevTools Profiler, in-code `afterRenderEffect` counter, `ApplicationRef.isStable`) (PR #21)
- [x] RxJS interop: `toSignal`/`toObservable` boundaries and when to prefer each — one production caller each way, since a decision table nothing follows is not one. `toSignal`: `controlSignal`/`controlErrorSignal` bridge `AbstractControl.events`, which is the only way a reactive form reaches the graph at all — `docs/zoneless.md` had flagged the getters they replace as safe only while every writer arrives through a bound listener, which an async validator or a server-side `setErrors` does not. `toObservable`: `authGuard` waits out an in-flight session restore, the case that earns the conversion because `CanActivateFn` is one-shot and `filter` + `take(1)` has no signal spelling. Giving it something to wait for surfaced a real bug — restored tokens never fetched the user behind them, so a hard reload of a guarded route logged you out — fixed by `restoreSession()` from `provideAppInitializer`, not the store's `onInit`, where `jwtInterceptor`'s own `inject(AuthStore)` kills the request with NG0200 (pinned by `app.config.spec.ts`). 314 unit tests, up from 287; e2e 19→21 passing (PR #22)
- [x] Advanced RxJS: `switchMap` vs `concatMap` vs `exhaustMap` decision guide with a typeahead demo — `docs/rxjs-flattening.md`, written against callers that exist. `switchMap`: the `typeahead` primitive (`toObservable` → trim → `debounceTime` → `distinctUntilChanged` → `switchMap`, `catchError` on the **inner** Observable so one failed search does not end the pipeline and kill the box permanently), driving an ARIA combobox on `/dashboard/posts`; `PostsService.search` is the one read there that stays an Observable, because `switchMap` cancels by unsubscribing and a Promise has no teardown to invoke. `exhaustMap`: writing the guide exposed `AuthStore.login`/`register` on `switchMap`, where a second submit aborted the first — cancelling a POST discards the response, not the write, so the tokens are lost while the session they created is not; the forms' disabled buttons do not cover it, since under zoneless the `patchState` that sets `isLoading` schedules a refresh rather than performing one. `concatMap`/`mergeMap` have no caller here and the guide says so rather than inventing one. 356 unit tests, up from 314; coverage 93.16% statements / 90.32% branches against unchanged `karma.conf.js` thresholds; green on all 14 checks (PR #23)
- [x] Custom signal-based store primitive with devtools time-travel — `createSignalStore` in `@/app/core/store`, where every write carries a label and lands in a bounded, ordered log; that log is what `undo`/`redo`/`jumpTo` and the Redux DevTools bridge both run on. Not a replacement for `@ngrx/signals` — `AuthStore` stays a `signalStore` — with `ThemeService` as the production caller, since a jump backwards is visible on the `dark` class rather than only in a signal (PR #24)

Phase 6 item 1 complete as of PR #18 (2026-08-12). 254 unit tests (was 220) and
every gate green in CI on Node 22, 24 and 26; coverage 90.74% statements /
85.25% branches against unchanged `karma.conf.js` thresholds.

`LayoutShellComponent` is the first production caller: the mobile drawer kept its
open flag when the viewport grew past the `md` breakpoint, so narrowing again
reopened a drawer nobody had asked for. That reset is a side effect rather than a
derivation — `isMobileDrawerOpen` has two writers — which is why it is an `effect`
and not a `computed`. `docs/signals.md` records the decision table and the two
triggers that run a cleanup; `installFakeMediaQuery()` in `@/testing` replaces a
viewport a unit test cannot resize and reports its live listener count, so
teardown is asserted rather than assumed.

Known gaps carried into item 2: `debouncedSignal` and `intervalSignal` have no
production call site yet — the typeahead item later in this phase is what
`debouncedSignal` was written for. Existing specs still call the deprecated
`TestBed.flushEffects()`; new ones use `TestBed.tick()`. `linkedSignal` (item 2)
may well subsume the layout shell's reset effect.

Phase 6 item 2 complete as of PR #19 (2026-08-14). 284 unit tests (was 254) and
all fourteen checks green in CI on Node 22, 24 and 26; coverage 90.38%
statements / 84.93% branches against unchanged `karma.conf.js` thresholds.

It did subsume the reset effect. `LayoutShellComponent.isMobileDrawerOpen` is now
a `linkedSignal` sourced from the breakpoint: writable like the `signal` it was,
reset like the `computed` it could not be, and settled on read rather than a
flush late. The reset fires in both directions where the effect only fired on the
way up, which no user can observe — above the breakpoint the flag is neither
readable nor writable from the UI. Annotating the computation `(): boolean` is
load-bearing; inferred from `false` alone the signal is `WritableSignal<false>`
and `toggleDrawer` stops compiling.

`resource()` drives `PostDetailComponent`; `PostsListComponent` deliberately
stays on TanStack Query, so both patterns now ship on real routes and
`docs/signals.md` compares them from two files rather than in the abstract. The
cancellation half was the real work: `resource` aborts a superseded load through
an `AbortSignal`, but `lastValueFrom` discards the subscription and unsubscribing
is the only cancellation `HttpClient` understands — the obvious loader honours
the signal in appearance only. `abortableRequest` in `src/app/core/reactivity/`
keeps the subscription and drops it on abort, and `PostsService`'s two reads take
an optional `AbortSignal`. The mutations do not: aborting a write the server may
already have acted on loses a result rather than cancelling one.

Known gaps carried into item 3: `PostDetailComponent` and `PostsListComponent`
still lack `OnPush`, which item 3 of this phase covers directly.
`injectPostQuery` now has no caller though it keeps its specs, which matches the
never-called mutation helpers beside it. `debouncedSignal` and `intervalSignal`
are still waiting on the typeahead item. `resource()` is used for exactly one
read; anything paginated stays on the query, per the new decision table.

Phase 6 item 3 complete as of PR #20 (2026-08-16). 287 unit tests (was 284) and
all thirteen checks green in CI on Node 22, 24 and 26; coverage 90.46%
statements / 84.93% branches against unchanged `karma.conf.js` thresholds. The
initial bundle drops 579.05 kB → 543.60 kB raw (155.28 → 143.63 kB transfer), and
the `initial` budget goes 600 kB → 565 kB to hold the documented 21 kB of
headroom constant rather than let it absorb the win.

No application source changed. Two prior items had already moved every write that
leaves the reactive graph onto `signal.set` — the toast dismissal timer, the
media-query listener, the layout shell's router subscription, the debounce and
interval effects — so `provideZonelessChangeDetection()` plus an empty `polyfills`
array was the whole app-side migration. The reactive-forms error getters survive
for a subtler reason now written down in `docs/zoneless.md`: every change to a
control's state arrives through a `ControlValueAccessor` host listener or
`(ngSubmit)`, each of which marks the view dirty. A control mutated from outside
that path would not.

The real work was the test platform. Angular's Karma builder synthesises an entry
point that checks for `window.Zone` and, finding it, adds
`provideZoneChangeDetection()` — so the suite would have gone on exercising a
scheduler the app no longer uses, which is exactly the configuration where a green
suite says nothing about zoneless. `src/testing/test-main.ts` replaces it and
initialises the testing platform zoneless for every spec. ZoneJS stays in the
*test* polyfills deliberately: `debounced-signal.spec.ts` and
`interval-signal.spec.ts` need `fakeAsync`/`tick` both for virtual time and for
the end-of-spec leaked-timer check, and `jasmine.clock()` provides neither.
Angular logs NG0914 about the combination in `pnpm test` output; it is accurate,
it refers to the test bundle only, and `assert-no-warnings.sh` does not match it.

Neither half of the configuration fails loudly when it regresses, so both are
pinned and both guards were confirmed to fail on the regression they describe:
`app.config.spec.ts` (its providers outrank the testing platform's, so a
zone-based provider flips `NgZone.isInAngularZone()` and reddens three specs) and
`scripts/ci/assert-no-zonejs.sh` (greps the emitted bundles for ZoneJS's
`__load_patch`, wired into the build job). The second reads the artifact rather
than `angular.json` because putting `zone.js` back in the polyfills breaks
nothing and fails nothing — the only symptom is 35 kB nobody asked for.

Known gaps carried into item 4: the eight pre-existing Playwright failures
(register-form validation, failed-login error display, two route-guard redirects)
fail identically on `main` and were used as the before/after control proving this
change is behaviour-neutral in a real browser — 19 pass / 8 fail either way. They
are untouched, and e2e is still not a CI gate. `OnPush` is still missing from
eight components, which item 4 covers directly; under zoneless those components
are correct but checked more often than they need to be.

Phase 6 item 7 complete as of PR #24 (2026-08-24), closing the phase. 402 unit
tests, up from 356; all fourteen checks green in CI on Node 22, 24 and 26.
Coverage rose to 94.26% statements / 91.11% branches (from 93.16% / 90.32%)
against unchanged `karma.conf.js` thresholds. Initial bundle 551.37 kB against
the unchanged 565 kB budget — +2.04 kB for the primitive and nothing for the
bridge.

The log is the feature, and four decisions behind it each have a wrong answer
that looks fine. History holds snapshots rather than patches, so `jumpTo` is an
index assignment that cannot drift from what a replay would produce. Trimming
shifts indexes, so `Transition.id` is monotonic and never reused — which is why
`reset()` keeps its own reference to the initial state and is not a synonym for
`jumpTo(0)`, since a full log no longer starts at `@@init`. Writing while
travelled truncates the redo tail. And `subscribe` is synchronous rather than an
`effect`, because effects coalesce: two writes in one tick would be reported
once, and a devtools log that silently drops actions is worse than none.

The bridge maps the monitor's action ids through its own `sentIds` array instead
of assuming they match history indexes; the two agree right up until the first
trim or reset, after which a naive `history()[actionId]` lands on a neighbour.
`IMPORT_STATE` and `ACTION` are refused with a reason in the monitor rather than
left unimplemented — both would mean widening arbitrary JSON into `T`, and there
is no runtime schema here to validate against.

`ThemeService` reaches the bridge through a dynamic `import()` behind an
`environment.production` guard, so it ships as its own lazy chunk in development
and esbuild drops it from production entirely. Both halves were checked against
the emitted output rather than assumed. Because that import resolves late, the
bridge replays existing history on connect.

Worth recording for the next run: this container's default Node is 22.22.2, and
`.npmrc`'s `engine-strict=true` correctly refused to install against
`engines.node` — the Phase 0 gate from PR #17 doing its job. Node 24.19.0 was
installed to run the gates; the range was not loosened.

Known gaps carried into Phase 7: `historyLimit` bounds entry count, not bytes, so
a store holding large state can still grow. Programmatic travel does not move the
monitor's cursor — the extension protocol has no message for it. The bridge is
tested against a fake extension in both directions but has never been clicked
through with the real one, there being no browser with it installed in CI. And
`docs/signal-store.md` is the fourth decision-table doc in `docs/`; the README now
links six.

## Phase 7 — Architecture & Patterns
- [x] SOLID audit of services with before/after refactors in `docs/solid.md` — five findings, five refactors (`THEME_PREFERENCE_STORE`, `AUTH_BYPASS_PATHS`, a substitutable `createMockAuthStore`, `PostReader`/`PostSearcher`/`PostWriter`, `TOAST_SCHEDULER`/`TOAST_ID_FACTORY`); three violations recorded and deliberately left to their own items (PR #25)
- [x] Facade pattern over NgRx Signal Store to keep components framework-agnostic — `AuthFacade` in `src/app/core/auth/` publishes four reads and four commands over `AuthStore`'s twenty members. What it takes away was all reachable before: `accessToken`/`refreshToken` as signals a template could interpolate, `updateTokens` pointing the same hazard the other way, the bootstrap and transport methods (`restoreSession`, `loadFromStorage`, `refreshAccessToken`, `loadCurrentUser`), and `rxMethod`'s `T | Signal<T> | Observable<T>` call signature and its returned subscription — `signIn(credentials): void` closes that last one. It passes the store's own signals through rather than wrapping them, with a spec asserting the identity so a `computed()` wrapper has to argue with a test. `core/` stays exempt (guards, `jwtInterceptor` and `app.config.ts` own the session lifecycle); `features/` and `shared/` are held to it by `no-restricted-imports`, checked against the failure it names on `@ngrx/*` and `@/app/store/**` including type-only imports. `createFakeAuthFacade` replaces three hand-rolled `useValue: any` store doubles with one the compiler checks, and two things it still cannot check have specs: that the class publishes nothing beyond its interface, and that the double's defaults describe a state the facade can reach. `isAdmin`/`userRole`/`hasRole` deliberately left off — every role decision happens in `roleGuard` before a component exists. 450 specs, up from 431 (PR #26)
- [ ] Strategy pattern via multi-provider `InjectionToken` arrays
- [ ] Decorator pattern: `HttpInterceptorFn` composition for retry, cache, and telemetry
- [ ] Dependency inversion with abstract-class provider tokens, swapped in tests
- [ ] Dynamic component rendering with `ViewContainerRef` and typed inputs
- [ ] Standalone directive library: structural directive with a template type guard

## Phase 8 — Performance
- [ ] `@defer` blocks with viewport/interaction/timer triggers and prefetch
- [ ] Route-level code splitting audit with a per-route bundle budget in CI
- [ ] Virtual scrolling with the CDK for a 10k-row table
- [ ] SSR + hydration with Angular Universal, including incremental hydration
- [ ] Core Web Vitals instrumentation reported to an analytics sink
- [ ] `trackBy`/`@for` track expressions and an image-optimisation pass with `NgOptimizedImage`

## Phase 9 — Forms & Accessibility
- [ ] Typed reactive forms with a generic `FormGroup<T>` builder helper
- [ ] Custom `ControlValueAccessor` component with full validation integration
- [ ] Async cross-field validators with debounce and cancellation
- [ ] WCAG 2.2 AA audit with axe in CI, zero-violation gate
- [ ] Focus management, live regions, and route-change announcements
- [ ] i18n with `@angular/localize` including plurals and an RTL pass

## Phase 10 — Security & TDD
- [ ] CSP with nonces, Angular sanitisation policy, and a `bypassSecurityTrust` lint ban
- [ ] Token storage hardening: in-memory access token + httpOnly refresh cookie
- [ ] CSRF protection with `HttpClientXsrfModule` and a verified server contract
- [ ] OWASP Top 10 checklist with a test per mitigation
- [ ] TDD kata: one feature built red→green→refactor, one commit per step
- [ ] Mutation testing with Stryker + a CI threshold
