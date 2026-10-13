/**
 * The CSRF contract: the two names, the methods it applies to, and where a token comes
 * from.
 *
 * One module because the client half and the server half have to agree on every value
 * here, and the only way to keep two halves in agreement is to give them one definition
 * to read. `scripts/ci/assert-csrf.mjs` enforces that: the literals below may not appear
 * anywhere else in the repository — not in `app.config.ts`, not in a mock, and not in
 * `docs/csrf.md`'s own HTTP examples, which the gate parses and compares against these
 * constants rather than trusting prose to have been updated.
 *
 * ## What this defends, and what it does not
 *
 * Cross-site request forgery is an attack on requests the *browser* authorises on the
 * user's behalf — a cookie it attaches to any request to the right host, whoever caused
 * the request. This application has exactly two such endpoints, `POST /auth/refresh` and
 * `POST /auth/logout`, both authorised by the `HttpOnly` refresh cookie described in
 * `docs/token-storage.md`. Every other API call is authorised by an `Authorization:
 * Bearer` header, which a cross-site form, image or navigation cannot set, so those are
 * already immune by construction.
 *
 * `SameSite=Strict` on the refresh cookie is the other defence, and until this item it
 * was the only one. It is a good one — a cross-site POST to `/auth/refresh` carries no
 * cookie at all — but it is a property of the *deployment* rather than of the
 * application: a front end and an API on genuinely different sites cannot use `Strict`,
 * and the moment the cookie becomes `SameSite=None; Secure` the token below is the whole
 * defence. So this is written for the deployment that needs it, and it costs the
 * deployment that does not almost nothing.
 *
 * ## Why a client-side check is not one of the rules
 *
 * Nothing here refuses to send a request. A missing token is not an error this
 * application can usefully raise, because the request an attacker forges does not come
 * from this code — it comes from a page we do not control, which will never consult a
 * check we wrote. The client's only job is to make a legitimate request *distinguishable*
 * from a forged one; deciding what to do with an indistinguishable one is the server's,
 * and the server is the only place that decision means anything. A client that blocked
 * instead would protect nobody and would break every deployment whose API does not
 * enforce CSRF at all.
 *
 * See `docs/csrf.md` for the server's half of this, written out as HTTP.
 */

/**
 * The cookie the API sets so JavaScript can read the token, and the header the token is
 * echoed back in.
 *
 * Angular's own defaults, deliberately: `withXsrfConfiguration` in `app.config.ts` is
 * handed this same object, so {@link HttpXsrfTokenExtractor} reads the cookie this names
 * and {@link csrfInterceptor} writes the header this names. Keeping Angular's defaults
 * also means an API already speaking to an Angular front end needs no configuration.
 *
 * A plain constant rather than an `InjectionToken`, which is the opposite of what the
 * rest of this directory does and is the point: `withXsrfConfiguration` takes a static
 * value at bootstrap, so a token that providers could override would be a second source
 * of truth that the extractor could not see. Two names that can disagree is a worse
 * failure than one name that cannot be overridden — it attaches a header the server does
 * not read, which looks exactly like protection. An application talking to an API that
 * spells these differently changes them here, in one place, and the gate holds the rest
 * of the repository to it.
 */
export const CSRF_CONTRACT = {
  cookieName: 'XSRF-TOKEN',
  headerName: 'X-XSRF-TOKEN',
} as const;

/**
 * Where a browser with no token yet goes to get one, relative to `environment.apiUrl`.
 *
 * It has to exist, and that is a consequence of the double-submit pattern rather than a
 * choice: the token is a cookie the API sets, so a browser that has never had a response
 * from the API has no token to echo — and the very first request this application makes
 * on a cold visit to `/login` is `POST /auth/login`, a mutation. Without a bootstrap that
 * request carries no header and a correctly configured API rejects it, which is a sign-in
 * page that cannot sign anyone in.
 *
 * Outside the `/auth` path on purpose. The refresh cookie is scoped `Path=/api/v1/auth`
 * (see `docs/token-storage.md`), so a bootstrap at `/auth/csrf` would have the browser
 * attach a thirty-day credential to a request that needs no credential at all. `/csrf`
 * is reached with `withCredentials: true` — it has to be, or the `Set-Cookie` it answers
 * with is dropped — and that flag is exactly why the path it sits on is worth choosing.
 */
export const CSRF_BOOTSTRAP_PATH = '/csrf';

/**
 * The methods that need no token, as RFC 9110 defines "safe".
 *
 * Wider than Angular's built-in interceptor, which exempts `GET` and `HEAD` only, and
 * the server contract exempts the same four — that agreement is the reason to write the
 * set down rather than test `method !== 'GET'` in two places. A safe method must not
 * change state, so a token on one proves nothing; and `OPTIONS` in particular must be
 * exempt because an explicit `http.options(…)` probe would otherwise be rejected by a
 * server enforcing the rule on everything that is not a `GET`.
 *
 * A CORS *preflight* `OPTIONS` never reaches this list: the browser generates it, and it
 * does not pass through `HttpClient` at all. It is still the reason `docs/csrf.md`
 * requires `X-XSRF-TOKEN` in the API's `Access-Control-Allow-Headers` — a custom header
 * on a cross-origin request is only sent if the preflight permits it, and an API that
 * forgets it fails every mutation with a CORS error rather than a 403.
 */
export const CSRF_SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS', 'TRACE'];

/**
 * Whether `method` is one a token would add nothing to.
 *
 * Case-insensitive, because `HttpClient.request('post', …)` passes the caller's spelling
 * straight through — a request made that way is a mutation that this would otherwise wave
 * past, and the bug is silent in the direction that matters.
 */
export function isCsrfSafeMethod(method: string): boolean {
  return CSRF_SAFE_METHODS.includes(method.toUpperCase());
}
