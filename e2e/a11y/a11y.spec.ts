import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import type { Theme } from '@/app/core/theme/theme-storage-key';
import {
  MOCK_POSTS,
  mockLoginSuccess,
  mockPosts,
  mockProfileSuccess,
  seedAuthSession,
} from '../helpers/api-mocks';
import { useTheme } from '../helpers/theme';
import { expectNoViolations } from './axe';

/**
 * The WCAG 2.2 AA audit, run against the application in a real browser.
 *
 * Why here and not in the unit suite: more than half of what axe checks is a property of
 * the *page*, not of a component. Contrast needs the cascade — a token defined on
 * `:root`, a Tailwind utility, and the element's actual painted background, none of which
 * a `TestBed` fixture has. Landmarks and heading level are questions about the document,
 * and the components that answer them (`LayoutShellComponent`, `AppComponent`'s toast
 * container) are assembled by the router, not by any one spec. `target-size` needs layout.
 *
 * Every route is audited in **both themes**, because the palette is two palettes and only
 * one of them was ever looked at. Three of the four contrast failures this gate found on
 * its first run existed only in dark mode, and one of them — near-white body text on a
 * white card — was there because Tailwind's `dark:` variant and the application's theme
 * class had never been connected (see `src/styles.css`).
 *
 * The audits below run against `ng serve`, i.e. the client-rendered, hydrated DOM. That
 * is the document a visitor interacts with, and it is the one that differs between
 * themes. It is *not* the prerendered HTML that `/login`, `/register` and `/unauthorized`
 * are served as before hydration; `scripts/ci/assert-ssr.mjs` is what reads that.
 * `docs/accessibility.md` records the gap.
 */

interface RouteCase {
  readonly path: string;
  readonly name: string;
  readonly authenticated: boolean;
}

const ROUTES: readonly RouteCase[] = [
  { path: '/login', name: 'login', authenticated: false },
  { path: '/register', name: 'register', authenticated: false },
  { path: '/unauthorized', name: 'unauthorized', authenticated: false },
  { path: '/dashboard', name: 'dashboard overview', authenticated: true },
  { path: '/dashboard/posts', name: 'posts list', authenticated: true },
  { path: `/dashboard/posts/${MOCK_POSTS[0].id}`, name: 'post detail', authenticated: true },
  { path: '/dashboard/activity', name: 'activity log', authenticated: true },
  { path: '/admin', name: 'admin', authenticated: true },
];

const THEMES: readonly Theme[] = ['light', 'dark'];

/** Mocks every backend call the audited routes make, then seeds a session. */
async function signIn(page: Page): Promise<void> {
  await mockLoginSuccess(page);
  await mockProfileSuccess(page);
  await mockPosts(page);
  await page.goto('/login');
  await seedAuthSession(page);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    for (const route of ROUTES) {
      test(`${route.name} (${route.path}) has no WCAG 2.2 AA violations`, async ({ page }) => {
        await useTheme(page, theme);
        if (route.authenticated) await signIn(page);
        else await mockPosts(page);

        await page.goto(route.path);
        await page.waitForLoadState('networkidle');

        await expectNoViolations(page, `${theme} ${route.path}`);
      });
    }
  });
}

/**
 * States a visitor reaches by doing something, which a route sweep never sees.
 *
 * Each of these puts markup on screen that does not exist in the route's initial render:
 * error text bound to a field, an off-canvas drawer, a listbox over a combobox, a panel
 * behind a `@defer` trigger. A rule like `aria-valid-attr-value` or `label` can only fail
 * on markup that exists, so auditing the resting state of eight routes says nothing about
 * any of them.
 */
test.describe('interaction states', () => {
  test('a login form showing validation errors', async ({ page }) => {
    await page.goto('/login');

    // Typing is what hydrates the deferred form (`@defer (hydrate on interaction)`), so
    // the invalid state cannot be reached without it.
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByLabel('Password').blur();
    await page.getByText('Please enter a valid email address').waitFor();

    await expectNoViolations(page, 'login with validation errors');
  });

  test('the mobile navigation drawer, open', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/dashboard');

    await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
    await page.getByRole('button', { name: 'Close navigation menu' }).waitFor();

    await expectNoViolations(page, 'dashboard with the mobile drawer open');
  });

  test('the post typeahead with results showing', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard/posts');
    await page.waitForLoadState('networkidle');

    const combobox = page.getByRole('combobox').first();
    await combobox.fill('Sample');
    await page.getByRole('option').first().waitFor();

    await expectNoViolations(page, 'posts list with the typeahead open');
  });

  test('the dashboard with its deferred panels resolved', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // The insights panel and the release-notes card are both behind `@defer`, and both
    // render markup the resting audit above never reaches — a definition list of author
    // tallies, an avatar per row, a dismissible card.
    //
    // Scrolling the content column is what a `@defer (on viewport)` block needs under a
    // production build. Under `ng serve` it is a no-op: the dev server enables HMR, HMR
    // forces every deferred dependency to load eagerly (NG0751), and the blocks are
    // already rendered by the time this runs. The scroll stays because it is what makes
    // the test correct against the artifact as well as against the dev server, and the
    // waits below are on the panels themselves rather than on a placeholder that only
    // one of those two modes ever shows.
    await page.locator('main').evaluate((el) => el.scrollTo(0, el.scrollHeight));

    await page.getByRole('heading', { name: 'Publishing activity' }).waitFor();
    // 4s timer plus the chunk, bounded explicitly so it does not eat the test timeout
    // the audit itself still needs.
    await page.getByRole('heading', { name: "What's new" }).waitFor({ timeout: 15_000 });

    await expectNoViolations(page, 'dashboard with deferred panels resolved');
  });
});
