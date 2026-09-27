import { expect, test } from '@playwright/test';
import {
  MOCK_POSTS,
  mockLoginSuccess,
  mockPosts,
  mockProfileSuccess,
  seedAuthSession,
} from '../helpers/api-mocks';

/**
 * Focus and live regions, in a real browser, because neither is a property of a component.
 *
 * `document.activeElement` after a navigation is decided jointly by the router, the
 * outlet, the order Angular creates and destroys views in, and the browser's own default —
 * which is that focus stays on a link that has just been destroyed. A `TestBed` fixture
 * can assert that `focus()` was called on the right element; only a page can tell you
 * where focus actually ended up.
 *
 * The live region is here for a second reason: what a screen reader announces is a
 * function of the accessibility tree, and the difference between a region that announces
 * and one that is silent — `sr-only` versus `display: none` — exists only once the
 * stylesheet has been applied. The unit specs assert the class; this asserts the outcome.
 *
 * What this cannot assert is the announcement itself: no browser exposes what a screen
 * reader said. The closest honest claim is the one AT actually acts on — that a correctly
 * configured live region's text changed — so that is what is asserted, at the DOM level,
 * including the empty state in between that makes a repeat a change.
 */

const LIVE_REGION = '[aria-live="polite"][aria-atomic="true"]';
const MAIN = '#main-content';

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await mockLoginSuccess(page);
  await mockProfileSuccess(page);
  await mockPosts(page);
  await page.goto('/login');
  await seedAuthSession(page);
}

test.describe('route-change announcements', () => {
  /**
   * The region has to be in the tree before it has anything to say: a screen reader
   * registers a live region as it appears and watches it from then on, so one created and
   * filled in the same task announces nothing.
   */
  test('the live region is present and empty before any navigation', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const region = page.locator(LIVE_REGION);
    await expect(region).toHaveCount(1);
    await expect(region).toHaveText('');
  });

  test('a navigation announces the page arrived at', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Posts' }).first().click();

    await expect(page.locator(LIVE_REGION)).toHaveText(/Posts, page loaded/);
  });

  /**
   * The router emits `NavigationEnd` *before* it updates the title, so an announcer wired
   * the obvious way names the page the visitor just left. This is that bug, from outside.
   */
  test('the announcement is not the previous page’s title', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Posts' }).first().click();
    await expect(page.locator(LIVE_REGION)).not.toHaveText(/Dashboard/);
  });

  /**
   * `sr-only` is the clip-rect pattern, so the region is off screen and still in the
   * accessibility tree. `display: none` and `visibility: hidden` both look identical on
   * screen and make the region silent.
   */
  test('the live region is visually hidden but still rendered', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');

    const box = await page.locator(LIVE_REGION).boundingBox();
    expect(box).not.toBeNull();
    expect(await page.locator(LIVE_REGION).evaluate((el) => getComputedStyle(el).display)).not.toBe(
      'none'
    );
    expect(
      await page.locator(LIVE_REGION).evaluate((el) => getComputedStyle(el).visibility)
    ).not.toBe('hidden');
  });
});

test.describe('focus management', () => {
  /**
   * The regression the architecture introduces: following a link in a document moves focus
   * to the new document, following a `routerLink` leaves it on a link that no longer
   * exists — so tabbing forward restarts at the top of the page and the visitor pays for
   * the whole sidebar again on every navigation.
   */
  test('a navigation moves focus to the new route’s main region', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Posts' }).first().click();
    await page.waitForURL('**/dashboard/posts');

    await expect(page.locator(MAIN)).toBeFocused();
  });

  /** Not on load: the browser has already put focus at the top of the document. */
  test('a fresh page load leaves focus at the top of the document', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(focusedTag).toBe('BODY');
  });

  test('the main region is focusable programmatically but not by tabbing to it', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/dashboard');

    await expect(page.locator(MAIN)).toHaveAttribute('tabindex', '-1');
  });

  test('every route provides a focus target, including those outside the shell', async ({
    page,
  }) => {
    await mockPosts(page);
    for (const path of ['/login', '/register', '/unauthorized']) {
      await page.goto(path);
      await expect(page.locator(MAIN)).toHaveCount(1);
    }

    await signIn(page);
    for (const path of ['/dashboard', `/dashboard/posts/${MOCK_POSTS[0].id}`, '/admin']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(MAIN)).toHaveCount(1);
    }
  });
});

test.describe('the skip link', () => {
  /** SC 2.4.1: it has to be the first thing Tab reaches, or it skips nothing. */
  test('is the first element in the tab order', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });

  /** Hidden with the clip-rect pattern, so focusing it can bring it back. */
  test('becomes visible when it is focused', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const link = page.getByRole('link', { name: 'Skip to main content' });
    const hiddenWidth = (await link.boundingBox())?.width ?? 0;

    await page.keyboard.press('Tab');
    const focusedWidth = (await link.boundingBox())?.width ?? 0;

    expect(focusedWidth).toBeGreaterThan(hiddenWidth);
  });

  /**
   * The classic broken skip link scrolls the page and leaves focus behind, so the next Tab
   * continues from the navigation it was meant to skip. This asserts the thing that
   * actually matters: where focus is afterwards.
   */
  test('moves focus into the main region, not just the scroll position', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    await expect(page.locator(MAIN)).toBeFocused();
    expect(new URL(page.url()).hash).toBe('');
  });
});

test.describe('the closed mobile drawer', () => {
  /**
   * The bug: `-translate-x-full` moves the drawer off screen and leaves it in the tab order
   * and in the accessibility tree, so a keyboard visitor on a narrow viewport tabbed into
   * navigation links they could not see.
   */
  test('is not reachable by keyboard while it is closed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('aside')).toHaveAttribute('inert', '');

    // The links are still rendered — `inert` is not `display: none`, and the drawer keeps
    // its slide-in transition — so "unreachable" has to be asserted as tab order rather
    // than as absence from the DOM.
    await expect(page.locator('aside a')).not.toHaveCount(0);

    const reached: string[] = [];
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press('Tab');
      reached.push(
        await page.evaluate(() => {
          const active = document.activeElement;
          // `activeElement` is `<body>` when nothing is focused, and `null` only in a
          // detached document — neither is inside the sidebar, and `?.` alone would
          // report the second as though it were.
          return active !== null && active.closest('aside') !== null ? 'inside-sidebar' : 'outside';
        })
      );
    }

    expect(reached).not.toContain('inside-sidebar');
  });

  test('becomes reachable once the drawer is opened', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
    await page.getByRole('button', { name: 'Close navigation menu' }).waitFor();

    await expect(page.locator('aside')).not.toHaveAttribute('inert', '');
  });
});
