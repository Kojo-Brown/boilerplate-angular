import { test as base } from '@playwright/test';
import { mockLoginSuccess, mockProfileSuccess, seedAuthSession } from '../helpers/api-mocks';

export type AuthFixtures = {
  authenticatedPage: ReturnType<typeof base['extend']> extends { page: infer P } ? P : never;
};

export const test = base.extend<{ authenticatedPage: void }>({
  authenticatedPage: async ({ page }, use) => {
    await mockLoginSuccess(page);
    await mockProfileSuccess(page);
    await page.goto('/login');
    await seedAuthSession(page);
    await use();
  },
});

export { expect } from '@playwright/test';
