# Spec: boilerplate-angular

> Spec-driven. Mark `[x]` only after pushing.

## Phase 1 — Foundation
- [x] Angular 22 + TypeScript 6 + standalone components (no NgModules)
- [x] TailwindCSS 4 via PostCSS with CSS variable design tokens
- [x] ESLint 9 + Prettier + Husky pre-commit hooks
- [x] Path alias `@/` via tsconfig + angular.json
- [x] Typed env with `environment.ts` pattern

## Phase 2 — State & Data
- [ ] NgRx Signal Store for global state (auth slice)
- [ ] Angular 22 `HttpClient` typed service layer with interceptors
- [ ] JWT interceptor: attach Bearer token, handle 401 → refresh
- [ ] TanStack Query Angular adapter for server state

## Phase 3 — Routing & Auth
- [ ] Functional route guards: `authGuard`, `roleGuard`
- [ ] Lazy-loaded feature routes with `loadComponent`
- [ ] Auth pages: login, register with Angular Reactive Forms + Zod
- [ ] Route title strategy

## Phase 4 — UI System
- [ ] Angular CDK + CSS variables component library: Button, Input, Dialog, Toast
- [ ] Dark mode via class strategy + Angular service
- [ ] Responsive layout shell with sidebar + mobile drawer

## Phase 5 — Testing & DevOps
- [ ] Jasmine + Karma unit tests with Angular TestBed
- [ ] Playwright E2E: login flow, route guard, form validation
- [ ] GitHub Actions: lint → typecheck → test → build
- [ ] Dockerfile (multi-stage nginx)
