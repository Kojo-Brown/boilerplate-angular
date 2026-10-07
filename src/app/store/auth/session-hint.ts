import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { deleteCookie, readCookie } from '@/app/core/platform/document-cookies';

/**
 * The readable, non-secret cookie that says a refresh cookie was issued.
 *
 * Set by the API next to the refresh token and expiring with it. It carries no
 * credential — the value is a constant — and nothing is authorised by its presence.
 * See `docs/token-storage.md` for the full response contract.
 */
export const SESSION_HINT_COOKIE = 'session_hint';

/**
 * Whether a cold page load is worth spending a refresh request on.
 *
 * ## Why there is anything here at all
 *
 * This file replaces `token-storage.ts`, which kept both tokens in `localStorage`. It is
 * not the same shape, and the comment that file carried — "an in-memory access token plus
 * an httpOnly refresh cookie is a different implementation of these three methods and
 * nothing else" — turned out to be wrong in the one way that mattered. `read()` cannot be
 * implemented: the point of `HttpOnly` is that JavaScript cannot see the cookie, so there
 * is nothing for a client-side read to return. The access token is held in `AuthStore`'s
 * own state, which is memory and is gone on reload; the refresh token belongs to the
 * browser's cookie jar and to the API, and this application never holds it.
 *
 * What is left over is one question the client still has to answer on a cold load: *is
 * this visitor likely to be signed in?* The access token is gone, and the refresh cookie
 * is invisible. Two ways to answer it:
 *
 *  1. **Always try.** Issue `POST /auth/refresh` on every page load and see what comes
 *     back. Correct, and it needs no client-side state whatsoever — but it spends a
 *     credentialed round trip on *every anonymous visitor*, so the auth endpoint's load
 *     scales with total traffic rather than with signed-in traffic, and `authGuard` has
 *     to wait for a 401 before it can redirect someone who was never signed in.
 *  2. **Ask a marker the server left behind.** One request for signed-in visitors, none
 *     for anonymous ones.
 *
 * This is (2), and the marker is a cookie rather than a `localStorage` flag on purpose:
 * the API sets it in the same response, with the same `Max-Age` as the refresh token, so
 * the client's belief expires exactly when the server's truth does. A flag in web storage
 * has no expiry and survives both the refresh cookie lapsing and the session being
 * revoked server-side, which turns every later page load into a guaranteed failed
 * refresh — the cost of (1) plus a stale flag to explain.
 *
 * ## It is a hint, and the code has to keep treating it as one
 *
 * A cookie the client can read is a cookie the client, an extension, or a stale tab can
 * be wrong about. The hint may say "active" when the session has been revoked, the
 * refresh token rotated away, or the user signed out in another tab. So:
 *
 *   - nothing derives `isAuthenticated` from it — that still needs an access token *and*
 *     a user, both of which only a successful refresh and profile fetch produce; and
 *   - a refresh that fails clears the session and calls {@link SessionHint.forget}, so
 *     the next load does not retry against the same dead cookie.
 *
 * The inverse error — the hint missing while a usable refresh cookie is still live — costs
 * a visitor one sign-in. That is the right way round to be wrong.
 */
export interface SessionHint {
  /** A refresh cookie was probably issued to this browser and has not expired. */
  exists(): boolean;
  /**
   * Drop the marker, so a cold load stops attempting a refresh.
   *
   * Client-side only, and deliberately only half of signing out: the refresh cookie
   * itself is `HttpOnly`, so expiring it is a `Set-Cookie` on a response and only the
   * server can do it. `AuthStore.logout` asks it to.
   */
  forget(): void;
}

/**
 * The cookie-backed implementation. Answers `false` and does nothing where there is no
 * document whose cookies belong to one visitor — server-side rendering included.
 */
export function browserSessionHint(doc: Document | null): SessionHint {
  return {
    exists(): boolean {
      return readCookie(doc, SESSION_HINT_COOKIE) !== null;
    },
    forget(): void {
      deleteCookie(doc, SESSION_HINT_COOKIE);
    },
  };
}

/** A hint that is never present. What the server renders against, and what a spec opts into. */
export function absentSessionHint(): SessionHint {
  return {
    exists: () => false,
    forget: () => undefined,
  };
}

/**
 * The seam `AuthStore` depends on. Override it in a `TestBed` without touching the store.
 */
export const SESSION_HINT = new InjectionToken<SessionHint>('SESSION_HINT', {
  providedIn: 'root',
  factory: () => browserSessionHint(inject(DOCUMENT)),
});
