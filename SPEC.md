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
- [ ] RxJS interop: `toSignal`/`toObservable` boundaries and when to prefer each
- [ ] Advanced RxJS: `switchMap` vs `concatMap` vs `exhaustMap` decision guide with a typeahead demo
- [ ] Custom signal-based store primitive with devtools time-travel

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

## Phase 7 — Architecture & Patterns
- [ ] SOLID audit of services with before/after refactors in `docs/solid.md`
- [ ] Facade pattern over NgRx Signal Store to keep components framework-agnostic
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
