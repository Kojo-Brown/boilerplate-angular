# The OWASP Top 10, as something CI can check

A security checklist is the one artifact whose failure mode is **reading as coverage**.
Ten categories with ten ticks beside them is the most reassuring page a repository can
hold and, for a browser application, almost certainly false: most of the OWASP Top 10 is
decided by a server, and there is no server here beyond the one that hands out documents.
A tick against "Broken Access Control" earned by a route guard is worse than no checklist
at all, because a route guard decides what the address bar does, not what the API will
answer — and whoever audits from that tick stops looking.

So this document is built to be wrong out loud rather than right in the abstract.

- `src/app/core/security/owasp.ts` is the checklist as data: a verdict per category,
  a claim per defence, and the test that proves each claim.
- `scripts/ci/assert-owasp-checklist.mjs` resolves every one of those proofs against the
  filesystem and against `.github/workflows/ci.yml`. A proof that was renamed, deleted,
  or parked in a suite CI does not run fails the gate. **A claim cannot outlive the thing
  that made it true.**
- `src/app/core/security/owasp.spec.ts` keeps the registry well formed and pins the
  edition's ten ids and titles against a hand transcription.

## The edition

Keyed to **OWASP Top 10:2025**, released at Global AppSec Washington DC in November 2025 —
not the 2021 edition most muscle memory reaches for. They are not the same list. 2025 adds
*Software Supply Chain Failures* and *Mishandling of Exceptional Conditions*, folds 2021's
A10 (SSRF) into A01, and renumbers nearly everything else: *Security Misconfiguration*
moves from A05 to A02, *Injection* from A03 to A05, *Cryptographic Failures* from A02 to
A04. A checklist still matching 2021 would be exactly the quiet kind of wrong this page
exists to prevent, which is why the edition is named in the data and transcribed in a spec
where a reviewer sees it move.

## The three verdicts

Each category carries one, and `server-owned` is a legitimate answer rather than a shrug —
a category this application cannot close on its own has to leave an API author something
to implement, which the gate enforces by requiring a "What the server must do" section
wherever the verdict is not `client-mitigated`.

| Verdict | Means |
| --- | --- |
| `client-mitigated` | The defence lives here and is proved here. |
| `shared-with-server` | A real client-side defence, bounded by a server contract this repository can specify and cannot execute. |
| `server-owned` | Nothing the client can do about the risk itself. What is recorded is the contract, plus any client-side property that must not undermine it. |

## The checklist

| Category | Verdict | What this application owns |
| --- | --- | --- |
| [A01:2025 — Broken Access Control](#a012025--broken-access-control) | `shared-with-server` | Failing closed, classifying every route, and keeping credentials off every origin but the API's. |
| [A02:2025 — Security Misconfiguration](#a022025--security-misconfiguration) | `shared-with-server` | The response headers and the build configuration. |
| [A03:2025 — Software Supply Chain Failures](#a032025--software-supply-chain-failures) | `shared-with-server` | What gets installed, and what that install is allowed to execute. |
| [A04:2025 — Cryptographic Failures](#a042025--cryptographic-failures) | `shared-with-server` | Where the two client-held secrets live, and where the nonce comes from. |
| [A05:2025 — Injection](#a052025--injection) | `client-mitigated` | Every sink that could commit an XSS is in this repository. |
| [A06:2025 — Insecure Design](#a062025--insecure-design) | `shared-with-server` | The session design, and what a guard does with a question it cannot yet answer. |
| [A07:2025 — Authentication Failures](#a072025--authentication-failures) | `server-owned` | That signing out, failing to refresh, and sitting idle all end a session rather than half of it. |
| [A08:2025 — Software or Data Integrity Failures](#a082025--software-or-data-integrity-failures) | `shared-with-server` | That the code which runs is the code that was built. |
| [A09:2025 — Logging & Alerting Failures](#a092025--logging--alerting-failures) | `server-owned` | That what the client sends out carries nothing it should not. |
| [A10:2025 — Mishandling of Exceptional Conditions](#a102025--mishandling-of-exceptional-conditions) | `client-mitigated` | How this application behaves when something fails. |

Four of the ten are not a client's to close, and two of those are not a client's to touch
at all. That is the honest shape of the list for a browser application, and a checklist
that produced a tidier one would be describing a different repository.

---

## A01:2025 — Broken Access Control

A browser decides nothing about authorisation. The guards in `core/guards/` choose what to
render and where to send a visitor; an attacker who wants the data calls the API without
ever loading the application. **`authGuard` is navigation. Authorisation is the API's, for
every request, without exception.**

What the client genuinely owns is narrower and still worth having:

- **`A01.guards-fail-closed`** — no session, or a session that resolves to no user, means
  deny and redirect, never fall through.
- **`A01.every-route-is-classified`** — every route that is not a redirect carries
  `authGuard` unless its path is on a short public list in `app.routes.spec.ts`. The
  assertion is on the *partition*, not the members, because naming `dashboard` and `admin`
  is the right test for the routes that exist and no test at all for the one added next
  year: a new top-level route with no `canActivate` compiles, renders, and leaves every
  other spec green.
- **`A01.credentials-never-leave-the-api`** — the access token and the CSRF token are
  attached only inside the `requestsUnder(environment.apiUrl)` scope.
- **`A01.a-cross-site-request-is-refused`** — the double-submit pair, adjudicated by a
  real implementation of the server's rules in a real browser. See [csrf.md](./csrf.md).
- **`A01.no-sink-that-can-leave-the-origin`** — see below.

### The finding this item turned up

`jwtInterceptor` was installed *outside* that scope — at the top of `withInterceptors([…])`,
beside telemetry and logging — while `csrfInterceptor` sat inside it. Every request
`HttpClient` made to any host in the world would have carried the access token, which is
strictly more valuable than the CSRF token the repository already refuses to leak.

Nothing failed, and nothing could have. Every URL this application builds is
`environment.apiUrl` plus a path, so no spec and no e2e case ever posted to a third-party
host to notice; `jwt.interceptor.spec.ts` proved the interceptor attaches a header, which
is its job, and said nothing about where. The exposure was entirely in the next call
somebody added — an analytics endpoint, a feature-flag service, a tile server — which
would have been handed a working session with nothing in CI to say so.

The fix is one line of configuration. The assertions are in `app.config.spec.ts` rather
than beside the interceptor, because the property is about where the interceptor is
*installed*: both of the ones that matter were green before the fix and fail without it.

### Open redirects, and why `returnUrl` is not one

`authGuard` puts the blocked URL in `?returnUrl=`, and `login.component.ts` hands whatever
it finds there to `Router.navigateByUrl`. In a server-rendered application that is the
textbook open redirect. Here it is not, and the reason is worth writing down rather than
re-deriving in the next audit: **`Router.navigateByUrl` cannot leave the origin.** It
parses its argument as an application URL, matches it against the route table, and falls
to the wildcard when nothing matches.

The sinks that *can* leave the origin are `location`, `location.href`, `location.assign`
and `window.open`. `window` has been refused in `src/app/**` since SSR was turned on;
`location` was reachable and is now refused beside it, for the SSR reason and this one.
`scripts/ci/assert-lint-bans.mjs` proves both rules still fire — a ban nothing exercises
is indistinguishable from a repository that complies.

### What the server must do

- Authorise **every** request against the authenticated principal, including every
  object-level read: whether this user may see *this* record is not a question the client
  can be trusted with or tested for.
- Treat `/admin` endpoints as unrelated to the `admin` route. The role in the client's
  store came from the API and may be stale, forged, or simply absent.
- Reject a mutation that fails the CSRF contract in [csrf.md](./csrf.md) with a 403 before
  it reaches an endpoint.
- Scope and validate any server-side fetch it makes on a client's behalf — SSRF is in this
  category as of 2025, and a browser cannot help with it.

### Gaps

- SSRF's browser-side analogue — the application being steered into requesting an
  attacker-chosen origin — is bounded by `connect-src`, which is a header, not a test.
  Nothing in CI asks a browser to make a forbidden request and watches it blocked.
- Object-level authorisation is entirely the API's, and no fixture here stands in for it.

---

## A02:2025 — Security Misconfiguration

The response headers and the build configuration are the client's half, and the headers
come from `src/server.ts`, which is in this repository. The platform in front of it — TLS,
the CDN, whatever terminates the connection — is not.

- **`A02.csp-is-enforced-and-per-response`** — every document carries an enforcing policy
  with a nonce minted for that response, checked against the running artifact rather than
  the source. [security.md](./security.md) is the long version, including the measured
  finding that *every* way of losing the nonce leaves a working application.
- **`A02.framing-and-base-uri-refused`** — framing, plugins and `<base>` injection are
  refused outright rather than left to inherit from `default-src`.
- **`A02.development-gets-no-relaxation`** — there is no `unsafe-eval` and no websocket
  exception anywhere, so the header `ng serve` sends is the header production sends. A
  policy that exists only in production is first exercised in production, by a visitor.

### What the server must do

- Serve over HTTPS with HSTS, and set `Secure` on every cookie. Neither is visible to
  this repository's tests, which run over plain HTTP.
- Return no stack traces, framework banners or version headers on an error.
- Keep CORS to the exact origins that need it, with credentials allowed only for those,
  and include the CSRF header in `Access-Control-Allow-Headers`.
- Not cache a nonced document at the edge. `src/server.ts` strips the validators; an
  intermediary that adds its own undoes the whole mechanism silently.

### Gaps

- `frame-ancestors` and `form-action` are asserted in the header, never against a browser:
  nothing in CI tries to frame the application or redirect one of its forms.
- There is no CSP reporting endpoint, so a violation in the field is invisible.

---

## A03:2025 — Software Supply Chain Failures

New in 2025, and the category where a front-end repository carries the most weight it
cannot delegate: a dependency's install script runs with the developer's and the runner's
privileges before a line of its code is ever imported.

- **`A03.no-dependency-runs-code-at-install`** — `pnpm.onlyBuiltDependencies` is empty, so
  no install script executes. The four packages that would like to build native artifacts
  are in `ignoredBuiltDependencies`, which records the decision rather than hiding it.
- **`A03.the-lockfile-is-what-ci-installs`** — a lockfile is committed and CI installs with
  `--frozen-lockfile`, so a run cannot silently resolve a graph other than the reviewed one.

Both are properties of the manifest, so they have no spec to live in and are checked
directly by `assert-owasp-checklist.mjs`.

### What the server must do

- Build from a lockfile in a pipeline whose inputs are pinned, and keep the artifact it
  deploys identical to the one CI tested.
- Hold its own dependency floor: this checklist says nothing about the API's tree.

### Gaps

- No provenance or signature verification. `--frozen-lockfile` pins integrity hashes for
  what the registry served when the lockfile was written, which is not the same as knowing
  who published it.
- GitHub Actions are pinned by major tag, not by digest, so a compromised tag would move
  under CI. The digest-pinning pattern lives in `boilerplate-devops`.
- No advisory scan of the installed tree runs in CI.

---

## A04:2025 — Cryptographic Failures

The client holds exactly two secrets: the access token, in memory, and the nonce it mints
per response. Every key, every signature and the transport belong to the server.

- **`A04.no-token-survives-a-page-load`** — no auth token is written anywhere a later page
  load could read it. This is a property of every line of source, which is why it is a
  gate: a "remember me" checkbox that persisted the access token would leave every
  existing spec green while removing the one thing that makes an XSS bug survivable. See
  [token-storage.md](./token-storage.md).
- **`A04.the-nonce-comes-from-a-csprng`** — 128 bits from the platform CSPRNG. The
  provenance is asserted directly because the obvious wrong implementation passes
  everything else: sixteen bytes from `Math.random()` decode to length 16, fit the base64
  grammar, and never collide across 500 draws, so the entropy and uniqueness specs stay
  green while the nonce has become predictable.

### What the server must do

- Set the refresh cookie `HttpOnly`, `Secure`, `SameSite`, and scoped to a path — the
  contract in [csrf.md](./csrf.md) and [token-storage.md](./token-storage.md).
- Choose the token lifetimes, the signing algorithm and the key rotation, and keep
  signature verification on. A client cannot tell a valid token from a forged one.
- Hash passwords with a memory-hard function. The client's only role is not sending one
  it already knows the API will reject.

### Gaps

- `Secure` is specified and never exercised: the e2e cases run over plain HTTP, where a
  browser drops such a cookie.
- The sub-domain cookie-injection case stays open unless the API signs its CSRF tokens.

---

## A05:2025 — Injection

Cross-site scripting is the injection a browser application can actually commit, and every
sink that could commit one is in this repository. SQL and command injection need an
interpreter this code never touches — which is what makes this the one category the client
closes by itself.

- **`A05.untrusted-markup-is-sanitised`** — interpolation escapes by default, `[innerHTML]`
  runs through Angular's sanitiser, and `HtmlSanitiser` takes a `string` so a bypassed
  value cannot reach it. The type is the guarantee, not the call: `DomSanitizer.sanitize()`
  returns a `SafeValue`'s contents **unsanitised**, so it is a no-op on exactly the input
  you would most want it to clean.
- **`A05.sanitiser-is-never-bypassed`** — `bypassSecurityTrust*` is refused twice: by a
  lint rule, and at the sink by a Trusted Types allow-list that omits
  `angular#unsafe-bypass`. Two mechanisms because the second is what still works when the
  code did not come through this repository's lint. [security.md](./security.md) has the
  argument.

The lint half is proved by execution, not by inspection: `assert-lint-bans.mjs` lints
source that must be refused and source that must not. A selector with a mistyped
alternation goes quiet, `pnpm lint` passes on every file forever, and the only signal is
the absence of an error nobody was expecting.

### Gaps

- The Trusted Types allow-list was arrived at by reading every `createPolicy` call in
  `node_modules`. A dependency registering a new policy fails at its sink, at runtime,
  with nothing in CI to catch it first.

---

## A06:2025 — Insecure Design

A design review is not a thing a test can be, so what is recorded here is the handful of
design decisions this repository actually made and can hold itself to.

- **`A06.the-session-is-designed-to-survive-an-xss`** — the access token in memory, the
  refresh token in a cookie JavaScript cannot read. Script running on the page can act as
  the user *while it runs*; it cannot take the session away with it. Neither this nor the
  CSP claims to prevent XSS — they bound what one costs.
- **`A06.undecided-is-not-permitted`** — a guard that cannot yet tell whether a session
  exists waits for the restore to settle instead of answering from the state it happens to
  see. "Not yet known" resolving to "allowed" is the shape most client-side access-control
  bugs actually take.

### What the server must do

- Be the authority these client-side decisions are a convenience in front of, and assume
  every one of them has been bypassed.
- Revoke refresh tokens on sign-out server-side; the client cannot make a cookie it cannot
  read stop working.

### Gaps

- Each tab holds its own access token, so signing out in one leaves another acting until
  its next request 401s. A `BroadcastChannel` would close it.
- There is no threat model document, and nothing here substitutes for one.

---

## A07:2025 — Authentication Failures

Authentication happens at the API. The client can refuse to send a credential it already
knows is malformed, and must make sure that signing out and failing to refresh each end a
session rather than half of one.

- **`A07.credentials-are-checked-before-they-are-sent`** — a password policy at the edge,
  which is a usability feature: an attacker posting to the endpoint never sees it.
- **`A07.signing-out-revokes-the-session`** — local state clears immediately and the API is
  asked to revoke the refresh cookie, and a failed revocation still leaves the user signed
  out locally.
- **`A07.a-refused-refresh-ends-the-session`** — a rejected refresh clears the session
  rather than leaving a user object with no usable token behind it.
- **`A07.an-idle-session-ends-itself`** — a signed-in session left alone for fifteen
  minutes is ended in the tab that holds it, and input arriving after the deadline does not
  revive it. This is the other half of `docs/token-storage.md`: the refresh cookie is good
  for thirty days, and until this existed nothing made the *tab* stop using it, so a
  dashboard left open on a screen somebody else could reach stayed signed in for as long as
  the browser did. It bounds a session left unattended; it does nothing about a closed
  laptop or a credential already stolen. See `src/app/core/auth/idle-session/` and
  `docs/tdd.md`.

### What the server must do

- Everything that decides who the user is: rate limiting, lockout, credential-stuffing
  defence, MFA, breached-password checks, and the password hash itself.
- Expire and revoke refresh tokens, and reject a refresh for a revoked session even when
  the cookie is still in the browser.
- Return the same answer for an unknown email and a wrong password.

### Gaps

- Signing out does not navigate: the user is left on a dashboard with no session until the
  next navigation. `e2e/route-guard.spec.ts` asserts revocation plus a reload for this
  reason.
- An idle sign-out inherits that, deliberately — it does exactly what the button does — and
  there is no warning before it, which would need a dialog, a focus trap, a live region and
  two translated strings. `idle-countdown.ts` can already answer how long is left.
- The idle window is fifteen minutes for every user and every route, enforced per tab. A
  second tab signed into the same session has its own countdown, so the session ends when
  the *last* active tab's window elapses rather than when the user stops using the
  application.
- The client-side password rule and the server's must agree, and nothing checks that they do.

---

## A08:2025 — Software or Data Integrity Failures

That the code which runs is the code that was built.

- **`A08.nothing-can-turn-data-into-code`** — the policy refuses `unsafe-eval` and omits
  the JIT Trusted Types policy, so a string cannot become code at runtime even if the
  compiler were pulled into the bundle.
- **`A08.the-built-artifact-is-what-it-claims`** — the served document is checked rather
  than trusted: it matches the policy it is sent with, carries no inline handler, and the
  hashed subresources are the only cacheable part of it.

### What the server must do

- Deploy the artifact CI built, and not rebuild at deploy time from a floating range.
- Validate and authorise anything it deserialises. The client sends JSON; a server that
  trusts its shape is the half of this category a browser cannot reach.

### Gaps

- No Subresource Integrity attributes. Every script and stylesheet is same-origin and
  content-hashed, so SRI adds nothing here — and would be required the moment anything
  loaded from a CDN.
- API responses are typed, not validated: a response that lies about its shape reaches the
  store. Only the forms go through a Zod schema.

---

## A09:2025 — Logging & Alerting Failures

A browser cannot be where security events are recorded, because an attacker controls the
client. What the client owes is the opposite duty: that what it *sends out* carries nothing
it should not, since a telemetry sink is a third party by design.

- **`A09.telemetry-carries-no-query-string`** — an HTTP span records `req.url`, not
  `req.urlWithParams`, so a token, an email or an id in a parameter never reaches the
  collector. One word's difference, invisible in review, and the reason it has a test.

### What the server must do

- Log authentication, authorisation and validation failures with enough context to
  investigate, and alert on them. This is the category, and none of it is the client's.
- Not log the credentials or tokens the client sends.

### Gaps

- There is no alerting and nothing here could be.
- The development console logger prints `urlWithParams` and whole error responses. It is
  behind `isDevMode()` so it does not ship, and nothing asserts that: Angular offers no
  way to make `isDevMode()` answer differently inside a spec.

---

## A10:2025 — Mishandling of Exceptional Conditions

New in 2025, and the category most clearly a client's own: how this application behaves
when something fails is nobody else's decision.

- **`A10.every-failure-resolves-to-a-mapped-error`** — every HTTP failure becomes an
  `ApiError` through an ordered mapper chain with a fallback, so no path depends on a
  response body having the shape it hoped for.
- **`A10.a-failure-leaves-no-half-state`** — a rejected refresh clears the session, a
  failed revocation still signs out, and a second submit while one is in flight is dropped
  rather than racing it.

### Gaps

- A mapper reads the API's own message straight onto the page. That is right for a
  validation error and wrong for an API that returns a stack trace in `detail`; whether a
  message is safe to display is the API's to decide.

---

## What this page is not

- **Not an audit.** It is a map of what is checked, with the unchecked parts named. An
  audit is somebody adversarial reading the code.
- **Not a claim to prevent XSS.** A05 raises the cost of getting script onto the page and
  A04/A06 bound what that script can take. Neither is prevention.
- **Not transitive.** Nothing here says anything about the API, and four categories are
  mostly or entirely its.
