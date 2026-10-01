/**
 * The Content-Security-Policy this application serves, as a function of one response's
 * nonce and the environment it was built for.
 *
 * ## Why this is computed rather than written down
 *
 * Three of the directives below depend on configuration that is a build-time constant:
 * `apiUrl`, `imageCdnUrl` and `vitalsUrl` in `src/environments/`. A hardcoded policy
 * string would be correct for exactly the checked-in defaults — where all three are
 * same-origin or empty — and would silently block every image the moment someone
 * configured a CDN, every request the moment the API moved to its own host, and every
 * web-vitals beacon the moment a collector was pointed at. The failure mode is the worst
 * kind: nothing fails at build time, nothing fails in a unit spec, and the application
 * works for whoever did not configure the thing.
 *
 * So the policy is derived from the same objects the application itself reads, and
 * `csp.spec.ts` asserts the derivation rather than the resulting string.
 *
 * ## There is one policy, and development gets it too
 *
 * The Angular CLI's dev server routes through `src/server.ts` — it imports `reqHandler` —
 * so `ng serve` is served this header as well. That is deliberate: a policy that only
 * exists in production is first exercised in production, by a visitor.
 *
 * It is also free, which was not the expectation. The first draft carried `'unsafe-eval'`
 * and `ws: wss:` as development allowances, on the assumption that Vite's HMR client
 * needs both. Measured instead of assumed, neither is used: with both removed, editing a
 * component template while a page is open applies the update over HMR with one
 * navigation and no violation, because the HMR socket is same-origin and `'self'` covers
 * a websocket to the document's own host and port. So the two policies differ only in
 * what `environment.apiUrl` resolves to, and the production build has no relaxation to
 * accidentally inherit.
 *
 * One known cost, kept rather than paid for: the dev server's error overlay sets an
 * inline `style` on an element it creates, which `style-src` refuses, so a compile error
 * renders the overlay unstyled. Adding `'unsafe-inline'` to `style-src` for development
 * would fix the cosmetics by diverging the two policies in the exact directive most
 * worth testing, and the error is already on the terminal.
 *
 * ## Why a header rather than `<meta http-equiv>`
 *
 * `frame-ancestors` and `report-uri`/`report-to` are ignored in a `<meta>` policy, and
 * `frame-ancestors` is the directive doing the clickjacking work below. A header is also
 * the only place a *per-response* value can live for a document that was rendered once
 * at build time — see `nonce.ts`.
 *
 * ## Why not `autoCsp`
 *
 * Angular 22 ships `security.autoCsp` in `angular.json`, which hashes the inline scripts
 * at build time and emits `script-src 'strict-dynamic' 'sha256-…'`. It is a good feature
 * and it is deliberately not used here, for two reasons rather than one:
 *
 *   - It covers `script-src`, `object-src` and `base-uri` and nothing else. Everything
 *     this file adds — `style-src`, `connect-src`, `img-src`, `frame-ancestors`,
 *     `form-action`, and the `trusted-types` allow-list that does the work in
 *     `sanitisation.ts` — would still have to be written and served from somewhere.
 *   - A hash authorises a *fixed* string, and the `<style>` elements Angular injects as
 *     lazy components arrive are not fixed at the time the policy is built. A nonce is
 *     the only credential Angular's browser runtime can be handed for those, which it
 *     reads off `ngCspNonce` (see `nonce.ts`).
 *
 * The two mechanisms also both rewrite `index.html`, so they are not additive: turning
 * `autoCsp` on would replace this application's own `<script src>` tags with a generated
 * loader script and emit a second, narrower policy beside this one.
 */

/** The response header. `Content-Security-Policy-Report-Only` is the other spelling. */
export const CSP_HEADER = 'Content-Security-Policy';

/**
 * The Trusted Types policies this application allows to exist.
 *
 * Exported because `csp.spec.ts` asserts the omissions below are deliberate, and because
 * the list is the enforcement mechanism rather than a detail of it:
 *
 *   - `angular` — `@angular/core`'s own policy, used for every value that has been
 *     through `DomSanitizer.sanitize()`. Omitting it would break `[innerHTML]` entirely.
 *   - `angular#components` — `@angular/cdk`'s, used by its one `innerHTML` assignment,
 *     in `LiveAnnouncer` when a message arrives as markup rather than as a string. This
 *     application only announces strings, which take the `textContent` path, so nothing
 *     here reaches it today — it is allowed because the CDK can, and the cost of being
 *     wrong is asymmetric: a policy name costs nothing, while omitting one fails at the
 *     DOM sink at runtime with nothing in CI to catch it first.
 *
 * Not here, on purpose:
 *
 *   - `angular#unsafe-bypass` — `bypassSecurityTrust*`. See `sanitisation.ts`.
 *   - `angular#unsafe-jit` — `@angular/compiler` compiling a template in the browser.
 *     This application is built ahead of time, so needing it would mean the compiler had
 *     been pulled into the bundle.
 *   - `angular#auto-csp` — the loader script `security.autoCsp` generates, which this
 *     application does not use (see the header).
 */
export const TRUSTED_TYPES_POLICIES = ['angular', 'angular#components'] as const;

/**
 * What the policy needs to know about one response and one build.
 *
 * `nonce` is per response; the other four are per build. Keeping them in one object is
 * what makes the whole policy a pure function — `csp.spec.ts` can therefore assert every
 * branch below without a server, a browser or a build.
 */
export interface ContentSecurityPolicyOptions {
  /** This response's nonce, from `createCspNonce()`. Not the placeholder. */
  readonly nonce: string;
  /** `environment.apiUrl`. Same-origin or relative contributes nothing. */
  readonly apiUrl: string;
  /** `environment.imageCdnUrl`. Empty means images come from this origin. */
  readonly imageCdnUrl: string;
  /** `environment.vitalsUrl`. Empty means the beacon is not shipped at all. */
  readonly vitalsUrl: string;
}

/**
 * The origin of an absolute URL, or `null` for anything same-origin.
 *
 * A relative `apiUrl` — `/api/v1`, which is the production default — is not a URL and
 * `new URL()` throws on it. That is the right answer rather than an error case: a
 * same-origin endpoint is already covered by `'self'`, so it contributes no source.
 * `''` (an unconfigured CDN or collector) lands in the same place.
 */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** `[a, null, b]` → `'a b'`, so an unconfigured origin adds nothing. */
function sources(...values: readonly (string | null)[]): string {
  return values.filter((value): value is string => value !== null && value !== '').join(' ');
}

/**
 * Build one response's policy.
 *
 * Every directive is listed, including the ones that would be inherited from
 * `default-src`, because a policy is read by people during an incident and an inherited
 * directive is one the reader has to reconstruct. The comments say what each one is
 * standing in the way of.
 */
export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const { nonce, apiUrl, imageCdnUrl, vitalsUrl } = options;

  const nonceSource = `'nonce-${nonce}'`;

  const directives: readonly (readonly [string, string])[] = [
    // The floor every directive without its own entry falls back to. Nothing is fetched
    // from anywhere but this origin unless something below says otherwise.
    ['default-src', sources("'self'")],

    // `'self'` and a nonce, and the two cover different things: `'self'` authorises the
    // builder's own `<script src>` entry points and every lazily imported chunk, and the
    // nonce authorises the two inline scripts a server-rendered Angular document carries
    // (see `nonce.ts`).
    //
    // `'strict-dynamic'` is deliberately absent, and the reason is narrower than the
    // usual one. The builder's `addNonce` pass copies `ngCspNonce` onto *every* inline
    // `<style>` and `<script>` and onto the `<script src>` entry points, so those tags
    // are nonced and `'strict-dynamic'` would trust them. What it would not reach is the
    // lazy route chunks: those are fetched as ES modules by `import()` rather than
    // created as script elements, and `'strict-dynamic'` makes a browser ignore the host
    // sources — `'self'` — that authorise them today. Adopting it would mean proving that
    // claim per browser and accepting that every lazy route is one engine quirk away from
    // 404-ing silently; `'self'` over same-origin, content-hashed filenames is the weaker
    // guarantee and the one whose failure mode is understood.
    //
    // No `'unsafe-inline'`: it is what the nonce exists to replace, and a browser that
    // sees a nonce ignores it anyway. No `'unsafe-eval'` either, in any configuration —
    // see the header for the measurement that removed it.
    ['script-src', sources("'self'", nonceSource)],

    // Same shape, for the three places styles come from: the external Tailwind stylesheet
    // (`'self'`), the critical-CSS block beasties inlines at build time (nonced, because
    // `index.html` carries `ngCspNonce`), and the `<style>` elements Angular injects in
    // the browser as lazy components arrive (nonced, because Angular's runtime reads that
    // same attribute).
    ['style-src', sources("'self'", nonceSource)],

    // The one concession, and it is a narrow one. A `style="…"` attribute cannot carry a
    // nonce — an attribute has nowhere to put one — so a nonce in `style-src` blocks
    // every inline style attribute in the document. Angular renders `[style.x]` bindings
    // into exactly that when it renders on the server.
    //
    // It is set explicitly rather than left to fall back to `style-src`, because the
    // fallback is what blocks them: naming the directive is how the concession is made
    // visible to whoever reads the policy, instead of being an unexplained absence.
    //
    // What it gives up is bounded: a style attribute cannot execute script, so the
    // residual risk is CSS-level — exfiltration through attribute selectors, or
    // restyling the page to mislead. What it buys is that `script-src` stays strict,
    // which is where the actual code execution lives.
    ['style-src-attr', sources("'unsafe-inline'")],

    // A configured image CDN, if there is one. An unconfigured CDN adds nothing, which is
    // also the checked-in default — images then come from `public/` on this origin.
    //
    // No `data:`. It is the usual reflex here and nothing in this application needs it:
    // `NgOptimizedImage` emits a data URI only for a `placeholder`, and no template sets
    // one. `data:` in `img-src` is also not free — it is a channel for rendering
    // attacker-supplied bytes as a first-party image — so it waits for a caller.
    ['img-src', sources("'self'", originOf(imageCdnUrl))],

    // Fonts are the system stack (see `styles.css`), so nothing is fetched. Pinned to
    // `'self'` rather than left to `default-src` so that adding a Google Fonts link has
    // to be a deliberate edit to the policy.
    ['font-src', sources("'self'")],

    // XHR, fetch, EventSource and `navigator.sendBeacon`. The API and the web-vitals
    // collector are both configurable and both default to same-origin or off, so in the
    // checked-in production build this is just `'self'` — and in development it is
    // `'self' http://localhost:3000`, which is the whole of the difference between the
    // two policies.
    //
    // No `ws:`. The dev server's HMR socket is same-origin, and `'self'` matches a
    // websocket to the document's own host and port: `ng serve` hot-reloads under this
    // policy unchanged (see the header).
    ['connect-src', sources("'self'", originOf(apiUrl), originOf(vitalsUrl))],

    // No `<object>`, `<embed>` or `<applet>`. These are a script-execution sink that
    // predates CSP and that nothing in this application uses, so there is no cost.
    ['object-src', sources("'none'")],

    // `<base href>` rewrites what every relative URL on the page resolves against,
    // including each chunk — so an injected `<base>` relocates the whole application's
    // JavaScript to an attacker's host without touching a single `src`. This application
    // *does* ship a `<base href>` per locale, and it is same-origin.
    ['base-uri', sources("'self'")],

    // Nothing embeds this application in a frame. The modern replacement for
    // `X-Frame-Options`, and strictly more expressive.
    ['frame-ancestors', sources("'none'")],

    // Nothing is framed *by* it either; `/login` and `/register` are first-party forms.
    ['frame-src', sources("'none'")],

    // Where a form may post. Without it, an injected `<form action="https://…">` around
    // existing inputs turns the sign-in page into a credential collector for someone else.
    ['form-action', sources("'self'")],

    // Turn the dangerous DOM sinks — `innerHTML`, `script.src`, `eval` — into type errors
    // unless the value came from a registered Trusted Types policy. This is the runtime
    // half of the sanitisation policy: see `sanitisation.ts` for what it enforces and for
    // why `angular#unsafe-bypass` is not in the list below.
    ['require-trusted-types-for', sources("'script'")],

    // The policies that may be created, by name. Angular and the CDK each register one
    // for their own sanitised output; everything else — including
    // `angular#unsafe-bypass`, which is what `DomSanitizer.bypassSecurityTrust*` uses —
    // is refused by the browser. `sanitisation.ts` has the whole argument.
    ['trusted-types', sources(...TRUSTED_TYPES_POLICIES)],
  ];

  return directives.map(([directive, value]) => `${directive} ${value}`).join('; ');
}
