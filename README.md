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

Node `^22.22.3 || ^24.15.0 || >=26.0.0` and pnpm 10. The Angular 22 CLI refuses
to run on older Node patch releases, so the floor is declared in `engines`
rather than left to be discovered at build time.

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
| `pnpm lint`        | ESLint over `src/`                                          |
| `pnpm format:check`| Prettier check (use `pnpm format` to rewrite)               |
| `pnpm test`        | Karma unit tests, single run                                |
| `pnpm test:ci`     | Same, pinned to the sandboxed `ChromeHeadlessCI` launcher   |
| `pnpm e2e`         | Playwright end-to-end tests                                 |

CI runs lint, typecheck, and tests in parallel, then builds once all three are
green — see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

Use `pnpm test:ci` rather than `pnpm test -- --browsers=…` in scripted contexts:
the extra `--` makes the Angular CLI read `--no-watch`/`--no-progress` as unknown
positional arguments and abort before Karma starts.

## Testing notes

**TestBed is zoneless by default in Angular 22.** `fixture.detectChanges()` only
refreshes views that something has marked dirty, so assigning to a plain field on
a host component does *not* re-render the component under test — the assertion
then sees stale DOM and fails in a way that looks like a component bug. Hold host
state in **signals**:

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

## Spec Progress
See [SPEC.md](./SPEC.md).
