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
      // `e2e/a11y/` is its own project below, and CI runs only that one. Without this the
      // audit would also run here, in a project whose `colorScheme` is the runner's
      // default — the setting `useTheme` exists to pin.
      testIgnore: '**/a11y/**',
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
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
