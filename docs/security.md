# Content-Security-Policy, sanitisation, and the two bans

Three things that are one thing: a nonce-based CSP minted per response, Angular's
sanitiser left switched on, and `DomSanitizer.bypassSecurityTrust*` refused twice over —
once where it is written and once where it runs.

- `src/app/core/security/csp.ts` — the policy, derived from the environment
- `src/app/core/security/nonce.ts` — the nonce, and how it reaches a document nobody
  renders per request
- `src/app/core/security/sanitisation.ts` — the policy on untrusted markup, and the one
  sanctioned way to render it
- `src/server.ts` — where a response gets its nonce
- `scripts/ci/assert-csp.mjs` — the gate
- `eslint.config.mjs` — the ban

## The problem a nonce has in this application

A nonce is worth something because an attacker cannot guess it. `script-src 'nonce-abc'`
authorises the inline scripts carrying `nonce="abc"`, and if an attacker knows `abc` then
the markup they inject carries it too and the policy authorises their script beside ours.

Which is awkward here, because **this application does not render a document per
request.** `/login`, `/register` and `/unauthorized` are `RenderMode.Prerender` — files
produced once, at build time — and every other route is `RenderMode.Client`, served the
prebuilt `index.csr.html` shell. There is no per-request render to hang a per-request
value off. See `src/app/app.routes.server.ts` for why that is the right call for the
routes themselves.

So a literal nonce in `src/index.html` is not a weaker version of a nonce deployment. It
is the mechanism switched off while still reading as one: a single value, baked into
static files, visible in `view-source` to everyone, valid until the next deploy. That is
`'unsafe-inline'` wearing a nonce's clothes, and it is worse than `'unsafe-inline'`
because nobody auditing the header would notice.

### What makes this hard to get right is that every failure works

This is the property that shapes everything below, including why there is a gate at all.
A nonce has exactly one security property, and **every way of losing it leaves a working
application**:

| Mistake | What a visitor sees | What a tool reports |
| --- | --- | --- |
| Nonce hardcoded in `index.html` | Correct page | Nothing |
| Same nonce reused for every response | Correct page | Nothing |
| Nonce-bearing HTML served with an `ETag` | Correct page | Nothing |
| Nonce-bearing HTML cached by a CDN | Correct page | Nothing |

There is no console error, no failed request, no visual defect, and nothing for axe to
say. The policy and the document agree — they just agree on a constant. The only loud
failure in the whole design is the header and the body disagreeing, which blocks the
application outright and is therefore the one case that would never ship.

That is measured, not argued. With the `ETag` deletion in `src/server.ts` removed, three
loads of `/login` in Chromium produced **one** nonce for all three, the page rendering
correctly every time. With it in place, three loads produce three nonces.

## How the nonce gets in

Two phases: the build writes a placeholder, the response substitutes it.

1. `src/index.html` carries `<app-root ngCspNonce="NGCSP_NONCE_SUBSTITUTED_PER_RESPONSE">`.
   The value is deliberately not base64 and deliberately self-describing — anyone who
   finds it in a served response has found a bug, and the string says which.
2. The build propagates it. Three separate pieces of Angular do this, and all three
   happen before the response exists, which is why the placeholder has to be in the
   template rather than injected into finished HTML:
   - The critical-CSS inliner (beasties, via `@angular/ssr`) nonces the `<style>` block
     it inlines **and** rewrites the deferred stylesheet's `onload="this.media='all'"`
     into a `media` attribute plus a nonced loader script. Without `ngCspNonce` it leaves
     the `onload` in place — and an inline event handler is the one thing a nonce can
     never authorise, because an attribute has nowhere to carry one. Before the
     placeholder was added, every built page carried that `onload`; after, none do.
   - `@angular/build`'s `addNonce` pass copies the value onto every inline `<style>` and
     `<script>` without one, the jsaction event-dispatch-contract script included. This
     does most of the work, and it runs for `ng serve` too.
   - `@angular/platform-server` nonces the `window.__jsaction_bootstrap(…)` script it
     injects for event replay, from `CSP_NONCE` in the render-time injector.
     `src/app/app.config.server.ts` provides the placeholder there.
3. `src/server.ts` replaces the placeholder with a fresh 128-bit nonce on the way out and
   sets a matching `Content-Security-Policy`.
4. In the browser, Angular's own default for `CSP_NONCE` reads the live `ngCspNonce`
   attribute off `<app-root>` — by then the real nonce — and uses it for the `<style>`
   elements it injects as lazy components arrive.

`CSP_NONCE` is provided **only** in `app.config.server.ts`, never in the shared
`appConfig`. Providing it in the shared config would override step 4's default with the
build-time placeholder, and every runtime-injected `<style>` would carry a nonce the
policy does not list: no error, no warning, just lazily-routed components rendering
unstyled in a production build. `app.config.spec.ts` asserts the shared config does not
provide it.

### `ng-state` is the one inline script with no nonce, correctly

`<script id="ng-state" type="application/json">` is the hydration transfer-state data
block. A non-JavaScript `type` means the browser never executes it, so `script-src` does
not apply and there is nothing to authorise. Confirmed rather than assumed: it is
un-nonced in every built page and no browser reports a violation for it.

### What `applyCspNonce` deliberately does not do

It replaces a token it put there itself, and nothing else. The tempting alternative — "add
a `nonce` to every inline script that lacks one" — sounds like robustness and is the
opposite: the point of a nonce is to enumerate what may execute, and a rule that
credentials whatever it finds has stopped enumerating. If a future Angular emits an inline
script that `addNonce` does not reach, the right outcome is a failed build and a person
reading the diff. `assert-csp.mjs` asserts exactly that.

## The cost: prerendered pages stop being cacheable

A nonced document cannot be cached, so `src/server.ts` strips the `ETag` and
`Last-Modified` from it and sends `Cache-Control: no-cache, private`. It also strips
`If-None-Match` and `If-Modified-Since` from incoming document requests, so the answer
does not depend on what any intermediary happened to have cached — including a copy
served before the policy existed, which is the one case a response header cannot reach.

This is a real loss, and worth naming plainly: prerendering `/login` exists to make it a
file a CDN can hold, and a per-response nonce takes that back. Three things make it the
right trade here anyway:

- `no-cache` rather than `no-store`, so the page is still eligible for the browser's
  back/forward cache. With no validator there is nothing for a revalidation to succeed
  on, so the browser re-fetches and gets a fresh nonce either way.
- Only documents are affected. The content-hashed chunks and stylesheets keep their
  one-year `max-age`, and `assert-csp.mjs` asserts they do — the obvious wrong fix here
  is a blanket `no-store`, which would re-download the bundle on every navigation and
  show up as nothing but a slower application.
- The alternative buys less than it looks like. See below.

### Why not hashes, and why not `autoCsp`

A hash-based policy (`script-src 'sha256-…'`) is static, so it keeps the pages cacheable.
Angular 22 even ships it: `security.autoCsp` in `angular.json` hashes the inline scripts
at build time and emits `script-src 'strict-dynamic' 'sha256-…'`. It is deliberately not
used here, for two reasons:

- It covers `script-src`, `object-src` and `base-uri` and nothing else. Everything the
  rest of this policy does — `style-src`, `connect-src`, `img-src`, `frame-ancestors`,
  `form-action`, and the `trusted-types` allow-list the sanitisation policy leans on
  — would still have to come from somewhere.
- A hash authorises a fixed string, and the `<style>` elements Angular injects as lazy
  components arrive are not fixed when the policy is built. A nonce is the only credential
  Angular's browser runtime can be handed for those, which it reads off `ngCspNonce`.

The two are also not additive: both rewrite `index.html`, so turning `autoCsp` on would
replace this application's `<script src>` tags with a generated loader script and emit a
second, narrower policy beside this one.

## The policy

Built by `buildContentSecurityPolicy`, which is a pure function of one response's nonce
and three values from `src/environments/`. It is computed rather than written down because
`apiUrl`, `imageCdnUrl` and `vitalsUrl` are configurable: a hardcoded policy is correct
for the checked-in defaults and silently blocks every image the moment someone points
`imageCdnUrl` at a CDN, with nothing failing at build time because the default has no CDN.

For the checked-in production build:

```
default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'nonce-…';
style-src-attr 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self';
object-src 'none'; base-uri 'self'; frame-ancestors 'none'; frame-src 'none';
form-action 'self'; require-trusted-types-for 'script';
trusted-types angular angular#components
```

Every directive is spelled out, including the ones that would fall back to `default-src`,
because a policy gets read during an incident and an inherited directive is one the reader
has to reconstruct.

Three choices worth the words:

**`style-src-attr 'unsafe-inline'` is the one concession.** A `style="…"` attribute cannot
carry a nonce, so a nonce in `style-src` blocks every inline style attribute in the
document — and Angular renders `[style.x]` bindings into exactly that when it renders on
the server. The directive is named explicitly rather than left to fall back, so the
concession is visible to whoever reads the policy instead of being an unexplained absence.
What it gives up is bounded: a style attribute cannot execute script, so the residual risk
is CSS-level — exfiltration via attribute selectors, or restyling to mislead — while
`script-src`, where code execution lives, stays strict.

**No `'strict-dynamic'`,** and the reason is narrower than usual. Because `addNonce` nonces
the `<script src>` entry points too, `'strict-dynamic'` would trust them. What it would not
reach is the lazy route chunks: those are fetched as ES modules by `import()` rather than
created as script elements, and `'strict-dynamic'` makes a browser ignore the host sources
— `'self'` — that authorise them today. Adopting it would mean proving that per browser and
accepting that every lazy route is one engine quirk away from failing silently. `'self'`
over same-origin, content-hashed filenames is the weaker guarantee and the one whose
failure mode is understood.

**No `data:` in `img-src`.** It is the reflex addition and nothing here needs it:
`NgOptimizedImage` emits a data URI only for a `placeholder`, and no template sets one.

## Development gets the same policy

The Angular CLI's dev server routes through `src/server.ts` — it imports `reqHandler` — so
`ng serve` is served this header too. That is deliberate: a policy that only exists in
production is first exercised in production, by a visitor.

It is also free, which was not the expectation. The first draft carried `'unsafe-eval'` and
`ws: wss:` as development allowances, on the assumption that Vite's HMR client needs both.
Measured instead of assumed, neither is used: with both removed, editing a component
template while a page is open applies the update over HMR in one navigation with no
violation, because the HMR socket is same-origin and `'self'` covers a websocket to the
document's own host and port. The two policies therefore differ only in what
`environment.apiUrl` resolves to, and the production build has no relaxation to
accidentally inherit.

**Known cost, kept rather than paid for:** the dev server's error overlay sets an inline
`style` on an element it creates, which `style-src` refuses, so a compile error renders the
overlay unstyled. Adding `'unsafe-inline'` to `style-src` for development would fix the
cosmetics by diverging the two policies in the exact directive most worth testing, and the
error is already on the terminal.

## The sanitisation policy

1. **Interpolation is the default and needs no help.** `{{ value }}` escapes, always.
   Every string this application renders today goes through it.
2. **`[innerHTML]` is allowed, because Angular sanitises it.** Binding a string to
   `[innerHTML]` runs it through the sanitiser; tags and attributes outside a known-safe
   allow-list are dropped. It is a *safe* construct and banning it would be banning the
   framework's own defence.
3. **`DomSanitizer.bypassSecurityTrust*` is banned.** Those five methods are the only way
   to put a string into a dangerous sink with the sanitiser off, which makes them the only
   place an XSS can originate in an Angular template.

`HtmlSanitiser` in `core/security` is the sanctioned answer to "then how do I render
markup a server sent me?", and it exists because a ban with no alternative gets worked
around — and the workaround is `bypassSecurityTrustHtml`. It has no caller yet; every
string rendered today goes through rule 1.

### `sanitize()` is not a guarantee — its parameter type is

`DomSanitizer.sanitize()` checks whether its argument is already a `SafeValue` and, if it
is, returns the string inside it **unsanitised**. It is a no-op on exactly the input you
would most want it to clean.

So `sanitize(SecurityContext.HTML, x)` is only a guarantee while `x` cannot be a
`SafeValue`, which is a question about its *type*, not about the call.
`HtmlSanitiser.sanitise` takes `string` — a bypassed value is an object and will not
type-check — so the only way to defeat it is to defeat rule 3 first.

### What the sanitiser actually does

`sanitisation.spec.ts` asserts each of these against the real sanitiser rather than
trusting this list, because the allow-list is Angular's and can move. One case is worth
repeating here because everybody states it wrongly, including the first draft of that
spec: **a `javascript:` URL is not removed.** Angular rewrites it to `unsafe:javascript:`,
and the safety comes from no browser having a handler for an `unsafe:` scheme — the link
renders, is visible, and does nothing. When auditing, finding `javascript:` in sanitised
output is not by itself a finding; finding it *without* the prefix is.

## Why the ban needs two mechanisms

Nothing flags a bypass on its own. The method names are deliberately alarming and that is
the entire safeguard, so a call survives typecheck, lint, every spec, and review by anyone
who reads `bypassSecurityTrust` as "this value is trusted" rather than "stop checking".

- **ESLint** (`no-restricted-syntax` on the property name) fails the build on the call.
  This is the one that catches it before it merges and the one a developer can read the
  reason off. It is matched on the property name alone, so it catches the call however the
  sanitiser was reached — including `sanitizer['bypassSecurityTrustHtml']`, written to get
  around a rule that only looked at dotted access.
- **Trusted Types** catches what ESLint cannot. `require-trusted-types-for 'script'` turns
  the dangerous DOM sinks into type errors unless the value came from a registered policy,
  and `trusted-types angular angular#components` lists the two policies Angular and the
  CDK register for their own sanitised output — while omitting `angular#unsafe-bypass`, which is the
  policy name `@angular/core` registers for exactly those five methods. The browser
  refuses to create it, Angular's helper catches the failure and falls back to handing the
  DOM a plain string, and `require-trusted-types-for` makes that assignment throw.

The second is what still works when the code did not come through this repository's lint:
a dependency, a snippet pasted into a `<script>`, a contributor with `--no-verify`.

`angular#unsafe-jit` is omitted too. It is `@angular/compiler` compiling a template in the
browser, and this application is built ahead of time — needing it would mean the compiler
had been pulled into the bundle.

The one sanctioned bypass call in the repository is in `sanitisation.spec.ts`, with an
`eslint-disable-next-line`, and it is there to prove why the rule exists.

## The gate

`pnpm check:csp` runs the built server and reads what it answers, in the `build` job
beside `check:ssr`. Nine rules, and most of them compare *two* responses, because that is
the one thing a single request cannot show. In order:

1. `src/index.html` and `CSP_NONCE_PLACEHOLDER` still agree. The placeholder is a literal
   in a template that cannot import the constant, so it is the one piece of this held
   together by hand.
2. Every HTML response carries a policy, and the policy carries a nonce.
3. **Two requests to the same URL get different nonces.** Rule 2 passes for a static
   nonce; this is the rule that does not.
4. The header's nonce is the body's nonce, and the placeholder is gone from both.
5. Every inline `<script>` a browser would execute carries the nonce; `application/json`
   data blocks are exempt and asserted to be exempt.
6. No inline event-handler attribute survives anywhere in the document.
7. The document is not cacheable: no validator, and a `Cache-Control` that keeps it out
   of a shared cache.
8. The policy still refuses `'unsafe-inline'`, `'unsafe-eval'` and `angular#unsafe-bypass`.
9. The hashed subresources are still cacheable, and carry no policy header of their own.

Each rule was checked against the failure it names rather than only against a passing
tree. Removing `ngCspNonce` from `index.html` and rebuilding turns up 13 problems, among
them the returned `onload="this.media='all'"` and the event-dispatch-contract script
losing its nonce; keeping the `ETag` fails rules 3 and 7; a typo in the placeholder fails
rule 1.

## What is not covered

- **Where the session's credentials live is a separate document.** The CSP and the
  sanitisation bans here raise the cost of getting script onto the page;
  [token storage](./token-storage.md) is about what that script can take if it succeeds,
  and the two are complementary rather than overlapping. Neither claims to prevent XSS.
- **The policy is not report-only anywhere, and there is no reporting endpoint.** A
  `report-to` would turn violations in the field into data; it needs a collector, which is
  a deployment decision rather than a repository one.
- **`frame-ancestors 'none'` and `form-action 'self'` are asserted in the header, not
  against a browser.** Nothing in CI tries to frame the application or redirect a form.
- **`googleClientId` is declared in `environment.model.ts` and unused.** If an OAuth flow
  ever uses it, `frame-src 'none'` is what will need revisiting — Google Identity Services
  renders in an iframe.
- **The Trusted Types allow-list was arrived at by reading every `createPolicy` call in
  `node_modules`.** A dependency that registers a new policy will fail at its sink, at
  runtime, with nothing in CI to catch it first.
