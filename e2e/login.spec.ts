import { test, expect } from '@playwright/test';
import {
  mockLoginSuccess,
  mockLoginFailure,
  mockProfileSuccess,
  MOCK_TOKENS,
  SESSION_HINT_COOKIE,
} from './helpers/api-mocks';

test.describe('Login flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders login page with correct heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    await mockLoginSuccess(page);
    await mockProfileSuccess(page);

    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/dashboard');
  });

  /**
   * The inverse of the assertion this replaced, which read both tokens back out of
   * `localStorage`. A successful sign-in must now leave *nothing* a later script can
   * read: the access token is in memory and the refresh token is in a cookie the
   * document is not shown. See `docs/token-storage.md` and `e2e/token-storage.spec.ts`,
   * which covers the cookie attributes and the reload that rebuilds the session.
   */
  test('successful login persists no token the page can read', async ({ page }) => {
    await mockLoginSuccess(page);
    await mockProfileSuccess(page);

    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/dashboard');

    const persisted = await page.evaluate(() => ({
      local: Object.entries({ ...localStorage }),
      session: Object.entries({ ...sessionStorage }),
      cookies: document.cookie,
    }));

    const serialised = JSON.stringify(persisted);
    expect(serialised).not.toContain(MOCK_TOKENS.accessToken);
    expect(serialised).not.toContain(MOCK_TOKENS.refreshToken);

    // The one session cookie the document *is* allowed to see carries no credential.
    expect(persisted.cookies).toContain(SESSION_HINT_COOKIE);
    expect(persisted.cookies).not.toContain('refresh_token');
  });

  test('failed login displays error message', async ({ page }) => {
    await mockLoginFailure(page, 'Invalid credentials');

    await page.getByLabel('Email address').fill('wrong@example.com');
    await page.getByLabel('Password').fill('WrongPass1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText('Invalid credentials');
    await expect(page).toHaveURL('/login');
  });

  test('shows loading state during login request', async ({ page }) => {
    // Initialised rather than asserted non-null at the call site: the compiler cannot
    // see that `Promise`'s executor runs synchronously, and `resolveRequest!()` is a
    // claim the lint rules refuse on principle — rightly, since the next person to move
    // the assignment into a callback would keep the assertion and lose the error.
    let resolveRequest: () => void = () => undefined;
    const requestHeld = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });

    await page.route('**/auth/login', async (route) => {
      await requestHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: '1', email: 'test@example.com', name: 'Test', role: 'user' },
          accessToken: 'tok',
        }),
      });
    });

    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    resolveRequest();
  });

  test('link to register page is present and navigates', async ({ page }) => {
    await page.getByRole('link', { name: 'Create one' }).click();
    await expect(page).toHaveURL('/register');
  });
});
