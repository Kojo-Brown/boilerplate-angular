import { expect, test } from '@playwright/test';
import { CSRF_BOOTSTRAP_PATH, CSRF_CONTRACT } from '@/app/core/http/csrf';
import { API_BASE, MOCK_CSRF_TOKEN, SESSION_HINT_COOKIE } from '../helpers/api-mocks';
import { verifyCsrf } from '../helpers/csrf-contract';
import { installGuardedApi } from './guarded-api';

/**
 * The CSRF contract, adjudicated.
 *
 * Every API request these cases make goes through `e2e/helpers/csrf-contract.ts` — the
 * rules in `docs/csrf.md`, implemented — and anything that fails them is answered `403`
 * before it reaches an endpoint. So these are not assertions about headers a mock
 * recorded: the application has to satisfy a real implementation of the server's half to
 * get through at all, and a regression that stopped sending the token would fail the
 * *user-visible* outcome rather than a header expectation.
 *
 * Two things only a browser can be asked, which is why this suite exists alongside
 * `csrf.interceptor.spec.ts`:
 *
 *   - whether the cookie the token came from is actually *attached* to the request. That
 *     is `withCredentials` plus the browser's own cookie rules — `SameSite`, `Path`,
 *     `Domain`, the port-insensitivity that makes the checked-in two-origin setup work —
 *     and nothing in a `TestBed` can observe any of it. A `HttpTestingController` spec
 *     can prove the flag was set; only this can prove it had the intended effect.
 *   - whether the protection actually refuses the request an attacker can cause.
 *
 * `Secure` is the one attribute not exercised, for the reason `e2e/token-storage.spec.ts`
 * gives about the same thing: these run over plain HTTP against `ng serve`, where a
 * browser drops a `Secure` cookie outright. Production must set it; `docs/csrf.md` says
 * so.
 */
test.describe('CSRF protection', () => {
  test('a cold sign-in fetches one token and the login POST carries it', async ({ page }) => {
    const api = await installGuardedApi(page);

    await page.goto('/login');
    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The outcome, not a header: a login that failed the contract would have been
    // answered 403 and left the user on `/login`.
    await expect(page).toHaveURL('/dashboard');

    // One bootstrap for the browser, not one per mutation.
    expect(api.bootstrapCalls()).toBe(1);
    expect(api.rejections()).toEqual([]);

    const login = api.requests().find((request) => request.path === '/auth/login');
    expect(login?.token).toBe(MOCK_CSRF_TOKEN);
    // The half a TestBed cannot see: the browser attached the cookie, so the server had
    // two sides to compare.
    expect(login?.cookie).toBe(MOCK_CSRF_TOKEN);
  });

  test('the bootstrap precedes the mutation that needed it', async ({ page }) => {
    const api = await installGuardedApi(page);

    await page.goto('/login');
    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard');

    const paths = api.requests().map((request) => request.path);
    expect(paths.indexOf(CSRF_BOOTSTRAP_PATH)).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf(CSRF_BOOTSTRAP_PATH)).toBeLessThan(paths.indexOf('/auth/login'));
  });

  /**
   * The attack, as far as a single-origin test harness can stage it.
   *
   * What an attacker controls is a page the user visits, from which they can cause a
   * request to this API that **carries the cookie** — the browser attaches it to any
   * request to the host — and that **cannot carry the header**, because no cross-site
   * page can set one on a request to another origin. A form post, an image, a
   * `no-cors` fetch: all three have exactly that shape.
   *
   * So that shape is what is issued here: `credentials: 'include'`, no CSRF header, and a
   * `text/plain` body so the request stays "simple" and is not preflighted — which is
   * precisely how a cross-site form post reaches a server despite CORS. It is issued from
   * the application's own origin, and that is the limit of the simulation and worth being
   * exact about: it reproduces the attacker's *capability*, not their origin. A request
   * from a genuinely foreign origin would be refused by CORS before the API answered,
   * which would demonstrate the CORS policy rather than this one — and CORS is not the
   * defence being tested, because the request above is sent whether CORS allows the
   * *response* to be read or not.
   */
  test('a request carrying the cookie but no header is refused', async ({ page }) => {
    const api = await installGuardedApi(page);

    await page.goto('/login');
    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard');

    const status = await page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      });
      return response.status;
    }, `${API_BASE}/auth/logout`);

    expect(status).toBe(403);

    const forged = api.rejections().at(-1);
    expect(forged?.method).toBe('POST');
    expect(forged?.path).toBe('/auth/logout');
    // The cookie was attached and the header was not: the signature the rule exists for.
    expect(forged?.cookie).toBe(MOCK_CSRF_TOKEN);
    expect(forged?.token).toBeNull();
    expect(forged?.rejectedBecause).toContain('no X-XSRF-TOKEN header');

    // And the session is intact — the forged sign-out did not take effect.
    await page.reload();
    await expect(page).toHaveURL('/dashboard');
  });

  /** A token that does not match the cookie is no better than none. */
  test('a mismatched header is refused', async ({ page }) => {
    const api = await installGuardedApi(page);

    await page.goto('/login');
    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard');

    const status = await page.evaluate(
      async ({ url, header }) => {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', [header]: 'guessed-token' },
          body: '{}',
        });
        return response.status;
      },
      { url: `${API_BASE}/auth/logout`, header: CSRF_CONTRACT.headerName }
    );

    expect(status).toBe(403);
    expect(api.rejections().at(-1)?.rejectedBecause).toContain('does not match the cookie');
  });

  /**
   * The session restore is a `POST` authorised by a cookie — the endpoint this whole item
   * is for. A returning visitor holds the token already, because the API set it beside
   * the hint, so the restore costs one round trip and no bootstrap.
   */
  test('a reloaded session refreshes with a token and no bootstrap', async ({ page }) => {
    const api = await installGuardedApi(page);

    await page.goto('/login');
    await page.context().addCookies(
      [
        { name: 'refresh_token', value: 'mock-refresh-token', httpOnly: true },
        { name: SESSION_HINT_COOKIE, value: '1' },
        { name: CSRF_CONTRACT.cookieName, value: MOCK_CSRF_TOKEN },
      ].map((cookie) => ({
        ...cookie,
        domain: new URL(page.url()).hostname,
        path: '/',
        sameSite: 'Strict' as const,
      }))
    );

    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard');

    const refresh = api.requests().find((request) => request.path === '/auth/refresh');
    expect(refresh?.token).toBe(MOCK_CSRF_TOKEN);
    expect(api.bootstrapCalls()).toBe(0);
    expect(api.rejections()).toEqual([]);
  });

  /** Signing out expires the token with the session it belonged to. */
  test('signing out clears the CSRF cookie', async ({ page }) => {
    const api = await installGuardedApi(page);

    await page.goto('/login');
    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard');

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect
      .poll(async () => (await page.context().cookies()).map((cookie) => cookie.name))
      .not.toContain(CSRF_CONTRACT.cookieName);

    // The sign-out itself was a cookie-authorised mutation, so it had to satisfy the
    // contract to be honoured at all.
    const logout = api.requests().find((request) => request.path === '/auth/logout');
    expect(logout?.token).toBe(MOCK_CSRF_TOKEN);
    expect(api.rejections()).toEqual([]);
  });

  /** Reads are exempt on both sides, from the same constant. */
  test('safe requests carry no token', async ({ page }) => {
    const api = await installGuardedApi(page);

    await page.goto('/login');
    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard');

    const reads = api.requests().filter((request) => request.method === 'GET');
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.token, `GET ${read.path}`).toBeNull();
    }
  });
});

/**
 * The adjudicator itself, checked against the cases it exists to decide.
 *
 * The suite above is only as good as this function, and a verifier that returned `{ ok:
 * true }` unconditionally would make every case above pass while proving nothing at all —
 * the same failure the `--self-test` rules in `scripts/ci/` are written against. So each
 * verdict is asserted directly, including the two that no amount of driving a browser can
 * produce.
 */
test.describe('the contract verifier', () => {
  const token = 'a-token';
  const matching = { cookie: `${CSRF_CONTRACT.cookieName}=${token}` };
  const header = CSRF_CONTRACT.headerName.toLowerCase();

  test('accepts a matching pair', () => {
    expect(verifyCsrf('POST', { ...matching, [header]: token }).ok).toBe(true);
  });

  test('accepts a safe method with nothing at all', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'TRACE', 'get']) {
      expect(verifyCsrf(method, {}).ok, method).toBe(true);
    }
  });

  test('refuses a mutation with the cookie and no header', () => {
    expect(verifyCsrf('POST', matching).ok).toBe(false);
  });

  test('refuses a mutation with a header and no cookie', () => {
    expect(verifyCsrf('POST', { [header]: token }).ok).toBe(false);
  });

  test('refuses a mismatched pair', () => {
    expect(verifyCsrf('POST', { ...matching, [header]: 'other' }).ok).toBe(false);
  });

  test('refuses a mutation carrying neither', () => {
    expect(verifyCsrf('DELETE', {}).ok).toBe(false);
  });

  /** A prefix must not pass: `abc` is not `abcdef`, in either direction. */
  test('refuses a token that is a prefix of the cookie, and the reverse', () => {
    expect(verifyCsrf('POST', { ...matching, [header]: token.slice(0, 3) }).ok).toBe(false);
    expect(
      verifyCsrf('POST', {
        cookie: `${CSRF_CONTRACT.cookieName}=${token.slice(0, 3)}`,
        [header]: token,
      }).ok
    ).toBe(false);
  });

  /** Another cookie whose name merely contains the token's must not be read as it. */
  test('reads the cookie by its exact name', () => {
    expect(
      verifyCsrf('POST', {
        cookie: `NOT-${CSRF_CONTRACT.cookieName}=${token}; other=1`,
        [header]: token,
      }).ok
    ).toBe(false);
  });

  /** A lower-case method is a mutation too; the client treats it as one. */
  test('refuses an unprotected lower-case mutation', () => {
    expect(verifyCsrf('post', {}).ok).toBe(false);
  });
});
