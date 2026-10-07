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
  /**
   * Never part of a response body, and never readable by the application — it exists
   * here only so a mock can put it in a `Set-Cookie` the way the real API does.
   */
  refreshToken: 'mock-refresh-token',
};

export const MOCK_AUTH_RESPONSE = {
  user: MOCK_USER,
  accessToken: MOCK_TOKENS.accessToken,
};

/** The cookie whose presence tells a cold page load that a refresh is worth trying. */
export const SESSION_HINT_COOKIE = 'session_hint';

/**
 * The two `Set-Cookie` headers the API sends beside a sign-in response.
 *
 * `HttpOnly` on the refresh token and not on the hint is the whole contract — see
 * `docs/token-storage.md`. `Secure` is omitted because these mocks run over plain HTTP
 * against `ng serve`, and a `Secure` cookie on an insecure origin is simply dropped;
 * production sets it, which `e2e/token-storage.spec.ts` notes where it asserts the rest.
 */
const SESSION_COOKIES = [
  `refresh_token=${MOCK_TOKENS.refreshToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
  `${SESSION_HINT_COOKIE}=1; SameSite=Strict; Path=/; Max-Age=2592000`,
];

/** The headers that expire both, as `POST /auth/logout` answers. */
const CLEARED_SESSION_COOKIES = [
  'refresh_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
  `${SESSION_HINT_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0`,
];

/**
 * Playwright's `fulfill` takes one value per header name, and `Set-Cookie` is the header
 * that legitimately repeats. Joining on a newline is how it emits two of them.
 */
function withSessionCookies(headers: readonly string[]): Record<string, string> {
  return { 'set-cookie': headers.join('\n') };
}

export async function mockLoginSuccess(page: Page): Promise<void> {
  await page.route(`${API_BASE}/auth/login`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: withSessionCookies(SESSION_COOKIES),
      body: JSON.stringify(MOCK_AUTH_RESPONSE),
    });
  });
}

/**
 * Answers `POST /auth/refresh` with a rotated access token, and reports how many times
 * it was asked.
 *
 * The count is what distinguishes the session-hint design from "always try": an
 * anonymous page load must not reach this at all.
 */
export async function mockRefreshSuccess(
  page: Page,
  accessToken = MOCK_TOKENS.accessToken
): Promise<{ readonly calls: () => number }> {
  let calls = 0;

  await page.route(`${API_BASE}/auth/refresh`, (route) => {
    calls += 1;
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: withSessionCookies(SESSION_COOKIES),
      body: JSON.stringify({ accessToken }),
    });
  });

  return { calls: () => calls };
}

/** A refresh cookie the server refuses: expired, revoked, or already rotated away. */
export async function mockRefreshRejected(page: Page): Promise<void> {
  await page.route(`${API_BASE}/auth/refresh`, (route) => {
    void route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: withSessionCookies(CLEARED_SESSION_COOKIES),
      body: JSON.stringify({ message: 'Refresh token expired' }),
    });
  });
}

/** `POST /auth/logout`, which is the only thing that can expire the `HttpOnly` cookie. */
export async function mockLogoutSuccess(page: Page): Promise<{ readonly calls: () => number }> {
  let calls = 0;

  await page.route(`${API_BASE}/auth/logout`, (route) => {
    calls += 1;
    void route.fulfill({
      status: 204,
      headers: withSessionCookies(CLEARED_SESSION_COOKIES),
      body: '',
    });
  });

  return { calls: () => calls };
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
      headers: withSessionCookies(SESSION_COOKIES),
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

/**
 * Three posts, fixed. The dates and ids are literals rather than generated so a failure
 * screenshot and a failure message name the same row.
 */
export const MOCK_POSTS = [1, 2, 3].map((n) => ({
  id: `post-${n}`,
  title: `Sample post ${n}`,
  body: `Body copy for sample post ${n}. `.repeat(6).trim(),
  authorId: MOCK_USER.id,
  createdAt: `2026-01-0${n}T09:00:00.000Z`,
  updatedAt: `2026-01-0${n}T09:00:00.000Z`,
}));

/**
 * Serves the posts list and every post detail from {@link MOCK_POSTS}.
 *
 * Two globs, and both halves of each matter. `/posts*` rather than `/posts?*`: the
 * dashboard's insights panel calls `injectPostsQuery()` with no parameters, so its URL
 * carries no query string at all and a pattern anchored on `?` misses it — which reads,
 * on screen, as the panel's error branch rather than as a missing mock. A Playwright glob
 * `*` does not cross `/`, so `/posts*` still leaves `/posts/post-1` to the second route.
 *
 * Order matters too: Playwright matches the most recently registered handler first, so
 * the detail route is registered after the collection and wins for `/posts/post-1`.
 * Registering them the other way round gives every detail page a paginated envelope and
 * a blank article.
 */
export async function mockPosts(page: Page): Promise<void> {
  await page.route(`${API_BASE}/posts*`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: MOCK_POSTS,
        total: MOCK_POSTS.length,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }),
    });
  });

  await page.route(`${API_BASE}/posts/*`, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const post = MOCK_POSTS.find((p) => p.id === id);
    void route.fulfill({
      status: post ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(post ?? { message: 'Not found' }),
    });
  });
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

/**
 * Put the browser in the state a signed-in visitor reloads in.
 *
 * Which is now a cookie jar and nothing else: there is no access token to seed, because
 * a page load has none and rebuilds the session from the refresh cookie. So this adds
 * both cookies the API would have set — `refresh_token` as `httpOnly`, so the page
 * genuinely cannot read it, and the readable hint — and mocks the refresh endpoint the
 * next load will call. The caller still needs `mockProfileSuccess` for the second half.
 *
 * `addCookies` rather than `page.evaluate`: `httpOnly` is not something a document can
 * set on itself, which is the property under test.
 */
export async function seedAuthSession(page: Page): Promise<void> {
  const url = new URL(page.url());

  await page.context().addCookies([
    {
      name: 'refresh_token',
      value: MOCK_TOKENS.refreshToken,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
    {
      name: SESSION_HINT_COOKIE,
      value: '1',
      domain: url.hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Strict',
    },
  ]);

  await mockRefreshSuccess(page);
}

/**
 * Sign out at the browser level, as a `Set-Cookie` from `/auth/logout` would.
 *
 * Clearing the whole jar rather than two names keeps it honest: a helper that removed
 * only the hint would leave a live refresh cookie behind and quietly test a different
 * thing than it claims.
 */
export async function clearAuthSession(page: Page): Promise<void> {
  await page.context().clearCookies();
}
