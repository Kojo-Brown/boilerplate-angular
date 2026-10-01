import { Injectable, SecurityContext, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

/**
 * This application's position on untrusted markup, and the one sanctioned way to render
 * it.
 *
 * ## The policy
 *
 * 1. **Interpolation is the default and needs no help.** `{{ value }}` escapes, always,
 *    in every context Angular knows about. Every string this application renders today
 *    goes through it, which is why there is no caller for the service below yet.
 * 2. **`[innerHTML]` is allowed, because Angular sanitises it.** Binding a string to
 *    `[innerHTML]` runs it through the same sanitiser `HtmlSanitiser` calls — tags and
 *    attributes outside a known-safe allow-list are dropped. This is a *safe* construct
 *    and banning it would be banning the framework's own defence; what makes it dangerous
 *    is rule 3.
 * 3. **`DomSanitizer.bypassSecurityTrust*` is banned.** Those five methods are the only
 *    way to put a string into a dangerous sink with the sanitiser switched off, so they
 *    are the only place an XSS can originate in an Angular template. The ban is enforced
 *    twice over, deliberately, because each mechanism catches what the other cannot:
 *
 *      - `eslint.config.mjs` fails the build on the call. That is the one that catches it
 *        before it merges, and it is the one a developer can read the reason off.
 *      - The `trusted-types` directive in `csp.ts` omits `angular#unsafe-bypass`, which
 *        is the policy name `@angular/core` registers for exactly these five methods. The
 *        browser refuses to create it, `getPolicy()` catches the failure and returns
 *        `null`, the bypass helper falls back to handing the DOM a plain string, and
 *        `require-trusted-types-for 'script'` makes that assignment throw. That is the one
 *        that still works when the code did not come through this repository's lint — a
 *        dependency, a copy-pasted snippet in a `<script>` someone added, a future
 *        contributor with `--no-verify`.
 *
 * ## `sanitize()` is not a sanitisation guarantee — its parameter type is
 *
 * The subtlety that makes rule 3 worth two mechanisms: `DomSanitizer.sanitize()` checks
 * whether its argument is already a `SafeValue` and, if it is, returns the string inside
 * it **unsanitised**. It is a no-op on exactly the input you would most want it to clean.
 *
 * So `sanitize(SecurityContext.HTML, somethingFromAnApi)` is only a guarantee while
 * `somethingFromAnApi` cannot be a `SafeValue`, and that is a question about its *type*,
 * not about the call. `HtmlSanitiser.sanitise` therefore takes `string`, not the
 * `SafeValue | string` the underlying signature accepts — a bypassed value is an object
 * and will not type-check, so the only way to defeat the helper is to defeat rule 3
 * first, where both mechanisms above are waiting. `sanitisation.spec.ts` pins the
 * underlying behaviour, so an Angular release that changed it would fail here rather
 * than quietly turn this helper into a pass-through.
 */
@Injectable({ providedIn: 'root' })
export class HtmlSanitiser {
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * Strip everything from `html` that Angular does not consider safe to render, and
   * return what is left.
   *
   * The sanctioned answer to "then how do I render markup a server sent me?", and the
   * reason the ban in rule 3 above is a ban rather than a request: a rule with no
   * alternative gets worked around, and the workaround is `bypassSecurityTrustHtml`.
   *
   * What survives is an allow-list — formatting elements, links, lists, tables — and what
   * does not is everything that can execute: `<script>`, every `on*` handler, `<iframe>`,
   * `<object>`, `<embed>`, `<form>` and the SVG script vector. One exception, because it
   * is the one everybody states wrongly: a `javascript:` URL is **not removed**, it is
   * rewritten to `unsafe:javascript:`, which no browser has a handler for. The link
   * stays, visible and inert.
   *
   * `sanitisation.spec.ts` asserts each of those against the real sanitiser rather than
   * trusting this paragraph, because the allow-list is Angular's and can move under us —
   * and because the first draft of that spec asserted the `javascript:` case from memory
   * and was wrong.
   *
   * `string` in and `string` out, never `SafeHtml`: the return value is meant to be bound
   * to `[innerHTML]`, where Angular will sanitise it a second time. That second pass is
   * not redundant belt-and-braces — it is what keeps this method's output an ordinary
   * string with no privileges, so handing it somewhere else cannot grant any.
   *
   * `null` and `undefined` come back as `''` rather than propagating, because every
   * caller of this is a template binding and `[innerHTML]="null"` renders the string
   * "null" in some Angular versions and nothing in others.
   */
  sanitise(html: string | null | undefined): string {
    if (html === null || html === undefined) return '';
    return this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
  }
}

/**
 * The `DomSanitizer` methods this application does not use, as data.
 *
 * The list the ESLint rule in `eslint.config.mjs` is built from, and the list
 * `sanitisation.spec.ts` checks against `DomSanitizer`'s own surface — so a sixth
 * bypass method arriving in a future Angular fails a spec here instead of being missed by
 * a rule that names five.
 */
export const BYPASS_METHODS = [
  'bypassSecurityTrustHtml',
  'bypassSecurityTrustStyle',
  'bypassSecurityTrustScript',
  'bypassSecurityTrustUrl',
  'bypassSecurityTrustResourceUrl',
] as const;
