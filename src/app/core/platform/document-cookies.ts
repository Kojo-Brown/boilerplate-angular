/**
 * Reaching the cookies a browser is willing to show JavaScript, in one place.
 *
 * The sibling of {@link storageOf}, and it exists for the same reason: `document.cookie`
 * is a browser API that a universally-rendered application reaches from code which also
 * runs on a server, so every caller needs the same guard and the guard is easy to write
 * subtly wrong. `doc?.cookie` protects against a missing *document* and not against a
 * document whose `cookie` accessor throws, which is the failure that actually happens.
 *
 * It throws in two situations worth naming, neither hypothetical:
 *
 *   - a `<iframe sandbox>` without `allow-same-origin`, where the document has an opaque
 *     origin and *reading* `cookie` is a `SecurityError`; and
 *   - `about:blank` and `data:` documents, same reason.
 *
 * Under server-side rendering the accessor does not throw so much as answer nothing
 * useful: `DOCUMENT` is a server-side DOM shared by every visitor, so there is no one
 * visitor whose cookies it could hold. An empty string is the honest answer there, and it
 * is what these functions return.
 *
 * Nothing here can see an `HttpOnly` cookie, and that is the point rather than a
 * limitation — see {@link SessionHint} and `docs/token-storage.md`.
 */

/**
 * The value of one cookie, or `null` where there is not one.
 *
 * Decoded with `decodeURIComponent`, because `document.cookie` serialises values
 * percent-encoded and a caller comparing against a plain string would miss any value
 * containing a `;`, a space or a comma. A value that is not valid percent-encoding is
 * returned as it was found rather than throwing — a malformed cookie is someone else's
 * bug, and the only sensible thing to do with it is report what is there.
 */
export function readCookie(doc: Document | null, name: string): string | null {
  const jar = cookieJarOf(doc);
  if (jar === '') return null;

  // Split rather than regex: a cookie name is allowed to contain characters that would
  // need escaping in a pattern, and building a `RegExp` out of a caller's string is how
  // that turns into a silent mismatch.
  for (const pair of jar.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    return decodeValue(pair.slice(separator + 1).trim());
  }

  return null;
}

/**
 * Expire one cookie, as far as this document is able to.
 *
 * "As far as it is able" is the whole caveat: a cookie is identified by name, domain and
 * path, `document.cookie` cannot read those attributes back, and an expiry whose path
 * does not match the original's leaves the original in place while appearing to succeed.
 * So this writes `Path=/`, and the contract in `docs/token-storage.md` requires the one
 * cookie this is used on to have been set with `Path=/` too.
 *
 * It cannot touch an `HttpOnly` cookie at all. Clearing one of those is a response
 * header, which means a request to the server — `AuthStore.logout` makes it.
 */
export function deleteCookie(doc: Document | null, name: string): void {
  if (doc === null) return;
  try {
    doc.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Strict`;
  } catch {
    // Same unwritable documents as `cookieJarOf`. A cookie that could not be read
    // cannot have been acted on either, so there is nothing to recover from.
  }
}

/** Every cookie this document will admit to, as the raw header-style string. */
function cookieJarOf(doc: Document | null): string {
  try {
    return doc?.cookie ?? '';
  } catch {
    return '';
  }
}

function decodeValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
