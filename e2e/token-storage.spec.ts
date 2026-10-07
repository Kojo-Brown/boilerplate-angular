import { test, expect } from '@playwright/test';
import {
  MOCK_TOKENS,
  SESSION_HINT_COOKIE,
  mockLoginSuccess,
  mockLogoutSuccess,
  mockProfileSuccess,
  mockRefreshRejected,
  mockRefreshSuccess,
  seedAuthSession,
} from './helpers/api-mocks';

/**
 * The half of the token-storage design that only a browser can be asked about.
 *
 * Every claim in `docs/token-storage.md` is either about this application's code — and
 * then a unit spec or `scripts/ci/assert-no-token-persistence.mjs` covers it — or about
 * what the *browser* does with the headers the API sends. `HttpOnly` is the second kind:
 * nothing in Angular enforces it, no spec with a `TestBed` can observe it, and a mock
 * that merely records a string called "refresh token" proves nothing at all. So these
 * cases drive a real Chromium against real `Set-Cookie` headers and ask the page what it
 * can see.
 *
 * `Secure` is the one attribute not asserted here, and for a reason rather than an
 * oversight: these tests run over plain HTTP against `ng serve`, where a browser drops a
 * `Secure` cookie outright, so including it would make every case fail for a reason
 * unrelated to what it checks. Production must set it — the contract document says so,
 * and `SameSite=Strict` is what is checked in its place.
 */
test.describe('Token storage', () => {
  test('the refresh cookie is httpOnly and the hint beside it is not', async ({ page }) => {
    await page.goto('/login');
    await mockLoginSuccess(page);
    await mockProfileSuccess(page);

    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard');

    const cookies = await page.context().cookies();
    const refresh = cookies.find((cookie) => cookie.name === 'refresh_token');
    const hint = cookies.find((cookie) => cookie.name === SESSION_HINT_COOKIE);

    expect(refresh, 'the API set a refresh cookie').toBeDefined();
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.sameSite).toBe('Strict');

    expect(hint, 'the API set a readable hint beside it').toBeDefined();
    expect(hint?.httpOnly).toBe(false);

    // The attribute, from the only perspective that matters: the document's. The jar
    // holds the refresh token and `document.cookie` does not admit to it.
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('refresh_token');
    expect(visible).not.toContain(MOCK_TOKENS.refreshToken);
    expect(visible).toContain(SESSION_HINT_COOKIE);
  });

  /**
   * What the access token being in memory actually means, demonstrated rather than
   * asserted about a variable: a reload loses it, and the page has to go and get
   * another one.
   */
  test('a reload has no access token and rebuilds the session from the cookie', async ({
    page,
  }) => {
    await page.goto('/login');
    await mockProfileSuccess(page);
    await seedAuthSession(page);
    const refresh = await mockRefreshSuccess(page, 'rotated-access-token');

    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard');

    expect(refresh.calls(), 'the session came back through /auth/refresh').toBe(1);

    const persisted = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })
    );
    expect(persisted).not.toContain('rotated-access-token');
  });

  /**
   * The cost the session hint exists to avoid. An anonymous visitor must not spend a
   * credentialed round trip being told 401 — so the absence of the hint has to be what
   * stops the attempt, not the response.
   */
  test('an anonymous page load makes no refresh request', async ({ page }) => {
    const refresh = await mockRefreshSuccess(page);

    await page.goto('/');
    await expect(page.getByRole('heading').first()).toBeVisible();

    expect(refresh.calls()).toBe(0);
  });

  /**
   * And the hint being only a hint. A cookie the client can read is one the client can
   * be wrong about: revoked, expired, or rotated away. The restore has to settle and
   * redirect rather than hang, and it must not retry on the next load.
   */
  test('a hint whose refresh cookie is dead signs the visitor out', async ({ page }) => {
    await page.goto('/login');
    await seedAuthSession(page);
    await mockRefreshRejected(page);

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login/);
  });

  /**
   * The request is the point: an `HttpOnly` cookie can only be expired by a `Set-Cookie`
   * on a response, so a sign-out that only drops client-side state is not one — the jar
   * keeps a live refresh token and the next load restores the session.
   */
  test('signing out revokes the session server-side and the cookies go', async ({ page }) => {
    await page.goto('/login');
    await mockProfileSuccess(page);
    await seedAuthSession(page);
    const logout = await mockLogoutSuccess(page);

    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect.poll(() => logout.calls()).toBe(1);

    // The server's expiry headers took both cookies out of the jar, so there is nothing
    // left for a later load to restore from.
    await expect
      .poll(async () => (await page.context().cookies()).map((cookie) => cookie.name))
      .not.toContain('refresh_token');
    expect((await page.context().cookies()).map((cookie) => cookie.name)).not.toContain(
      SESSION_HINT_COOKIE
    );
  });
});
