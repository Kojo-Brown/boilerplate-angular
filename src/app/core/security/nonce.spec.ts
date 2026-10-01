import { applyCspNonce, createCspNonce, CSP_NONCE_PLACEHOLDER } from './nonce';

describe('createCspNonce', () => {
  // 128 bits, which is what OWASP asks of a nonce and what makes guessing it not a
  // strategy. Asserted on the decoded length rather than the encoded one so that a
  // change of encoding cannot quietly shrink the entropy.
  it('carries 128 bits of entropy', () => {
    expect(atob(createCspNonce()).length).toBe(16);
  });

  // The property the whole mechanism rests on. A nonce reused across two responses is
  // not a nonce — see the header of nonce.ts — and the failure is undetectable at
  // runtime, so it is asserted here.
  it('returns a different value every time', () => {
    const minted = new Set(Array.from({ length: 500 }, () => createCspNonce()));

    expect(minted.size).toBe(500);
  });

  // `base64-value` in the CSP grammar, which is also what fits in an HTML attribute
  // without escaping. A character outside this set would make the browser discard the
  // whole source expression, leaving `script-src 'self'` and no inline script at all.
  it('is a CSP base64-value', () => {
    for (const nonce of Array.from({ length: 50 }, () => createCspNonce())) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
  });

  it('is never the placeholder', () => {
    expect(createCspNonce()).not.toBe(CSP_NONCE_PLACEHOLDER);
  });
});

describe('CSP_NONCE_PLACEHOLDER', () => {
  /**
   * The placeholder has to be unmistakable in a response body, because that is the only
   * place the bug it guards against is visible. A plausible-looking token would make a
   * static nonce reaching production look exactly like a working deployment.
   */
  it('is not mistakable for a real nonce', () => {
    expect(CSP_NONCE_PLACEHOLDER).not.toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(CSP_NONCE_PLACEHOLDER).toContain('PER_RESPONSE');
  });
});

describe('applyCspNonce', () => {
  const nonce = 'aBcD1234aBcD1234aBcD12==';

  // The four places the build leaves the placeholder: the root element's attribute, the
  // inlined critical-CSS block, the loader script beasties substitutes for the
  // stylesheet's `onload`, and the event-replay bootstrap. One replacement covers all of
  // them, which is the point of using one token.
  it('substitutes every occurrence, wherever the build left one', () => {
    const html =
      `<style nonce="${CSP_NONCE_PLACEHOLDER}">a{}</style>` +
      `<script nonce="${CSP_NONCE_PLACEHOLDER}">load()</script>` +
      `<app-root ngCspNonce="${CSP_NONCE_PLACEHOLDER}"></app-root>` +
      `<script nonce="${CSP_NONCE_PLACEHOLDER}">window.__jsaction_bootstrap()</script>`;

    const result = applyCspNonce(html, nonce);

    expect(result).not.toContain(CSP_NONCE_PLACEHOLDER);
    expect(result.match(new RegExp(nonce.replace(/[+/=]/g, '\\$&'), 'g'))?.length).toBe(4);
  });

  it('leaves everything else byte-identical', () => {
    const html = `<p>text</p><app-root ngCspNonce="${CSP_NONCE_PLACEHOLDER}"></app-root><p>more</p>`;

    expect(applyCspNonce(html, nonce)).toBe(
      `<p>text</p><app-root ngCspNonce="${nonce}"></app-root><p>more</p>`
    );
  });

  /**
   * The transfer-state block is the one inline script that is legitimately un-nonced:
   * `type="application/json"` is not executable, so `script-src` never applies to it.
   *
   * It matters that this function does not try to be clever about it. Nonce-ing a data
   * block would be harmless; *finding scripts to nonce* would not be, because a rule
   * that credentials whatever inline script it encounters has stopped enumerating what
   * may execute. `assert-csp.mjs` is what notices a new un-nonced *executable* script.
   */
  it('does not go looking for inline scripts to nonce', () => {
    const html = '<script id="ng-state" type="application/json">{"k":1}</script>';

    expect(applyCspNonce(html, nonce)).toBe(html);
  });

  it('is a no-op on a document that carries no placeholder', () => {
    const html = '<html lang="en"><body><app-root></app-root></body></html>';

    expect(applyCspNonce(html, nonce)).toBe(html);
  });
});
