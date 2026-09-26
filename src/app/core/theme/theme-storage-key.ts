/**
 * Where an explicit theme choice is remembered, and the `Theme` union it stores.
 *
 * Its own module, with no imports, because it has two kinds of consumer.
 * `theme-preference.ts` is the Angular one; `e2e/helpers/theme.ts` is a Playwright file
 * that runs in Node, where importing anything that reaches `@angular/common` pulls in a
 * partially-compiled library and fails at load with a JIT-compiler error. Splitting the
 * constant out lets the audit seed the real key instead of a copy of it — a copy would
 * leave a rename silently auditing the light theme twice and still passing.
 */
export type Theme = 'light' | 'dark';

/** Storage key for the user's explicit theme choice. */
export const THEME_STORAGE_KEY = 'app_theme';
