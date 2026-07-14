import { test, expect } from '@playwright/test';
import {
  mockLoginSuccess,
  mockLoginFailure,
  mockProfileSuccess,
  MOCK_TOKENS,
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

  test('successful login stores tokens in localStorage', async ({ page }) => {
    await mockLoginSuccess(page);
    await mockProfileSuccess(page);

    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/dashboard');

    const accessToken = await page.evaluate(() =>
      localStorage.getItem('auth_access_token')
    );
    const refreshToken = await page.evaluate(() =>
      localStorage.getItem('auth_refresh_token')
    );

    expect(accessToken).toBe(MOCK_TOKENS.accessToken);
    expect(refreshToken).toBe(MOCK_TOKENS.refreshToken);
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
    let resolveRequest: () => void;
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
          refreshToken: 'ref',
        }),
      });
    });

    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    resolveRequest!();
  });

  test('link to register page is present and navigates', async ({ page }) => {
    await page.getByRole('link', { name: 'Create one' }).click();
    await expect(page).toHaveURL('/register');
  });
});
