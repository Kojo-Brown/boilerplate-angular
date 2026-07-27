# Spec: boilerplate-angular

> Spec-driven. Mark `[x]` only after pushing.

## Phase 0 — Green Baseline (blocks all feature work)
- [ ] Verify every dependency version actually exists on the registry and fix the ones that do not, then commit a lockfile
- [ ] Get `install`, `typecheck`, `lint`, `test`, and `build` all passing locally from a clean clone
- [ ] Promote `workflow-templates/ci.yml` to `.github/workflows/ci.yml` and confirm it runs green on a PR
- [ ] Add a CI job matrix covering the supported Node version and fail the build on any warning

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
- [ ] Signal-based component state: `signal`, `computed`, `effect` with cleanup semantics
- [ ] `linkedSignal` and `resource()` for async state with automatic request cancellation
- [ ] Zoneless change detection enabled end-to-end with a migration guide
- [ ] `OnPush` everywhere + a documented change-detection profiling method
- [ ] RxJS interop: `toSignal`/`toObservable` boundaries and when to prefer each
- [ ] Advanced RxJS: `switchMap` vs `concatMap` vs `exhaustMap` decision guide with a typeahead demo
- [ ] Custom signal-based store primitive with devtools time-travel

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
