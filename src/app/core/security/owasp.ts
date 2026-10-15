/**
 * The OWASP Top 10 checklist, as data this repository's CI can check rather than prose.
 *
 * ## What a checklist is for, and the way it goes wrong
 *
 * A security checklist is the one artifact whose failure mode is *reading as coverage*.
 * Ten categories with ten ticks beside them is the most reassuring document a repository
 * can hold and, for a browser application, almost certainly false: most of the OWASP Top
 * 10 is decided by a server, and this repository has no server beyond the one that hands
 * out documents. A tick against "Broken Access Control" earned by a route guard is worse
 * than no checklist at all, because a route guard is navigation — it decides what the
 * address bar does, not what the API will answer — and anybody who audits from that tick
 * stops looking.
 *
 * So two rules shape everything below.
 *
 * **Every category carries a verdict, and `server-owned` is a legitimate answer.** What
 * the client owns is recorded; what it does not own is recorded as a contract the API has
 * to satisfy, with a document to implement from. Nothing is marked mitigated because a
 * mitigation would be nice to have.
 *
 * **Every claim names the test that proves it, and the test has to be one CI runs.** This
 * is the part `scripts/ci/assert-owasp-checklist.mjs` enforces, and it is what makes the
 * difference between a checklist and a wish: each `proofs` entry is resolved to a real
 * `it(…)` in a spec Karma executes, a real Playwright case in a project CI drives, or a
 * marked rule in a gate script the workflow invokes. A proof that is renamed, deleted, or
 * parked in a suite nothing runs fails the gate, which means a claim here cannot outlive
 * the thing that made it true.
 *
 * ## The edition
 *
 * Keyed to **OWASP Top 10:2025**, released at Global AppSec in November 2025, not the
 * 2021 edition most muscle memory reaches for. The two are not the same list: 2025 adds
 * Software Supply Chain Failures and Mishandling of Exceptional Conditions, absorbs
 * 2021's A10 (SSRF) into Broken Access Control, and renumbers almost everything else. A
 * checklist against the superseded list would be the same quiet kind of wrong this file
 * exists to prevent, so the edition is named in the data and `owasp.spec.ts` pins the ten
 * ids and titles against a transcription — which makes a retitle a two-file diff a
 * reviewer sees rather than a silent edit.
 *
 * ## Why this file has no imports
 *
 * `assert-owasp-checklist.mjs` reads the registry by transpiling this file and importing
 * the result, so that the gate and the application share one definition instead of the
 * gate keeping a copy to drift. That only works while this file is self-contained: a
 * runtime import would not resolve. Types are declared here for the same reason.
 *
 * See `docs/owasp-top-10.md` for the prose version, the server contracts, and the gaps.
 */

/** The edition the categories below are transcribed from. */
export const OWASP_EDITION = 'OWASP Top 10:2025';

/**
 * How much of a category this application can answer for.
 *
 * - `client-mitigated` — the defence lives here and is proved here.
 * - `shared-with-server` — a real client-side defence, bounded by a server contract that
 *   this repository can specify and cannot execute.
 * - `server-owned` — nothing the client can do about the risk itself. What is recorded is
 *   the contract, plus any client-side property that must not *undermine* it.
 */
export type OwaspVerdict = 'client-mitigated' | 'shared-with-server' | 'server-owned';

/**
 * Something CI runs that would fail if the claim stopped being true.
 *
 * The three kinds are the three ways this repository can execute a check, and each is
 * resolved differently by the gate: a `spec` to an `it(…)` title in a Karma-run file, an
 * `e2e` to a Playwright case in a project the workflow drives, a `gate` to an `@owasp`
 * marker in a script an npm script in the workflow invokes.
 */
export type OwaspProof =
  | { readonly kind: 'spec'; readonly file: string; readonly test: string }
  | { readonly kind: 'e2e'; readonly file: string; readonly test: string }
  | { readonly kind: 'gate'; readonly script: string; readonly command: string };

/** One defence, stated so that it is either true or false, with what proves it. */
export interface OwaspMitigation {
  /** Stable id, `<category>.<slug>`. Cited by `@owasp` markers in the gate scripts. */
  readonly id: string;
  /** What holds, in a sentence a reviewer can disagree with. */
  readonly claim: string;
  /** At least one. Every entry must be something CI runs. */
  readonly proofs: readonly OwaspProof[];
}

export interface OwaspCategory {
  /** `A01`…`A10`, in the edition's order. */
  readonly id: string;
  /** The edition's title, transcribed. */
  readonly title: string;
  readonly verdict: OwaspVerdict;
  /** What this application is in a position to decide about the risk. */
  readonly ownership: string;
  readonly mitigations: readonly OwaspMitigation[];
  /**
   * Heading in `docs/owasp-top-10.md` holding what the server must do. Required unless
   * the verdict is `client-mitigated`: a category this repository cannot close on its own
   * has to leave an API author something to implement.
   */
  readonly serverContract?: string;
  /** What is still open, named rather than left to be rediscovered. */
  readonly gaps?: readonly string[];
}

export const OWASP_TOP_10: readonly OwaspCategory[] = [
  {
    id: 'A01',
    title: 'Broken Access Control',
    verdict: 'shared-with-server',
    ownership:
      'A browser decides nothing about authorisation: the route guards here choose what to ' +
      'render and where to send a visitor, and an attacker who wants the data simply calls ' +
      'the API without them. What the client genuinely owns is that it fails closed, that ' +
      'no route escapes the guards by being added later, and that the credentials it holds ' +
      'never travel anywhere they could be replayed.',
    serverContract: 'A01:2025 — Broken Access Control',
    mitigations: [
      {
        id: 'A01.guards-fail-closed',
        claim:
          'With no session, or a session that resolves to no user, every guard denies and ' +
          'redirects rather than falling through to the route.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/guards/auth.guard.spec.ts',
            test: 'redirects to /login when not authenticated',
          },
          {
            kind: 'spec',
            file: 'src/app/core/guards/auth.guard.spec.ts',
            test: 'redirects once the restore finishes without a user',
          },
          {
            kind: 'spec',
            file: 'src/app/core/guards/role.guard.spec.ts',
            test: 'redirects to /unauthorized when userRole is null but authenticated',
          },
        ],
      },
      {
        id: 'A01.every-route-is-classified',
        claim:
          'Every route that is not a redirect carries `authGuard` unless its path is on a ' +
          'short, reviewed public list, so a new top-level route cannot be published ' +
          'unguarded by omission.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/app.routes.spec.ts',
            test: 'requires a session for every route that is not explicitly public',
          },
          {
            kind: 'spec',
            file: 'src/app/app.routes.spec.ts',
            test: 'publishes only the auth feature at the public root',
          },
        ],
      },
      {
        id: 'A01.credentials-never-leave-the-api',
        claim:
          'The access token and the CSRF token are attached only to requests for the ' +
          'configured API, because the interceptors that write them are installed inside ' +
          'the `requestsUnder(environment.apiUrl)` scope.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/app.config.spec.ts',
            test: 'sends no bearer token to an origin that is not the configured API',
          },
          {
            kind: 'spec',
            file: 'src/app/app.config.spec.ts',
            test: 'does not spend the refresh cookie on a 401 from somewhere else',
          },
          {
            kind: 'spec',
            file: 'src/app/core/http/interceptors/csrf.interceptor.spec.ts',
            test: 'never sends the token to an origin that is not the configured API',
          },
          {
            kind: 'gate',
            script: 'scripts/ci/assert-csrf.mjs',
            command: 'check:csrf',
          },
        ],
      },
      {
        id: 'A01.a-cross-site-request-is-refused',
        claim:
          'A mutation that only another site could have caused — the session cookie ' +
          'attached by the browser, no header, because no cross-origin page can set one — ' +
          'is refused, and the double-submit pair is adjudicated in a real browser rather ' +
          'than asserted against a mock.',
        proofs: [
          {
            kind: 'e2e',
            file: 'e2e/csrf/csrf.spec.ts',
            test: 'a request carrying the cookie but no header is refused',
          },
          {
            kind: 'e2e',
            file: 'e2e/csrf/csrf.spec.ts',
            test: 'a cold sign-in fetches one token and the login POST carries it',
          },
          {
            kind: 'spec',
            file: 'src/app/core/http/interceptors/csrf.interceptor.spec.ts',
            test: 'protects every mutating method',
          },
        ],
      },
      {
        id: 'A01.no-sink-that-can-leave-the-origin',
        claim:
          'No user-controlled string can redirect a visitor off-origin: `location` and ' +
          '`window` are refused in `src/app/**`, and `Router.navigateByUrl` resolves its ' +
          'argument against the route table instead of the network.',
        proofs: [
          {
            kind: 'gate',
            script: 'scripts/ci/assert-lint-bans.mjs',
            command: 'check:lint-bans',
          },
          {
            kind: 'spec',
            file: 'src/app/features/auth/login.component.spec.ts',
            test: 'does not take a visitor off-origin for a returnUrl naming another host',
          },
          {
            kind: 'spec',
            file: 'src/app/features/auth/login.component.spec.ts',
            test: 'does not take a visitor off-origin for a protocol-relative returnUrl',
          },
        ],
      },
    ],
    gaps: [
      'SSRF moved into this category in 2025. Its browser-side analogue is the application ' +
        'being steered into requesting an attacker-chosen origin, which `connect-src` bounds ' +
        'to `self` plus the configured API — a header, not a test: nothing in CI asks a ' +
        'browser to make a forbidden request and watch it blocked.',
      'Object-level authorisation — whether this signed-in user may read *this* record — is ' +
        'entirely the API’s, and no fixture here can stand in for it.',
    ],
  },
  {
    id: 'A02',
    title: 'Security Misconfiguration',
    verdict: 'shared-with-server',
    ownership:
      'The response headers and the build configuration are the client’s half, and the ' +
      'headers are served by `src/server.ts`, which is in this repository. The platform ' +
      'around it — TLS, the CDN, whatever terminates in front of the server — is not.',
    serverContract: 'A02:2025 — Security Misconfiguration',
    mitigations: [
      {
        id: 'A02.csp-is-enforced-and-per-response',
        claim:
          'Every document carries an enforcing Content-Security-Policy with a nonce minted ' +
          'for that response, and the artifact is checked rather than the source.',
        proofs: [
          {
            kind: 'gate',
            script: 'scripts/ci/assert-csp.mjs',
            command: 'check:csp',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'never allows inline script',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/nonce.spec.ts',
            test: 'returns a different value every time',
          },
        ],
      },
      {
        id: 'A02.framing-and-base-uri-refused',
        claim:
          'The policy refuses framing, plugins and `<base>` injection outright, rather than ' +
          'leaving them to inherit from `default-src`.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'blocks plugins, framing, and base-tag injection',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'declares every directive it relies on',
          },
        ],
      },
      {
        id: 'A02.development-gets-no-relaxation',
        claim:
          'The policy is a pure function of the environment with no development allowance ' +
          'to inherit: there is no `unsafe-eval` and no websocket exception anywhere, so ' +
          'the header `ng serve` sends is the header production sends.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'never allows eval',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'never emits a directive with no sources',
          },
        ],
      },
    ],
    gaps: [
      '`frame-ancestors` and `form-action` are asserted in the header, never against a ' +
        'browser: nothing in CI tries to frame the application or redirect one of its forms.',
      'There is no CSP reporting endpoint, so a violation in the field is invisible. ' +
        '`docs/security.md` explains why that is a deployment decision.',
    ],
  },
  {
    id: 'A03',
    title: 'Software Supply Chain Failures',
    verdict: 'shared-with-server',
    ownership:
      'What this repository installs, and what that install is allowed to execute. The ' +
      'registry it installs from, and the integrity of what the registry serves, are not ' +
      'its to guarantee.',
    serverContract: 'A03:2025 — Software Supply Chain Failures',
    mitigations: [
      {
        id: 'A03.no-dependency-runs-code-at-install',
        claim:
          '`onlyBuiltDependencies` is empty, so no dependency’s install script executes — ' +
          'the step where a compromised package runs with the developer’s and the runner’s ' +
          'privileges before any of its code is ever imported.',
        proofs: [
          {
            kind: 'gate',
            script: 'scripts/ci/assert-owasp-checklist.mjs',
            command: 'check:owasp',
          },
        ],
      },
      {
        id: 'A03.the-lockfile-is-what-ci-installs',
        claim:
          'A lockfile is committed and CI installs with `--frozen-lockfile`, so a run ' +
          'cannot silently resolve a different dependency graph than the one reviewed.',
        proofs: [
          {
            kind: 'gate',
            script: 'scripts/ci/assert-owasp-checklist.mjs',
            command: 'check:owasp',
          },
        ],
      },
    ],
    gaps: [
      'No provenance or signature verification: `--frozen-lockfile` pins integrity hashes ' +
        'for what the registry served when the lockfile was written, which is not the same ' +
        'as knowing who published it.',
      'Pinned GitHub Actions are pinned by major tag, not by digest, so a compromised tag ' +
        'would move under CI. `boilerplate-devops` is where the digest-pinning pattern lives.',
      'No automated advisory scan of the installed tree runs in CI.',
    ],
  },
  {
    id: 'A04',
    title: 'Cryptographic Failures',
    verdict: 'shared-with-server',
    ownership:
      'The client holds exactly two secrets — the access token in memory and the nonce it ' +
      'mints per response — and owns where they live and where they come from. Every key, ' +
      'every signature and the transport itself belong to the server.',
    serverContract: 'A04:2025 — Cryptographic Failures',
    mitigations: [
      {
        id: 'A04.no-token-survives-a-page-load',
        claim:
          'No auth token is written anywhere a later page load could read it: the access ' +
          'token is a field of the store and the refresh token is a cookie JavaScript ' +
          'cannot see.',
        proofs: [
          {
            kind: 'gate',
            script: 'scripts/ci/assert-no-token-persistence.mjs',
            command: 'check:tokens',
          },
          {
            kind: 'spec',
            file: 'src/app/store/auth/auth.store.spec.ts',
            test: 'persists no token anywhere a later page load could read it',
          },
        ],
      },
      {
        id: 'A04.the-nonce-comes-from-a-csprng',
        claim:
          'The CSP nonce is 128 bits drawn from the platform CSPRNG, which is the only ' +
          'property that makes it worth sending at all.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/security/nonce.spec.ts',
            test: 'draws its bytes from the platform CSPRNG, never from Math.random',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/nonce.spec.ts',
            test: 'carries 128 bits of entropy',
          },
        ],
      },
    ],
    gaps: [
      '`Secure` on the refresh and CSRF cookies is specified in `docs/csrf.md` and never ' +
        'exercised: the e2e cases run over plain HTTP, where a browser drops such a cookie.',
      'Token lifetimes, signing algorithm and key rotation are the API’s, and a client ' +
        'cannot tell a correctly signed token from a forged one.',
    ],
  },
  {
    id: 'A05',
    title: 'Injection',
    verdict: 'client-mitigated',
    ownership:
      'Cross-site scripting is the injection a browser application can actually commit, ' +
      'and every sink that could commit one is in this repository. SQL and command ' +
      'injection need an interpreter this code never touches.',
    mitigations: [
      {
        id: 'A05.untrusted-markup-is-sanitised',
        claim:
          'Interpolation escapes by default, `[innerHTML]` runs through Angular’s ' +
          'sanitiser, and the one sanctioned helper for server-sent markup takes a `string` ' +
          'so a bypassed value cannot reach it.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/security/sanitisation.spec.ts',
            test: 'neutralises a javascript: URL by prefixing it rather than removing it',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/sanitisation.spec.ts',
            test: 'is why sanitize() alone is not a guarantee: it unwraps a bypassed value',
          },
        ],
      },
      {
        id: 'A05.sanitiser-is-never-bypassed',
        claim:
          '`DomSanitizer.bypassSecurityTrust*` is refused twice: by a lint rule proven to ' +
          'fire, and at the sink by a Trusted Types policy list that omits the one those ' +
          'methods need.',
        proofs: [
          {
            kind: 'gate',
            script: 'scripts/ci/assert-lint-bans.mjs',
            command: 'check:lint-bans',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'refuses the bypass policy, so a bypass fails at the sink',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'requires typed values at the dangerous DOM sinks',
          },
        ],
      },
    ],
    gaps: [
      'The Trusted Types allow-list was arrived at by reading every `createPolicy` call in ' +
        '`node_modules`. A dependency registering a new policy fails at its sink, at ' +
        'runtime, with nothing in CI to catch it first.',
    ],
  },
  {
    id: 'A06',
    title: 'Insecure Design',
    verdict: 'shared-with-server',
    ownership:
      'The parts of the design this repository chose: where a credential lives, what a ' +
      'guard does when it cannot decide yet, and what happens to a session when a refresh ' +
      'fails. A design review of the system as a whole is not a thing a test can be.',
    serverContract: 'A06:2025 — Insecure Design',
    mitigations: [
      {
        id: 'A06.the-session-is-designed-to-survive-an-xss',
        claim:
          'The access token lives in memory and the refresh token in an `HttpOnly` cookie, ' +
          'so script that runs on the page can act as the user while it runs and cannot ' +
          'take a session away with it.',
        proofs: [
          {
            kind: 'gate',
            script: 'scripts/ci/assert-no-token-persistence.mjs',
            command: 'check:tokens',
          },
          {
            kind: 'spec',
            file: 'src/app/store/auth/auth.store.spec.ts',
            test: 'drops the session hint, so a reload does not try to restore',
          },
        ],
      },
      {
        id: 'A06.undecided-is-not-permitted',
        claim:
          'A guard that cannot yet tell whether there is a session waits for the restore to ' +
          'settle instead of answering with the state it happens to see.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/guards/auth.guard.spec.ts',
            test: 'does not decide until the restore settles',
          },
          {
            kind: 'spec',
            file: 'src/app/core/guards/auth.guard.spec.ts',
            test: 'emits only the first settled answer',
          },
        ],
      },
    ],
    gaps: [
      'Each tab holds its own access token, so signing out in one leaves another acting ' +
        'until its next request 401s. A `BroadcastChannel` would close it.',
      'There is no threat model document, and nothing here is a substitute for one.',
    ],
  },
  {
    id: 'A07',
    title: 'Authentication Failures',
    verdict: 'server-owned',
    ownership:
      'Authentication happens at the API. The client can refuse to send a credential it ' +
      'knows is malformed, and must make sure signing out and failing to refresh both end ' +
      'the session rather than half of it — everything else about who the user is belongs ' +
      'to the server.',
    serverContract: 'A07:2025 — Authentication Failures',
    mitigations: [
      {
        id: 'A07.credentials-are-checked-before-they-are-sent',
        claim:
          'The sign-in and registration forms enforce a password policy at the edge, so a ' +
          'credential the API would reject does not leave the browser.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/features/auth/register.component.spec.ts',
            test: 'should enforce password complexity rules',
          },
        ],
      },
      {
        id: 'A07.signing-out-revokes-the-session',
        claim:
          'Signing out clears local state immediately and asks the API to revoke the ' +
          'refresh cookie, and stays signed out even when that request fails.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/store/auth/auth.store.spec.ts',
            test: 'asks the server to revoke the session and expire the refresh cookie',
          },
          {
            kind: 'spec',
            file: 'src/app/store/auth/auth.store.spec.ts',
            test: 'stays signed out when the revocation request fails',
          },
        ],
      },
      {
        id: 'A07.a-refused-refresh-ends-the-session',
        claim:
          'A rejected refresh clears the session rather than leaving a user object with no ' +
          'usable token behind it.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/http/interceptors/jwt.interceptor.spec.ts',
            test: 'clears the session and emits error when the refresh is rejected',
          },
          {
            kind: 'spec',
            file: 'src/app/core/http/interceptors/jwt.interceptor.spec.ts',
            test: 'does not attempt a refresh for a visitor with neither a token nor a hint',
          },
        ],
      },
    ],
    gaps: [
      'Rate limiting, lockout, credential-stuffing defence, MFA and password breach checks ' +
        'are all the API’s, and a client-side password rule is a usability feature that an ' +
        'attacker posting to the endpoint directly never sees.',
      'Signing out does not navigate: the user is left on a dashboard with no session until ' +
        'the next navigation.',
    ],
  },
  {
    id: 'A08',
    title: 'Software or Data Integrity Failures',
    verdict: 'shared-with-server',
    ownership:
      'That the code which runs is the code that was built: no interpreter in the bundle, ' +
      'no string reaching a sink that would execute it, and a dependency graph that matches ' +
      'the one reviewed. Deployment integrity is somebody else’s pipeline.',
    serverContract: 'A08:2025 — Software or Data Integrity Failures',
    mitigations: [
      {
        id: 'A08.nothing-can-turn-data-into-code',
        claim:
          'The policy refuses `unsafe-eval` and omits the JIT Trusted Types policy, so a ' +
          'string cannot become code at runtime even if the compiler were pulled into the ' +
          'bundle.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'never allows eval',
          },
          {
            kind: 'spec',
            file: 'src/app/core/security/csp.spec.ts',
            test: 'refuses the JIT policy, which an ahead-of-time build has no use for',
          },
        ],
      },
      {
        id: 'A08.the-built-artifact-is-what-it-claims',
        claim:
          'The build output is checked rather than trusted: the served document matches the ' +
          'policy it is sent with, carries no inline handler, and the hashed subresources ' +
          'are the only cacheable part of it.',
        proofs: [
          {
            kind: 'gate',
            script: 'scripts/ci/assert-csp.mjs',
            command: 'check:csp',
          },
        ],
      },
    ],
    gaps: [
      'No Subresource Integrity attributes: every script and stylesheet is same-origin and ' +
        'content-hashed, so SRI would add nothing here — and would be required the moment ' +
        'anything was loaded from a CDN.',
      'API responses are typed, not validated. A response that lies about its shape ' +
        'reaches the store, and only the forms go through a Zod schema.',
    ],
  },
  {
    id: 'A09',
    title: 'Logging & Alerting Failures',
    verdict: 'server-owned',
    ownership:
      'A browser cannot be the place security events are recorded: an attacker controls the ' +
      'client. What the client owes is the opposite duty — that what it does send out ' +
      'carries nothing it should not, since a telemetry sink is a third party by design.',
    serverContract: 'A09:2025 — Logging & Alerting Failures',
    mitigations: [
      {
        id: 'A09.telemetry-carries-no-query-string',
        claim:
          'An HTTP span records the request URL without its parameters, so a token, an ' +
          'email or an id in a query string never reaches the collector.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/http/interceptors/telemetry.interceptor.spec.ts',
            test: 'reports the URL without its query string',
          },
        ],
      },
    ],
    gaps: [
      'There is no alerting, and nothing here could be: detection belongs to the API and ' +
        'the infrastructure around it.',
      'The development console logger prints `urlWithParams` and whole error responses. It ' +
        'is behind `isDevMode()`, so it does not ship, and nothing asserts that — Angular ' +
        'offers no way to make `isDevMode()` answer differently inside a spec.',
    ],
  },
  {
    id: 'A10',
    title: 'Mishandling of Exceptional Conditions',
    verdict: 'client-mitigated',
    ownership:
      'How this application behaves when something fails is entirely its own: which error ' +
      'a user is shown, what a failed refresh leaves behind, and what a guard does with a ' +
      'question it cannot answer yet.',
    mitigations: [
      {
        id: 'A10.every-failure-resolves-to-a-mapped-error',
        claim:
          'Every HTTP failure becomes an `ApiError` through an ordered mapper chain with a ' +
          'fallback, so no code path depends on a response body having the shape it hoped ' +
          'for and nothing reaches the UI unmapped.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/core/http/errors/api-error-mappers.spec.ts',
            test: 'has something to say even when the response describes itself as nothing',
          },
          {
            kind: 'spec',
            file: 'src/app/core/http/errors/api-error-mappers.spec.ts',
            test: 'takes the first mapper that answers, in the order given',
          },
        ],
      },
      {
        id: 'A10.a-failure-leaves-no-half-state',
        claim:
          'The paths where a failure could leave an inconsistent session do not: a rejected ' +
          'refresh clears it, a failed revocation still signs out, and a second submit while ' +
          'one is in flight is dropped rather than racing it.',
        proofs: [
          {
            kind: 'spec',
            file: 'src/app/store/auth/auth.store.spec.ts',
            test: 'ignores a second submit while the first is in flight',
          },
          {
            kind: 'spec',
            file: 'src/app/core/http/interceptors/jwt.interceptor.spec.ts',
            test: 'clears the session and emits error when the refresh is rejected',
          },
        ],
      },
    ],
    gaps: [
      'A mapper reads the API’s own message straight onto the page, which is the right ' +
        'behaviour for a validation error and the wrong one for an API that returns a stack ' +
        'trace in `detail`. Whether a message is safe to display is the API’s to decide.',
    ],
  },
];
