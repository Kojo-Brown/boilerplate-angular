# Server-side rendering, hydration, and incremental hydration

This application is built twice from the same source: once for the browser and once for
a Node process that renders it. `pnpm build` emits both into `dist/boilerplate-angular/`
— `browser/` for what a visitor downloads, `server/` for the renderer — plus a static
HTML file for every route that can be produced ahead of time.

What follows is the three decisions that shape it: **which routes the server may render**,
**how the browser adopts what it rendered**, and **which JavaScript is allowed to arrive
late**. Each is a trade with a measurable cost, and each has a gate.

---

## 1. Render modes: what the server is allowed to answer

`src/app/app.routes.server.ts` gives every route one of three modes.

| Route | Mode | Why |
| --- | --- | --- |
| `/login`, `/register`, `/unauthorized` | `Prerender` | Identical bytes for every visitor. Rendered once at build time, served as files. |
| everything else (`**`) | `Client` | The page depends on who is asking, and the server cannot know. |

### Why authenticated routes are not server-rendered

The session is an access token and a refresh token in `localStorage`
(`AUTH_TOKEN_STORAGE`). Nothing carries it to the server: there is one Node process
serving every visitor and no cookie for it to read. So on the server, `AuthStore` is
always signed out — for everyone, including people who are signed in.

Server-rendering `/dashboard` under that constraint has two possible outcomes, and both
are wrong:

- **Run `authGuard` on the server.** Every request gets a 302 to `/login`, signed-in
  visitors included, because the server has no way to tell them apart. The application
  becomes unusable for exactly the people it is for.
- **Skip the guard on the server.** An anonymous request is served the dashboard frame,
  which the client takes back the moment it hydrates and re-runs the guard: a flash of a
  page the viewer was never entitled to, and a render whose entire output is discarded.

`RenderMode.Client` says the honest thing instead — the browser decides — and the server
answers with `index.csr.html`, the application shell.

**What would change the answer:** Phase 10's token-storage item, an in-memory access
token plus an httpOnly refresh cookie. A cookie *does* reach the server, which is what
makes a per-request render of an authenticated page possible at all. Until then, every
`RenderMode.Server` route in this application would be a render of the signed-out page.

`app.routes.server.spec.ts` asserts that no guarded route is ever named here with
`Prerender` or `Server`, and `scripts/ci/assert-ssr.mjs` checks the other half against a
running server: that `/dashboard` comes back as an empty `<app-root>` and not as rendered
content.

### Why the public routes are prerendered rather than server-rendered

They compute nothing per request, so a per-request render would burn CPU to produce a
file that could have existed already. Prerendering also moves the render into the build,
where a failure is a red build rather than a 500 — which matters more than it sounds,
because `/login` is where every unauthenticated visitor lands.

The two routes the router only redirects through — `/` and the `**` fallback — are
resolved on the server as 302s, so a cold hit on `/` never ships a shell that immediately
navigates.

---

## 2. Hydration: adopting the server's DOM

`app.config.ts` declares:

```ts
provideClientHydration(withEventReplay()),
```

Without it, the browser throws away every node the server rendered and builds the page
again. That is not a slower hydration; it is a visible flash, a lost scroll position, and
an input the visitor had already typed into being recreated empty.

**`withEventReplay()` is the only feature named, and that is deliberate.** As of Angular
22, `provideClientHydration()` already brings DOM hydration, the `HttpClient` transfer
cache, and incremental hydration; `withIncrementalHydration()` is deprecated, so writing
it out would be noise that reads as significant. Event replay is the one recommended
feature still opt-in — and see §3 for why this application cannot do without it.

### The provider rule

`app.config.server.ts` adds exactly one thing to the browser configuration:
`provideServerRendering(withRoutes(serverRoutes))`. Everything else is shared.

That is not tidiness. Hydration's contract is that the second render agrees with the
first, so a provider that exists only on one platform is a behaviour the other will not
reproduce — and the symptom is a hydration mismatch in a component nowhere near the
provider. Anything that genuinely differs belongs behind an injection token with two
implementations instead. Two already exist:

- **`AUTH_TOKEN_STORAGE`** (`src/app/store/auth/token-storage.ts`) — the session's two
  keys, behind `read`/`write`/`clear`.
- **`THEME_PREFERENCE_STORE`** (`src/app/core/theme/theme-preference.ts`) — the theme
  choice and the OS preference.

Both resolve to a no-op where there is no browser storage, so neither needs a server
override.

### `storageOf`, and the bug that is not a missing global

Both tokens reach `localStorage` through one helper, `src/app/core/platform/web-storage.ts`:

```ts
export function storageOf(view: Window | null): Storage | null {
  try {
    return view?.localStorage ?? null;
  } catch {
    return null;
  }
}
```

Two things it fixes that `view?.localStorage.getItem(key)` does not.

Optional chaining on `view` guards a missing *window*, not a missing *property*: on a
window object that has no storage APIs, `view?.localStorage.getItem(k)` is a `TypeError`
rather than a skipped call. Whether a server-side `DOCUMENT.defaultView` is `null` or a
partial window is an implementation detail of whichever DOM the renderer uses, and not
something a service should be written against — asking for the property is the question
with a stable answer.

And in a browser, *reading the property itself* throws when site data is blocked, which
is why the access is inside the `try` rather than only the calls after it.

### The lint rule

`eslint.config.mjs` restricts `window`, `document`, `localStorage`, `sessionStorage` and
`navigator` as globals under `src/app/**` (specs excluded — they *are* the browser).
Everything there now runs twice, and a bare reference to one of them compiles, passes
every unit spec, and then throws while the injector is constructing a root service during
a render, taking the page with it. `AuthStore` did exactly this until the token seam
replaced it.

The reverse rule applies to `src/server.ts`: it is the one file that runs on Node and
never in a browser, and `types: ["node"]` in `tsconfig.app.json` — which it needs — puts
`process` in scope for the whole program.

There is one documented exception, in `core/store/devtools.ts`: a plain function with no
injector, reached through a dynamic import that can resolve after the injection context
is gone, where `typeof window === 'undefined'` is the correct form.

---

## 3. Incremental hydration: the JavaScript that arrives late

`/login` is prerendered, so the whole card — heading, banner, fields, button — is HTML
that needs no JavaScript to be *visible*. What it needs JavaScript for is being *usable*,
and that is 101.89 kB of `@angular/forms` and Zod against roughly 5 kB for everything
else on the page (`docs/route-budgets.md`).

`login.component.ts` separates the two:

```html
@defer (hydrate on interaction) {
  <app-login-form />
}
```

A `hydrate` trigger renders the block's **main content** on the server — never the
placeholder. That is the whole difference between incremental hydration and ordinary
deferring: the visitor sees the finished form immediately, and the browser downloads and
hydrates it on the first click or keystroke.

### What it bought

| | `/login` | `/register` (unchanged, as the control) |
| --- | ---: | ---: |
| Lazy JS to reach the route | **2.94 kB** | 111.15 kB |
| …before this change | 109.65 kB | 111.74 kB |

`pnpm check:routes` holds that number: `/login`'s budget moved from 112 kB to 4 kB in the
same commit. A budget left at its old ceiling would have passed just as happily on the day
the block stopped deferring, which is the regression the number now catches.

### The hazard: a dehydrated form is live HTML

Between paint and hydration the form is real markup with no listeners on it — and Angular
does not neutralise it. Event replay runs *after* the browser has dispatched the event;
the only default it suppresses beforehand is a click on an `<a>`
(`shouldPreventDefaultBeforeDispatching` in the event-dispatch primitive, which tests
`actionElement.tagName === 'A'` and nothing else).

So a `<button type="submit">` inside a dehydrated block still performs a **native form
submission** on a pre-hydration click: a GET navigation back to `/login` that throws away
whatever the visitor had typed. Intermittently, and only on the slow connections that made
deferring worth doing in the first place.

`login-form.component.ts` makes the markup inert instead of relying on replay to undo it:

- The submit control is `<button type="button">` with `(click)`. It has no default action,
  so a pre-hydration click does nothing except fire the hydrate trigger; replay then
  delivers it to the handler once the component exists.
- With no submit button in the form, the browser performs no implicit submission from the
  keyboard either — and would not have here regardless, since implicit submission is
  skipped when a form has more than one field that blocks it. So Enter is bound on both
  fields explicitly.

`login-form.component.spec.ts` asserts the button's type and the Enter binding;
`assert-ssr.mjs` asserts against the prerendered HTML that no `type="submit"` button was
emitted inside the block.

### The second hazard: hydration empties the fields

This one is not about `@defer` at all — it is about server-rendering a reactive form —
but deferring makes it worse, so it was found here.

A prerendered form is visible before its JavaScript arrives, which is the point, so a
visitor can start typing into it. When the JavaScript does arrive,
`FormControlName.ngOnInit` calls `setUpControl`, which calls
`valueAccessor.writeValue(control.value)` — the control's *initial* value, an empty
string, written straight over the node being typed into.

Measured against the production build with every script delayed, on the build before the
fix:

| Page | Typed value gone after |
| --- | --- |
| `/register` (ordinary hydration) | 2.5 s |
| `/login` (hydration deferred to first interaction) | 5.1 s |

Nothing warns. The field simply empties, and only on the slow connections that make
prerendering worth doing. Event replay does not cover it and cannot — it dispatches the
captured event *after* the DOM has been overwritten, and a value accessor reads
`target.value` at dispatch time. `ngSkipHydration` does not either: it destroys the
subtree and renders it again, which empties the field by a different route.

The fix is to seed the controls from the DOM rather than let the DOM be written from the
controls. `typedBeforeHydration` (`src/app/core/platform/pre-hydration-input.ts`) is
called from the component's **constructor**, which runs before the `FormControlName`
directives in its own template are initialised and after hydration has put the server's
markup under the host — the one moment where the typed value still exists and nothing has
decided to replace it:

```ts
private readonly typed = typedBeforeHydration(
  inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
  ['email', 'password'] as const
);

protected readonly form = this.fb.group({
  email: [this.typed.email ?? '', [zodValidator(loginSchema.shape.email)]],
  password: [this.typed.password ?? '', [zodValidator(loginSchema.shape.password)]],
});
```

Both prerendered forms use it. On a client-rendered visit the host has no children yet,
every lookup misses, and the form is seeded with the empty strings it would have had.

With it in place, the same probe against the production server — every script delayed,
an invalid email and a short password typed before hydration, then one click on the
submit control — gives: the values still in the fields, the URL still `/login`, the
deferred chunk requested only after the click, and both validation messages rendered,
which is the replayed click arriving in `onSubmit()`. That measurement is a manual probe
against a real browser rather than a CI gate: `pnpm check:ssr` runs without one, and
Playwright is not gated here yet. `pre-hydration-input.spec.ts` covers the mechanism.

### What happens when the page is not hydrating

A block that declares only `hydrate` triggers has no ordinary trigger, so the compiler
adds an implicit `on idle` (`ingestDeferBlock` in the template compiler:
`if (!hasConcreteTrigger) …`). That is what runs when `/login` is reached by a navigation
from inside the application, and in every unit test — a `TestBed` has no dehydrated markup
to trigger against. `login.component.spec.ts` covers both: the block driven manually, and
the idle fallback under `DeferBlockBehavior.Playthrough`.

The block carries no `@placeholder`, and does not need one: a hydrate trigger resolves
against the block's *main* view rather than a placeholder's root node.

### Where it does not apply

Nowhere else, yet. Incremental hydration only means anything on a page the server
rendered, and every other page in this application is `RenderMode.Client`. The three
`@defer` blocks on `/dashboard` keep their ordinary `on viewport` / `on interaction` /
`on timer` triggers (`docs/defer.md`) — adding `hydrate` triggers there would be
decoration, since nothing hydrates a client-rendered route. That changes with the same
Phase 10 item as §1.

---

## Running it

```bash
pnpm build
NG_ALLOWED_HOSTS=localhost pnpm serve:ssr   # http://localhost:4000
```

### `NG_ALLOWED_HOSTS` is not optional

Angular validates the `Host` and `X-Forwarded-Host` of every request against an
allow-list, and that list is **empty** unless something fills it. An unconfigured server
starts happily and then answers every request with a 400 about server-side request
forgery — which reads as an attack rather than as a missing environment variable.

`src/server.ts` makes the missing variable the failure instead, at the one moment where
the fix is obvious. It is deliberately not defaulted to `localhost`: a default that works
on a laptop and silently rejects production traffic is the failure the check exists to
prevent.

Set it to the hostnames the server is actually reached by, comma-separated
(`NG_ALLOWED_HOSTS=example.com,www.example.com`). Behind a proxy that rewrites the host,
`NG_TRUST_PROXY_HEADERS` names the `X-Forwarded-*` headers the engine may believe.

One detail worth knowing if you extend that startup path: constructing
`AngularNodeAppEngine` installs a process-wide `uncaughtException` handler that logs and
returns, so a top-level `throw` from `server.ts` is swallowed and the process exits **0**.
Startup failures there use `console.error` + `process.exit(1)`.

---

## The gates

| Command | What it would catch |
| --- | --- |
| `pnpm check:ssr` | A render that stopped happening, a render mode that changed, a `@defer (hydrate …)` block that is no longer dehydrated, the host check turned off, a server that starts unconfigured. |
| `pnpm check:defer` | The login form's chunk merging back into the page's — invisible to every other gate, because the server renders the block either way. |
| `pnpm check:routes` | `/login` costing more than 4 kB to reach again. |

One thing SSR cost the pipeline, recorded here because it looks like a weakened gate and
is not: the two steps that run `ng build` no longer carry
`NODE_OPTIONS=--throw-deprecation`. On Node 26, `module.register()` is deprecated
(DEP0205) and Angular's route extractor calls it from inside a prerender worker, so the
flag turns that one dependency line into `An error occurred while extracting routes` and
zero prerendered pages — on every published Angular 22 release, `22.2.0-next.7` included.
`--disable-warning=DEP0205` does not rescue it either: the throw happens before the
disable list is consulted, verified on Node 26.8.2. Those steps now have their logs read
by `assert-no-unexpected-deprecations.sh`, which fails on any deprecation whose code is
not allow-listed with a reason. Every other job still throws.

`assert-ssr.mjs` is the only gate in `scripts/ci/` that *runs* the build rather than
reading it, and that is the point: a browser-only global reached during a render, a
platform-specific provider, a route whose mode changed — all of them compile, pass every
unit spec (which run in a browser, where none is reachable), and produce a `dist/` that
looks right. The only place the answer exists is in the bytes the server sends.

## Deploying

The `Dockerfile` runs the Node server rather than serving `browser/` from nginx, because
half the routes now need a process. `nginx.conf` is kept for the static-only deployment
that a `RenderMode.Client`-everywhere build still supports — point it at
`dist/boilerplate-angular/browser` and let `index.csr.html` be the fallback document.
