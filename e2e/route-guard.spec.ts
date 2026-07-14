import { test, expect } from '@playwright/test';
import { mockProfileSuccess, seedAuthSession, clearAuthSession } from './helpers/api-mocks';

test.describe('Route guard', () => {
  test('unauthenticated user is redirected from /dashboard to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fdashboard/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('unauthenticated user is redirected from /admin to /login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fadmin/);
  });

  test('authenticated user can access /dashboard', async ({ page }) => {
    await mockProfileSuccess(page);
    await page.goto('/login');
    await seedAuthSession(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard');
  });

  test('authenticated user accessing /login is redirected to /dashboard', async ({ page }) => {
    await mockProfileSuccess(page);
    await page.goto('/login');
    await seedAuthSession(page);

    await page.goto('/login');
    await expect(page).toHaveURL('/dashboard');
  });

  test('returnUrl parameter is respected after successful login', async ({ page }) => {
    await page.route('**/auth/login', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: '1', email: 'test@example.com', name: 'Test', role: 'user' },
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        }),
      });
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fdashboard/);

    await page.getByLabel('Email address').fill('test@example.com');
    await page.getByLabel('Password').fill('Password1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/dashboard');
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    await mockProfileSuccess(page);
    await page.goto('/login');
    await seedAuthSession(page);

    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard');

    await clearAuthSession(page);
    await page.reload();

    await expect(page).toHaveURL(/\/login/);
  });

  test('non-admin user accessing /admin is redirected to /unauthorized', async ({ page }) => {
    await page.route('**/auth/me', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '1',
          email: 'user@example.com',
          name: 'User',
          role: 'user',
        }),
      });
    });

    await page.goto('/login');
    await seedAuthSession(page);

    await page.goto('/admin');
    await expect(page).toHaveURL('/unauthorized');
  });
});
