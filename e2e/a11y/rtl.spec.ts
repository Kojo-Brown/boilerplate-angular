import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  mockLoginSuccess,
  mockPosts,
  mockProfileSuccess,
  seedAuthSession,
} from '../helpers/api-mocks';
import { expectNoViolations } from './axe';

/**
 * The right-to-left pass: what `dir="rtl"` actually does to this layout.
 *
 * ## Why these assertions are about geometry
 *
 * The localised build sets `lang` and `dir` on `<html>` from the locale — Angular does
 * it, `assert-ssr.mjs` checks the prerendered bytes still carry it, and nothing in
 * `src/` is involved. What none of that answers is whether the page is *usable*
 * afterwards, because `dir` only reaches the properties that are written logically. A
 * layout built on `ml-`/`left-`/`border-r` reflows into a consistent, plausible-looking,
 * wrong version of itself: the sidebar keeps the left edge of a document that now starts
 * on the right, the border lands on the outside, and the closed drawer slides *across*
 * the page instead of off it. Nothing errors, and the axe audit — which reads the
 * accessibility tree, where "left" is not a concept — reports zero violations throughout.
 *
 * `assert-logical-properties.mjs` bans the utilities that cause it, one class at a time.
 * This is the other half: the rendered result, measured, for the two places where the
 * fix is not a class name swap.
 *
 * ## Why `dir` is set here rather than by serving the Arabic build
 *
 * `ng serve` serves one locale, and these specs run against the development
 * configuration, which builds the source locale so the whole suite can address routes as
 * `/login` rather than `/en-US/login`. That costs nothing here: the compiled CSS is the
 * same file in every locale — Tailwind's logical utilities and `rtl:` variants both
 * resolve against the `dir` attribute at *runtime* — so setting `dir` is the same input
 * the Arabic document supplies. What it does not cover is the text, and the text is
 * covered where it can be: `assert-i18n-coverage.mjs` against the catalogue,
 * `assert-ssr.mjs` against the prerendered Arabic bytes. `pnpm start:ar` serves the real
 * thing for a manual pass; `docs/i18n.md` says what to look at.
 */

/**
 * Flip the document, as a locale's own markup would.
 *
 * After navigation rather than in an init script, and the reason is itself worth knowing:
 * the served `index.html` already carries `lang` and `dir`, written by the CLI from the
 * i18n configuration — `<html lang="en-US" dir="ltr">` even in the development build,
 * where nothing is localised. A value set before the document exists is therefore
 * overwritten by the document. Setting it afterwards is also the honest simulation: `dir`
 * is read live by the cascade, so every logical property and every `rtl:` variant
 * recomputes exactly as it would have on a page served that way.
 */
async function mirror(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'ar');
  });
}

/**
 * A settled bounding box.
 *
 * `expect.poll` rather than a bare `boundingBox()`: the drawer is
 * `transition-transform duration-200`, so a box read on the frame after a class change is
 * a box mid-animation. `reducedMotion: 'reduce'` in the Playwright project does not help
 * — that sets a media preference, and this transition is not written behind one.
 */
function settledBox(locator: Locator, read: (box: { x: number; width: number }) => number) {
  return expect.poll(
    async () => {
      const box = await locator.boundingBox();
      return box === null ? null : Math.round(read(box));
    },
    { timeout: 5_000 }
  );
}

async function signIn(page: Page): Promise<void> {
  await mockLoginSuccess(page);
  await mockProfileSuccess(page);
  await mockPosts(page);
  await page.goto('/login');
  await seedAuthSession(page);
}

test.describe('right-to-left layout', () => {
  test('the document reports itself as right-to-left', async ({ page }) => {
    await page.goto('/login');

    // The build already writes a direction, from the locale, with no application code
    // involved. Asserted before the flip so that the flip is a change rather than a
    // coincidence — and so that a future build that stopped writing it fails here.
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await mirror(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveCSS('direction', 'rtl');
  });

  /**
   * `start-0` and `border-e`, seen from the outside.
   *
   * The sidebar is `fixed inset-y-0 start-0 … border-e`, so under `dir="rtl"` it belongs
   * against the right edge with its border on its left. Written physically — `left-0
   * border-r`, which is what it said — it stays on the left, and the reading order starts
   * on the far side of the page from the navigation.
   */
  test('the desktop sidebar sits on the right, with its border facing the content', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page);
    await page.goto('/dashboard');
    await mirror(page);

    const sidebar = page.locator('aside');
    await settledBox(sidebar, (box) => box.x + box.width).toBe(1280);

    // `border-e` is the inline-end edge, which is the *left* one in an RTL document.
    await expect(sidebar).not.toHaveCSS('border-left-width', '0px');
    await expect(sidebar).toHaveCSS('border-right-width', '0px');
  });

  /**
   * The one thing `dir` cannot fix, and the reason `SIDEBAR_CLOSED` names a direction.
   *
   * A transform is geometry: `-translate-x-full` moves the panel left whatever the
   * document direction is. With the drawer anchored to the right edge under RTL, moving
   * it left slides it over the page rather than off it — a closed drawer covering the
   * content, `inert` and invisible to every other gate, because it is still "closed" as
   * far as the component is concerned. `rtl:translate-x-full` is the pair that fixes it.
   */
  test('the closed mobile drawer is off screen past the right edge', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/dashboard');
    await mirror(page);

    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveAttribute('inert', '');

    // Off the right-hand edge entirely, rather than merely shifted.
    await settledBox(sidebar, (box) => box.x).toBeGreaterThanOrEqual(390);
  });

  test('the open mobile drawer comes back on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/dashboard');
    await mirror(page);

    await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
    await expect(page.locator('aside')).not.toHaveAttribute('inert', '');

    await settledBox(page.locator('aside'), (box) => box.x + box.width).toBe(390);
  });

  /**
   * `end-4` on the toast container. Anchored to the inline-end edge, which is the left one
   * here — a notification pinned to `right-4` in an RTL document sits over the start of
   * every line it overlaps.
   */
  test('toasts are anchored to the inline-end edge', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page);
    await page.goto('/dashboard');
    await mirror(page);

    const region = page.getByRole('region', { name: 'Notifications' });
    await settledBox(region, (box) => box.x).toBe(16);
  });

  /**
   * The audit again, mirrored.
   *
   * Not a duplicate of `a11y.spec.ts`: `target-size` and `color-contrast` are measured
   * against laid-out boxes, and this is a different layout. A page that only fails when
   * reversed — an element pushed under another, a control clipped at the edge — is
   * exactly what a left-to-right sweep cannot see.
   */
  test('the dashboard has no WCAG 2.2 AA violations when mirrored', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page);
    await page.goto('/dashboard');
    await mirror(page);
    await page.waitForLoadState('networkidle');

    await expectNoViolations(page, 'rtl /dashboard');
  });
});
