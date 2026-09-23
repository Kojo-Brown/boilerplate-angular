import type { Page } from '@playwright/test';

const API_BASE = 'http://localhost:3000/api/v1';

export const MOCK_USER = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user' as const,
};

export const MOCK_TOKENS = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
};

export const MOCK_AUTH_RESPONSE = {
  user: MOCK_USER,
  ...MOCK_TOKENS,
};

export async function mockLoginSuccess(page: Page): Promise<void> {
  await page.route(`${API_BASE}/auth/login`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AUTH_RESPONSE),
    });
  });
}

export async function mockLoginFailure(page: Page, message = 'Invalid credentials'): Promise<void> {
  await page.route(`${API_BASE}/auth/login`, (route) => {
    void route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message }),
    });
  });
}

export async function mockRegisterSuccess(page: Page): Promise<void> {
  await page.route(`${API_BASE}/auth/register`, (route) => {
    void route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AUTH_RESPONSE),
    });
  });
}

export async function mockRegisterFailure(
  page: Page,
  message = 'Email already in use'
): Promise<void> {
  await page.route(`${API_BASE}/auth/register`, (route) => {
    void route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message }),
    });
  });
}

/**
 * Answers the invite check, and reports how many times it was asked.
 *
 * The count is the assertion that matters for a debounced validator: a passing
 * "the message appeared" test says nothing about whether it cost one request or ten.
 *
 * @param problem The verdict for every pair. `null` accepts.
 */
export async function mockInviteCheck(
  page: Page,
  problem: string | null = null
): Promise<{ readonly calls: () => number }> {
  let calls = 0;

  // Playwright matches the most recently registered handler first, so calling this a
  // second time in one test overrides the first without needing `unroute` — and the
  // first handler's count stays frozen at whatever it had served.
  await page.route(`${API_BASE}/auth/invites/check`, (route) => {
    calls += 1;
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ problem }),
    });
  });

  return { calls: () => calls };
}

export async function mockProfileSuccess(page: Page): Promise<void> {
  await page.route(`${API_BASE}/auth/me`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    });
  });
}

export async function seedAuthSession(page: Page): Promise<void> {
  await page.evaluate(({ accessToken, refreshToken }) => {
    localStorage.setItem('auth_access_token', accessToken);
    localStorage.setItem('auth_refresh_token', refreshToken);
  }, MOCK_TOKENS);
}

export async function clearAuthSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('auth_access_token');
    localStorage.removeItem('auth_refresh_token');
  });
}
