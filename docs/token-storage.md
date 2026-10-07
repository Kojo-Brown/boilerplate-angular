# Token storage

Where this application's credentials live, why they live there, and what the API has to
send for it to work.

Two rules, and everything below is a consequence of one of them:

1. **The access token exists only in memory.** It is a field of `AuthStore`'s state — a
   signal in a root-provided service — and no code path writes it anywhere a later page
   load could read it back.
2. **The refresh token never reaches JavaScript.** The API sets it as an `HttpOnly`
   cookie. This application cannot read it, cannot write it, and never sees it in a
   response body.

## What this replaced, and what it is actually worth

The previous implementation kept both tokens in `localStorage` under
`auth_access_token` and `auth_refresh_token`. That is the shape most tutorials show and
it is the one that fails worst, because `localStorage` is readable by **any script
running on the origin** — including one that arrives through a cross-site-scripting bug,
a compromised dependency, or a tag an analytics vendor added last week.

It is worth being precise about the size of the win, because "httpOnly cookies prevent
XSS" is not true and this document should not imply it. An attacker with script
execution on the page can still:

- read the in-memory access token out of the running application, or simply
- issue requests as the user from the page itself, cookie attached, for as long as the
  page is open.

What the change buys is **exfiltration of a long-lived credential**. With both tokens in
`localStorage`, one `fetch` to an attacker's server hands over a refresh token that is
good for thirty days from anywhere — a session that survives the tab closing, the bug
being fixed, and the user's password being changed if the API does not revoke on
password change. With this design the attacker gets an access token that expires in
minutes and cannot be renewed off-origin, because renewing it requires a cookie that
only travels on requests the browser itself attaches it to. The blast radius goes from
"persistent account takeover" to "the length of one page view". That is the whole claim.

The second thing it buys is smaller and more certain: `localStorage` is shared across
tabs and persists until something clears it, so a token left there after a crash, on a
shared machine, or in a browser profile that syncs, is a token still sitting on disk. A
reload now starts with nothing.

## The API contract

### `POST /auth/login`, `POST /auth/register`

```http
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: refresh_token=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000
Set-Cookie: session_hint=1; Secure; SameSite=Strict; Path=/; Max-Age=2592000

{ "user": { … }, "accessToken": "<jwt>" }
```

The body carries **no refresh token**. `AuthResponse` in `auth.models.ts` has nowhere to
put one, which is deliberate: a shape with no field for a credential is a shape no
handler can accidentally persist one from.

`Path=/api/v1/auth` on the refresh cookie is least privilege applied to a cookie. It is
the only path that needs it, so it is the only path it is sent to — every other API
request carries the bearer token and nothing else.

### `POST /auth/refresh`

Request: empty body, `withCredentials: true`. The credential is the cookie; there is
nothing for the client to send because there is nothing the client holds.

```http
HTTP/1.1 200 OK
Set-Cookie: refresh_token=<rotated>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000
Set-Cookie: session_hint=1; Secure; SameSite=Strict; Path=/; Max-Age=2592000

{ "accessToken": "<jwt>" }
```

Rotation happens in the cookie jar. A rejected refresh (401) should clear both cookies.

### `POST /auth/logout`

Empty body, `withCredentials: true`, and it must answer with both cookies expired:

```http
Set-Cookie: refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=0
Set-Cookie: session_hint=; Secure; SameSite=Strict; Path=/; Max-Age=0
```

**This request is not optional.** An `HttpOnly` cookie can only be cleared by a
`Set-Cookie` on a response, so a sign-out that drops client-side state and stops there
leaves a live refresh token in the jar — and the next page load restores the session the
user just ended. `AuthStore.logout` clears locally first and fires the request after, so
the interface is signed out in the same frame as the click and the revocation happens on
its own; it ignores both outcomes, because a user on a flaky connection must still end
up signed out of this tab.

### `GET /auth/me`

Authorised by the `Authorization: Bearer` header, and sent **without** credentials. The
refresh cookie's path scoping means it would not travel here anyway; not asking for it
keeps that true if the path is ever widened.

## `session_hint`: why there is a readable cookie at all

On a cold page load the access token is gone and the refresh cookie is invisible, so the
application has one question to answer before the router's first navigation: *is this
visitor likely to be signed in?*

Two ways to answer it. **Always try**: issue `POST /auth/refresh` on every page load.
Correct, and it needs no client-side state at all — but it spends a credentialed round
trip on every anonymous visitor, so the auth endpoint's load scales with total traffic
rather than signed-in traffic, and `authGuard` has to wait for a 401 before it can
redirect someone who was never signed in. **Or ask a marker the server left behind**:
one request for signed-in visitors, none for anyone else.

This application does the second. The marker is a cookie rather than a `localStorage`
flag because the API sets it in the same response with the same `Max-Age`, so the
client's belief expires exactly when the server's truth does. A flag in web storage has
no expiry and survives both the refresh cookie lapsing and the session being revoked
server-side, which turns every later page load into a guaranteed failed refresh — the
cost of "always try" plus a stale flag to explain.

It carries no credential. The value is the constant `1`, nothing is authorised by its
presence, and `browserSessionHint` only ever asks whether the cookie *exists*.

**It is a hint, and the code keeps treating it as one.** A cookie the client can read is
a cookie the client can be wrong about — revoked, rotated away, or signed out in another
tab. So nothing derives `isAuthenticated` from it (that still needs an access token
*and* a user, which only a successful refresh plus profile fetch produce), and a failed
refresh calls `clearSession`, which drops the hint so the next load does not retry
against the same dead cookie. The inverse error — the hint missing while a usable
refresh cookie is live — costs a visitor one sign-in, which is the right way round to be
wrong.

## Deployment: the API has to be same-site

Three separate requirements land on the same constraint, so it is worth stating once:

- `SameSite=Strict` on the refresh cookie means it is only sent on same-site requests.
- `document.cookie` can only read a cookie whose domain covers the app's own.
- `withCredentials` plus a wildcard `Access-Control-Allow-Origin` is refused by every
  browser, so a cross-origin API must echo the exact origin and send
  `Access-Control-Allow-Credentials: true`.

The deployment this is designed for puts the API on the same site as the application —
either behind one origin (`/api` on the app's origin, the simplest case: nothing above
applies) or on a sibling host with the hint cookie scoped to the shared parent
(`Domain=.example.com`). In development, `ng serve` on `:4200` and an API on `:3000` are
the same site *and* the same cookie domain, because cookies ignore the port entirely —
so the checked-in configuration works with no CORS or cookie-domain work at all.

A genuinely cross-site API (`app.example.com` → `api.example.net`) cannot use
`SameSite=Strict`. It would need `SameSite=None; Secure`, which re-admits
cross-site requests to `/auth/refresh` and makes CSRF protection mandatory rather than
belt-and-braces — the next item in `SPEC.md`.

## What is still open

`SameSite=Strict` is the only CSRF defence here, and it is a good one: a cross-site POST
to `/auth/refresh` does not carry the cookie, so it cannot mint an access token. It is
not the whole of CSRF protection for a cookie-authenticated endpoint, and the token-based
half — `HttpClientXsrfModule` and a verified server contract — is the next `SPEC.md`
item rather than part of this one.

Two consequences of the design worth knowing about, neither a defect:

- **Each tab holds its own access token.** They are in memory, so they are not shared;
  two tabs are two refreshes against one refresh cookie. Signing out in one tab does not
  sign out the other until its next request 401s and its refresh is rejected. A
  `BroadcastChannel` would close that gap and is not built here.
- **A reload costs one extra request** for a signed-in visitor: `/auth/refresh` before
  `/auth/me`. That is the price of holding nothing on the client, and it is paid only by
  visitors who have a session to restore.

## Where this is enforced

| Claim | Enforced by |
| --- | --- |
| No token in web storage or a client-written cookie, anywhere in `src/` | `scripts/ci/assert-no-token-persistence.mjs` (`pnpm check:tokens`) |
| The store holds no refresh token and persists nothing | `src/app/store/auth/auth.store.spec.ts` |
| Each call sends credentials if and only if it moves the cookie | `src/app/store/auth/auth.service.spec.ts` |
| The restore path, the 401 refresh queue, and the no-hint short circuit | `jwt.interceptor.spec.ts`, `app.config.spec.ts` |
| `HttpOnly` is real, and a reload rebuilds the session | `e2e/token-storage.spec.ts` |

The CI gate is the one that matters for the future. Both rules at the top of this
document are properties of *every* line of source, and a spec can only assert them about
the lines it calls: a "remember me" checkbox that persists the access token would leave
every existing test green while removing the defence this whole document describes.
