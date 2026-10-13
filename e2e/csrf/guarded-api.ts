import type { Page, Route } from '@playwright/test';
import { CSRF_BOOTSTRAP_PATH, CSRF_CONTRACT } from '@/app/core/http/csrf';
import {
  API_BASE,
  MOCK_AUTH_RESPONSE,
  MOCK_CSRF_TOKEN,
  MOCK_TOKENS,
  MOCK_USER,
  SESSION_HINT_COOKIE,
} from '../helpers/api-mocks';
import { CSRF_REJECTION_STATUS, verifyCsrf } from '../helpers/csrf-contract';

/** One request as the API saw it, after the contract had its say. */
export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  /** The CSRF header's value, or `null` where the request carried none. */
  readonly token: string | null;
  /** The CSRF cookie the browser attached, or `null` where it attached none. */
  readonly cookie: string | null;
  /** Why the contract refused it, where it did. */
  readonly rejectedBecause: string | null;
}

export interface GuardedApi {
  /** Every API request this page made, in order. */
  requests(): readonly SeenRequest[];
  /** Just the ones the contract refused. */
  rejections(): readonly SeenRequest[];
  /** How many times `GET /csrf` was asked for a token. */
  bootstrapCalls(): number;
}

/**
 * The API's origin, as the browser sends it. Needed verbatim, because a credentialed
 * request may not be answered with `Access-Control-Allow-Origin: *`.
 */
const APP_ORIGIN = 'http://localhost:4200';

/**
 * CORS headers on every response, as `docs/csrf.md` requires them.
 *
 * Written out rather than left to Playwright, which answers a preflight permissively on
 * a fulfilled route. That default is convenient and it is also exactly the thing this
 * suite must not depend on: a custom header makes every mutation non-simple, so an API
 * whose `Access-Control-Allow-Headers` omits `X-XSRF-TOKEN` fails every write *in the
 * browser*, as a CORS error with nothing in the server's logs. Sending the real headers
 * means the suite exercises the configuration the document asks for.
 */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': APP_ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': `Authorization, Content-Type, ${CSRF_CONTRACT.headerName}`,
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-max-age': '600',
};

const SESSION_COOKIES = [
  `refresh_token=${MOCK_TOKENS.refreshToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
  `${SESSION_HINT_COOKIE}=1; SameSite=Strict; Path=/; Max-Age=2592000`,
  `${CSRF_CONTRACT.cookieName}=${MOCK_CSRF_TOKEN}; SameSite=Strict; Path=/; Max-Age=2592000`,
];

const CLEARED_SESSION_COOKIES = [
  'refresh_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
  `${SESSION_HINT_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0`,
  `${CSRF_CONTRACT.cookieName}=; SameSite=Strict; Path=/; Max-Age=0`,
];

/** Playwright takes one value per header name, and `Set-Cookie` is the one that repeats. */
function withCookies(cookies: readonly string[]): Record<string, string> {
  return { ...CORS_HEADERS, 'set-cookie': cookies.join('\n') };
}

/**
 * Mounts an API that enforces `docs/csrf.md` on every request, and records what it saw.
 *
 * One route for the whole API rather than a handler per endpoint, because the contract is
 * a property of *every* mutating request: a per-endpoint mock is a per-endpoint
 * exemption list, which is the shape the document refuses on the server side for the same
 * reason. Any request that fails {@link verifyCsrf} is answered `403` before the endpoint
 * is reached, exactly as a correctly configured API would — so this suite fails if the
 * application stops satisfying the contract, which a recording mock never could.
 */
export async function installGuardedApi(page: Page): Promise<GuardedApi> {
  const seen: SeenRequest[] = [];
  let bootstrapCalls = 0;

  await page.route(`${API_BASE}/**`, async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    const path = pathname.replace('/api/v1', '');

    // A CORS preflight is the browser's, not the application's: it carries no cookies and
    // no custom headers by design, so it is answered and not recorded.
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
      return;
    }

    const headers = await request.allHeaders();
    const verdict = verifyCsrf(method, headers);

    seen.push({
      method,
      path,
      token: headers[CSRF_CONTRACT.headerName.toLowerCase()] ?? null,
      cookie: readRequestCookie(headers['cookie'] ?? '', CSRF_CONTRACT.cookieName),
      rejectedBecause: verdict.ok ? null : verdict.reason,
    });

    if (!verdict.ok) {
      await route.fulfill({
        status: CSRF_REJECTION_STATUS,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: 'CSRF validation failed', detail: verdict.reason }),
      });
      return;
    }

    if (method === 'GET' && path === CSRF_BOOTSTRAP_PATH) {
      bootstrapCalls += 1;
      await route.fulfill({
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'set-cookie': `${CSRF_CONTRACT.cookieName}=${MOCK_CSRF_TOKEN}; SameSite=Strict; Path=/; Max-Age=2592000`,
          'cache-control': 'no-store',
        },
        body: '',
      });
      return;
    }

    if (method === 'POST' && path === '/auth/login') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: withCookies(SESSION_COOKIES),
        body: JSON.stringify(MOCK_AUTH_RESPONSE),
      });
      return;
    }

    if (method === 'POST' && path === '/auth/refresh') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: withCookies(SESSION_COOKIES),
        body: JSON.stringify({ accessToken: MOCK_TOKENS.accessToken }),
      });
      return;
    }

    if (method === 'POST' && path === '/auth/logout') {
      await route.fulfill({
        status: 204,
        headers: withCookies(CLEARED_SESSION_COOKIES),
        body: '',
      });
      return;
    }

    if (method === 'GET' && path === '/auth/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify(MOCK_USER),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: `No mock for ${method} ${path}` }),
    });
  });

  return {
    requests: () => [...seen],
    rejections: () => seen.filter((request) => request.rejectedBecause !== null),
    bootstrapCalls: () => bootstrapCalls,
  };
}

function readRequestCookie(cookieHeader: string, name: string): string | null {
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim();
  }
  return null;
}
