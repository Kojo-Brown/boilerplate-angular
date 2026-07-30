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
