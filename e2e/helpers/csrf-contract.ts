import { CSRF_CONTRACT, isCsrfSafeMethod } from '@/app/core/http/csrf';

/**
 * The server's half of `docs/csrf.md`, as code rather than as prose.
 *
 * ## Why this exists
 *
 * "A verified server contract" is the part of this item that a front-end repository
 * cannot straightforwardly deliver: there is no API here to audit. What it can do is stop
 * the contract being a document that only describes an intention. The rules in
 * `docs/csrf.md` are mechanical — read two values, reject if they are absent or differ —
 * so they can be implemented once, here, and then *used to adjudicate real requests*:
 * `e2e/csrf/csrf.spec.ts` puts this behind every API route and drives a real Chromium
 * through sign-in, session restore and sign-out against it.
 *
 * That makes the verification a two-sided one. A mock that merely recorded a header would
 * pass whatever the application sent, including nothing; this rejects, with the same rule
 * and the same status a correctly configured API would, and the suite fails if the
 * application's requests stop satisfying it. It also lets the attack be tested rather than
 * described — `csrf.spec.ts` issues the request an attacker can actually cause (the cookie
 * attached by the browser, no header, because no cross-site page can set one) and asserts
 * this refuses it.
 *
 * It imports {@link CSRF_CONTRACT} and {@link isCsrfSafeMethod} from the application
 * rather than restating the two names and the four methods, so there is no second
 * definition for the server half to drift away from.
 *
 * ## What it is not
 *
 * A production implementation. It has no session store, so it cannot reject a token it
 * never issued — the sub-domain cookie-injection case `docs/csrf.md` lists as an open gap,
 * which a real API closes by signing the token. And {@link constantTimeEquals} below
 * mirrors the *shape* the rule requires without being able to promise the timing; in a
 * garbage-collected JIT-compiled runtime that guarantee is not available, and in an API it
 * comes from the platform's own comparison primitive. Both are noted where they are,
 * rather than left for a reader to assume otherwise.
 */
export type CsrfVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** The status `docs/csrf.md` requires for a rejection, and the body it carries. */
export const CSRF_REJECTION_STATUS = 403;

/**
 * Decides one request the way the API must.
 *
 * @param method the request method, in whatever case it was written
 * @param headers the request's headers, lower-cased keys, as Playwright's
 *        `request.allHeaders()` returns them — `cookie` included, which `headers()` alone
 *        does not reliably provide
 */
export function verifyCsrf(method: string, headers: Readonly<Record<string, string>>): CsrfVerdict {
  // The same four methods the client exempts, read from the same constant. A server that
  // exempted a different set would reject requests the client never protects, or accept
  // ones it does — and either way the mismatch would show up as a flaky endpoint rather
  // than as a CSRF bug.
  if (isCsrfSafeMethod(method)) {
    return { ok: true };
  }

  const header = headers[CSRF_CONTRACT.headerName.toLowerCase()] ?? null;
  const cookie = readCookie(headers['cookie'] ?? '', CSRF_CONTRACT.cookieName);

  if (header === null && cookie === null) {
    return {
      ok: false,
      reason:
        `${method} carried neither the ${CSRF_CONTRACT.headerName} header nor the ` +
        `${CSRF_CONTRACT.cookieName} cookie. Either the client never bootstrapped a token, ` +
        `or withCredentials is missing and the cookie was dropped`,
    };
  }

  if (header === null) {
    return {
      ok: false,
      reason:
        `${method} carried the ${CSRF_CONTRACT.cookieName} cookie but no ` +
        `${CSRF_CONTRACT.headerName} header. This is the shape of a forged cross-site ` +
        `request: the browser attaches the cookie to anyone's request, and no cross-site ` +
        `page can set the header`,
    };
  }

  if (cookie === null) {
    return {
      ok: false,
      reason:
        `${method} carried a ${CSRF_CONTRACT.headerName} header with no ` +
        `${CSRF_CONTRACT.cookieName} cookie to compare it against. A double-submit check ` +
        `needs both halves, so the request must be rejected rather than trusted`,
    };
  }

  if (!constantTimeEquals(header, cookie)) {
    return {
      ok: false,
      reason: `${method} carried a ${CSRF_CONTRACT.headerName} header that does not match the cookie`,
    };
  }

  return { ok: true };
}

/**
 * One cookie's value out of a `Cookie` request header.
 *
 * Split rather than matched with a constructed `RegExp`, for the reason
 * `core/platform/document-cookies.ts` gives about the same job on the other side: a
 * cookie name may contain characters that would need escaping in a pattern, and building
 * one out of a name is how that becomes a silent mismatch.
 */
function readCookie(cookieHeader: string, name: string): string | null {
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim();
  }
  return null;
}

/**
 * Compares two tokens without returning early on the first differing byte.
 *
 * The rule is in `docs/csrf.md` because the token is a secret and an early-returning
 * comparison leaks it a byte at a time to anyone who can time a request. This is the
 * shape of the right answer — fixed number of comparisons, length folded in rather than
 * short-circuited on — and not a promise of it: a JIT-compiled, garbage-collected runtime
 * cannot make that guarantee, and in an API it comes from the platform's own primitive
 * (`crypto.timingSafeEqual` on Node) rather than from a loop like this one.
 */
function constantTimeEquals(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }

  return difference === 0;
}
