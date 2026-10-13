import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // `e2e/a11y/` and `e2e/csrf/` are their own projects below, and CI runs only those.
      // Without this the audit would also run here, in a project whose `colorScheme` is
      // the runner's default — the setting `useTheme` exists to pin — and the CSRF suite
      // would run twice, the second time under this project's parallel workers against a
      // shared dev server, which is the arrangement it is explicitly configured to avoid.
      testIgnore: ['**/a11y/**', '**/csrf/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The WCAG 2.2 AA audit. Separate from `chromium` so CI can run the gate without
      // taking on the rest of the e2e suite, which is not wired into a job yet.
      //
      // `reducedMotion` is pinned rather than left to the runner: the audit clicks
      // through transitions (the drawer, the typeahead listbox) and `target-size` and
      // `color-contrast` both measure an element mid-animation differently from an
      // element at rest.
      name: 'a11y',
      testDir: './e2e/a11y',
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
    {
      // The CSRF contract, adjudicated by a real implementation of the server's half.
      // Its own project for the same reason `a11y` is: CI can run this gate without
      // taking on the rest of the e2e suite, which still has the pre-existing failures
      // the Phase 0 carry-over records.
      //
      // It is also the one project that must not run in parallel with the others against
      // the shared dev server. Each case installs an API that *rejects* non-compliant
      // requests, and a second worker driving the same server would be answering a
      // different contract — so the cases are serialised here rather than left to the
      // top-level `fullyParallel`.
      name: 'csrf',
      testDir: './e2e/csrf',
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
