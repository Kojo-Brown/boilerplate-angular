# CSRF protection

What this application sends, what the API must do with it, and why the Angular feature
whose name is on this item is not by itself enough to make any of it happen.

The client half is `src/app/core/http/csrf.ts` (the contract), `csrf-bootstrap.ts` (getting
a first token) and `interceptors/csrf.interceptor.ts` (sending it).
`scripts/ci/assert-csrf.mjs` holds the repository to the values below — including the HTTP
examples in this file, which it parses rather than trusting to have been kept current.

## What is actually being defended

Cross-site request forgery is an attack on requests the **browser** authorises on the
user's behalf. A cookie is attached to any request to the host it belongs to, whoever
caused that request — so a form on `evil.example` posting to the API carries the victim's
cookie, and the API cannot tell it from a click in this application.

That makes the surface here precise and small. Two endpoints are authorised by a cookie:

| Endpoint | Authorised by | Forgeable |
| --- | --- | --- |
| `POST /auth/refresh` | the `HttpOnly` refresh cookie | yes |
| `POST /auth/logout` | the `HttpOnly` refresh cookie | yes |
| everything else | `Authorization: Bearer …` | no |

Everything in the third row is immune by construction, and it is worth being clear about
why rather than taking the row on trust: a cross-site form, image, link or redirect cannot
set a request header. A cross-origin `fetch` can, but then it is a non-simple request, the
browser sends a CORS preflight first, and the API's `Access-Control-Allow-Origin` does not
name `evil.example`. The attacker can cause the request to be *sent*; they cannot cause it
to be *authorised*.

So the token below is for the first two rows. It is applied to every mutating request
anyway, for one reason: a defence that covers the two endpoints somebody remembered is the
defence that is missing the day a third cookie-authorised endpoint is added. The server
rule is uniform for the same reason — a rule with a list of exceptions in it is a rule
nobody can audit.

### What `SameSite=Strict` already does, and where it stops

The refresh cookie is `SameSite=Strict` (see [`token-storage.md`](./token-storage.md)), and
until this item that was the only CSRF defence here. It is a real one: a cross-site POST to
`/auth/refresh` carries no cookie at all, so there is nothing to forge with.

But it is a property of the **deployment**, not of the application. A front end and an API
on genuinely different sites cannot use `Strict` — the cookie would not be sent by this
application either — and the moment it becomes `SameSite=None; Secure`, every cross-site
request carries it again and the token is the whole of the defence. This is written for
that deployment, and costs the one that does not need it a header.

## The finding: `withXsrfConfiguration` alone does nothing here

Angular ships XSRF support, and `app.config.ts` configures it. On its own it attaches
nothing to any request this application makes, because its interceptor declines to act
across origins — from `@angular/common/http`:

```js
const { origin: locationOrigin } = new URL(inject(PlatformLocation).href);
const { origin: requestOrigin } = new URL(req.url, locationOrigin);
if (locationOrigin !== requestOrigin) {
  return next(req);          // no header, no warning, no way to opt in
}
```

`environment.apiUrl` is `http://localhost:3000/api/v1` and the application is served from
port 4200 or 4000. Different origin, every time, for every mutation.

**This is the failure mode worth dwelling on.** Configuring a cookie name and a header
name reads — in a diff, in a review, in a security questionnaire — exactly like a deployed
CSRF defence. There would be a contract, a configuration call, a documented header, and
not one request carrying a token. Nothing warns. The application works perfectly, because
CSRF protection is only ever visible in what the *server rejects*, and a server that is
handed no token by a client it believes is protected has nothing to reject. The two cases
at the bottom of `csrf.interceptor.spec.ts` assert it both ways: inert cross-origin,
working same-origin, which is precisely why nobody would notice.

Angular is right to refuse. A CSRF token sent to an arbitrary origin is a token handed to
whoever is on the other end — a defence turned into a credential leak. So `csrfInterceptor`
does not widen the rule, it replaces the bound: it is installed inside
`interceptWhen(requestsUnder(environment.apiUrl), …)`, the same predicate that scopes
caching and retries, and is never offered a request to anywhere else.

`withXsrfConfiguration` is kept, and still earns its place. It points
`HttpXsrfTokenExtractor` — Angular's cookie reader, which `csrfInterceptor` uses rather
than reimplementing — at the cookie named below, and it keeps the built-in protection
correct for a same-origin deployment, where both interceptors run and neither overwrites a
header the other has set.

## What the client sends

On every request whose method is not `GET`, `HEAD`, `OPTIONS` or `TRACE`, and whose URL is
under `environment.apiUrl`:

```http
POST /api/v1/auth/refresh HTTP/1.1
X-XSRF-TOKEN: <the value of the XSRF-TOKEN cookie>
Cookie: XSRF-TOKEN=<same value>; session_hint=1; refresh_token=<opaque>
```

`withCredentials: true` is set by the interceptor alongside the header, and it is not
optional: the server compares the header against the **cookie**, so a cross-origin request
carrying one and not the other has one side of a two-sided check. It is also the narrowest
widening available — the refresh cookie is scoped `Path=/api/v1/auth` and is unaffected
outside it, which leaves `session_hint`, a non-secret marker, as the only other cookie that
starts travelling.

A request that already carries `X-XSRF-TOKEN` is left exactly as it is, credentials
included: a call site that set the header has taken on this contract, and a clone that
half-adopted it would be worse than either choice.

## What the API must do

### Set the token where JavaScript can read it

```http
Set-Cookie: XSRF-TOKEN=<token>; Secure; SameSite=Strict; Path=/; Max-Age=2592000
```

Four requirements, each of which silently breaks the scheme if missed:

- **Not `HttpOnly`.** This cookie is the delivery channel to JavaScript, which is the
  opposite of the refresh cookie beside it. `HttpOnly` here means the extractor reads
  `null` and every mutation goes out bare.
- **`Path=/`**, so the token is readable from every page, not only from under `/api`.
- **Readable from the application's origin.** Cookies ignore ports, so the checked-in
  `localhost:3000` / `localhost:4200` split is fine as it stands. A deployment on
  `app.example.com` and `api.example.com` needs `Domain=example.com`. A deployment on
  genuinely different registrable domains **cannot use this pattern at all** — the
  application can never read the cookie — and needs the token delivered in a response body
  instead.
- **`SameSite`** matching the refresh cookie: `Strict` for a same-site deployment, or
  `None; Secure` for a cross-site one, where this token is then the whole defence.

Send it in the same response as `session_hint`, with the same `Max-Age`, on
`POST /auth/login`, `POST /auth/register` and `POST /auth/refresh`. That is what makes a
returning visitor's session restore cost **one** round trip: the restore is itself a `POST`,
so a browser with a hint and no token has to bootstrap first and then refresh, sequentially,
before the session comes back. `app.config.spec.ts` asserts both paths, so this paragraph
has a failing test behind it rather than only a recommendation.

Rotate it on `POST /auth/login` — a fresh session gets a fresh token — and expire it on
`POST /auth/logout`, next to the other two:

```http
Set-Cookie: XSRF-TOKEN=; Secure; SameSite=Strict; Path=/; Max-Age=0
```

### Answer the bootstrap

```http
GET /api/v1/csrf HTTP/1.1
```

```http
HTTP/1.1 204 No Content
Set-Cookie: XSRF-TOKEN=<token>; Secure; SameSite=Strict; Path=/; Max-Age=2592000
Cache-Control: no-store
```

It exists because the token is a cookie the API sets, so a browser that has never had a
response from the API has nothing to echo — and the first API request a cold visit to
`/login` makes is `POST /auth/login`, a mutation. Without it, a correctly configured API
rejects every sign-in attempt.

`Cache-Control: no-store` because a cached bootstrap is a request that returns without a
`Set-Cookie`, which looks like success and sets nothing. The path is outside `/auth` on
purpose: the request is credentialed, and the refresh cookie's `Path=/api/v1/auth` scoping
means a bootstrap at `/auth/csrf` would attach a thirty-day credential to a request that
needs none.

### Reject what does not match

For every request whose method is not `GET`, `HEAD`, `OPTIONS` or `TRACE` — the same four
the client exempts:

1. Read `X-XSRF-TOKEN` and the `XSRF-TOKEN` cookie.
2. Reject with `403` if either is absent, or if they differ. Compare in constant time; the
   token is a secret, and a comparison that returns early leaks it a byte at a time to
   anyone who can time a request.
3. Reject with `403` if the cookie is present and the header is not. This is the case that
   matters: a forged cross-site request can carry the cookie, because the browser attaches
   it, and cannot carry the header.

No exemptions, `/auth/login` included. Login CSRF — forcing a victim's browser into an
attacker's session so that what they do next is recorded against it — is a real attack, and
an exemption list is the thing that makes the rule unauditable.

A signed token (`<random>.<HMAC(random, server secret)>`) is worth preferring over a bare
random value if the API has somewhere to keep a secret: it lets the server reject a cookie
it did not issue, which closes the sub-domain injection case where an attacker who controls
`other.example.com` can write a cookie onto `example.com` and then submit both halves of a
matching pair. It changes nothing on this side — the client echoes whatever the cookie says.

### Allow the header through CORS

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: Authorization, Content-Type, X-XSRF-TOKEN
Access-Control-Max-Age: 600
```

A custom header makes a cross-origin request non-simple, so the browser preflights it, and
a preflight that does not list `X-XSRF-TOKEN` fails the request **in the browser** — a CORS
error, not a 403, with nothing in the API's logs. `Access-Control-Allow-Origin` must name
the origin exactly: `*` is rejected outright by browsers on a credentialed request, so the
wildcard that makes a public API convenient makes this one unreachable.

`Access-Control-Max-Age` is what keeps the preflight from being per-request. The mutations
were already non-simple by virtue of `Content-Type: application/json`, so this header costs
no round trip that was not already being paid.

## Why nothing here refuses to send a request

`csrfInterceptor` never blocks. No token, a failed bootstrap, an API that set a cookie on a
domain this document cannot read — the request goes out regardless, without the header, and
the server answers.

That is deliberate, and it is the whole reason the server half of this document is the half
that matters. The forged request does not come from this code; it comes from a page we do
not control, which will never consult a check we wrote. The client's only job is to make a
legitimate request **distinguishable** from a forged one. Deciding what to do with an
indistinguishable one is the server's, and the server is the only place that decision means
anything. A client that blocked instead would protect nobody, and would break every
deployment whose API does not enforce CSRF at all — while producing a client-side error
message in place of the API's own 403, which is the one diagnostic with a server-side log
behind it.

## Known gaps

- **The server half is a contract, not an implementation.** This repository is a front end;
  there is no API here to enforce the rule. What is verified is the client — by
  `csrf.interceptor.spec.ts` against `HttpTestingController`, and by
  `e2e/csrf/csrf.spec.ts`, where a reference implementation of the rules above
  (`e2e/helpers/csrf-contract.ts`) adjudicates the real requests a real Chromium makes,
  including the negative cases. It is not the same as auditing a deployed API.
- **No `Secure` in the e2e cases**, for the same reason `token-storage.md` gives: those
  tests run over plain HTTP against `ng serve`, where a browser drops a `Secure` cookie
  outright. Production must set it.
- **The sub-domain cookie-injection case is open** unless the API issues signed tokens. A
  bare random value cannot be told from one written by a sibling sub-domain an attacker
  controls, and nothing on this side can detect that.
- **One token per browser, not per form.** A per-request token would narrow the window a
  leaked token is useful in; it also breaks concurrent requests and the back button, and it
  is not what the cookie-based pattern can express.
- **`e2e/token-storage.spec.ts` and the `chromium` project still do not run in CI** — the
  Phase 0 carry-over, unchanged by this item. The new `csrf` project does run, as its own
  job, which is the same shape of fix applied to one suite rather than all of them.
