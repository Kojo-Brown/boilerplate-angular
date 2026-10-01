/**
 * The nonce a Content-Security-Policy authorises this application's inline markup by,
 * and the two-phase trick that gets it into a document nobody renders per request.
 *
 * ## A nonce is only worth anything if it is unpredictable, per response
 *
 * `script-src 'nonce-abc'` says "run the inline scripts that carry `nonce="abc"`". The
 * protection comes entirely from the attacker not knowing `abc`: if they do, the markup
 * they inject carries it too and the policy authorises their script alongside ours. So a
 * nonce has to be minted fresh for each response and never reused.
 *
 * Which is awkward here, because **this application does not render a document per
 * request.** `/login`, `/register` and `/unauthorized` are `RenderMode.Prerender` — files
 * produced once at build time — and every other route is `RenderMode.Client`, served the
 * prebuilt `index.csr.html` shell. There is no per-request render to hang a per-request
 * value off (see `app.routes.server.ts` for why, and `docs/security.md` for the
 * cacheability this costs).
 *
 * A literal nonce in `src/index.html` is therefore not a weaker version of this — it is
 * the whole mechanism switched off while still reading as a nonce deployment. One value,
 * baked into static files, visible in `view-source` to everyone who ever loads the page,
 * valid until the next deploy. That is `'unsafe-inline'` wearing a nonce's clothes, and
 * it is strictly worse than `'unsafe-inline'`, because nobody auditing the header would
 * notice.
 *
 * ## So the build emits a placeholder and the response substitutes it
 *
 * `CSP_NONCE_PLACEHOLDER` goes into `src/index.html` as `ngCspNonce`, and is what the
 * build-time and render-time machinery sees. `src/server.ts` then replaces it with a
 * freshly minted nonce on the way out, and sets the policy header to match. The attacker
 * gets 128 bits they have to guess per response; the build gets a stable token it can
 * work with.
 *
 * The placeholder has to be present *at build time* rather than injected into finished
 * HTML, because three of the four things that have to happen to a nonce here are decided
 * before the response exists, and all three are Angular's doing rather than ours:
 *
 *   1. The critical-CSS inliner (beasties, via `@angular/ssr`) looks for an `ngCspNonce`
 *      attribute in the document. Finding one, it nonces the `<style>` block it inlines
 *      **and** rewrites the deferred stylesheet's `onload="this.media='all'"` into a
 *      `media` attribute plus a nonced loader script. Finding none — which is what an
 *      `index.html` without the placeholder gets — it leaves the `onload` in place, and
 *      an inline event handler is the one thing a nonce can never authorise, because an
 *      attribute has nowhere to carry one. Measured on this repository: before the
 *      placeholder was added, every built page carried `onload="this.media='all'"`; after,
 *      none of them do.
 *   2. `@angular/build`'s `addNonce` pass copies the attribute's value onto every inline
 *      `<style>` and `<script>` in the document that has no `nonce` of its own — the
 *      jsaction event-dispatch contract script included, and the `<script src>` entry
 *      points too. This is the pass that does most of the work, and it runs for `ng serve`
 *      as well as for a production build.
 *   3. `@angular/platform-server` nonces the `window.__jsaction_bootstrap(…)` script it
 *      injects for event replay from `CSP_NONCE` in the render-time injector — which for
 *      a prerendered route means build time. `app.config.server.ts` provides the
 *      placeholder there for exactly this.
 *
 * The fourth is the `ngCspNonce` attribute itself, which is where Angular's *browser*
 * runtime reads the nonce from for the `<style>` elements it injects as lazy components
 * arrive. All four therefore hold the placeholder in the artifact, and all four are
 * fixed by one string replacement on the way out.
 *
 * ## What is deliberately not done here
 *
 * `applyCspNonce` does not go looking for inline scripts to nonce. It replaces a token it
 * put there itself, and nothing else. The alternative — "add a `nonce` to every inline
 * script that lacks one" — sounds like robustness and is the opposite: the point of a
 * nonce is to enumerate what may execute, and a rule that credentials whatever it finds
 * has stopped enumerating. If a future Angular emits an inline script that `addNonce`
 * does not reach, the right outcome is a failed build and a person reading the diff, and
 * `assert-csp.mjs` asserts exactly that: no served document contains an un-nonced inline
 * script.
 *
 * `<script id="ng-state" type="application/json">` is the one inline script that is
 * legitimately un-nonced and stays that way. It is the hydration transfer-state data
 * block; a non-JavaScript `type` means the browser never executes it, so `script-src`
 * does not apply and there is nothing to authorise. Confirmed rather than assumed: it is
 * un-nonced in every built page and no browser reports a violation for it.
 */

/**
 * The stand-in for the real nonce in every built artifact.
 *
 * Deliberately not base64 and deliberately self-describing: anyone who finds this string
 * in a served response has found a bug, and the string says what the bug is. A
 * plausible-looking token here would make the failure this exists to prevent — a static
 * nonce reaching production — look like success. `assert-csp.mjs` fails if it survives
 * into a response.
 *
 * The value is also the reason substitution is a plain string replacement rather than an
 * HTML rewrite: it cannot occur in any other context, so there is nothing to parse.
 */
export const CSP_NONCE_PLACEHOLDER = 'NGCSP_NONCE_SUBSTITUTED_PER_RESPONSE';

/**
 * 128 bits of randomness, base64-encoded — the length OWASP asks for and the encoding the
 * CSP grammar's `base64-value` expects.
 *
 * `crypto.getRandomValues` rather than `Math.random`: a nonce that an attacker can predict
 * from previous nonces is not a nonce, and `Math.random` is seeded, non-cryptographic and
 * observable. This is also why the function takes no "length" parameter — a caller
 * choosing 4 bytes would silently get a guessable policy.
 *
 * Web Crypto and `btoa` rather than `node:crypto` and `Buffer`, so this module stays free
 * of a platform dependency and its spec can run in the browser with the rest of the suite.
 */
export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Put `nonce` into one response's HTML, everywhere the policy will expect it.
 *
 * One operation, for the reason the header gives: every place the nonce has to land was
 * given the placeholder by the build, so substituting the placeholder is the whole job.
 * A function rather than an inline `replaceAll` at the call site, because the pairing of
 * *this* token with *this* nonce is the invariant the policy depends on, and it should
 * have one name and one spec.
 */
export function applyCspNonce(html: string, nonce: string): string {
  return html.replaceAll(CSP_NONCE_PLACEHOLDER, nonce);
}
