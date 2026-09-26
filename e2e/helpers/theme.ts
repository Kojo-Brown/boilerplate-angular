import type { Page } from '@playwright/test';
import type { Theme } from '@/app/core/theme/theme-storage-key';
import { THEME_STORAGE_KEY } from '@/app/core/theme/theme-storage-key';

/**
 * Pins the application's theme, and the browser's, before the application boots.
 *
 * `addInitScript` rather than a click on the theme toggle: the toggle lives inside
 * `LayoutShellComponent`, so the routes that render outside it — `/login`, `/register`,
 * `/unauthorized` — could not be put into dark mode that way at all. Seeding the storage
 * key is also exactly what a returning visitor's browser presents, so it drives the same
 * branch of `ThemeService` that a real second visit does.
 *
 * `THEME_STORAGE_KEY` is imported from the application rather than written out here.
 * Renaming the key would otherwise leave every dark-theme test silently auditing the
 * light theme twice and still passing.
 *
 * `colorScheme` is emulated alongside it because the two are now genuinely independent:
 * `styles.css` binds Tailwind's `dark:` variant to the `.dark` class, so
 * `prefers-color-scheme` no longer moves the application's own styling and a test that
 * left it at the runner's default would be asserting against a browser setting.
 */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    THEME_STORAGE_KEY,
    theme,
  ] as const);
}
