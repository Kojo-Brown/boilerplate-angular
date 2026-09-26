import axe from 'axe-core';
import { expect, test } from '@playwright/test';
import { RULE_OVERRIDES, WCAG_22_AA_TAGS, auditPage } from './axe';

/**
 * Checks on the gate itself, not on the application.
 *
 * Every assertion here guards a way this suite could keep passing while checking less
 * than its name claims. None of them needs a page, but they run as Playwright tests so
 * that they fail in the same job, against the same axe-core, as the audit they describe.
 */
test.describe('the audit configuration', () => {
  /**
   * The one that matters.
   *
   * WCAG 2.2 AA adds a single rule to axe-core — `target-size`, for SC 2.5.8 — and axe
   * ships it disabled. `withTags(['…', 'wcag22aa'])` therefore selects it and then does
   * not run it: the suite says "WCAG 2.2" and audits WCAG 2.1. `RULE_OVERRIDES` is what
   * closes that, and this asserts both halves of the reason it exists — that the rule is
   * still the disabled one, and that the override still names it. When a future axe-core
   * enables it by default, this fails and the override can go.
   */
  test('enables every WCAG 2.2 AA rule axe ships disabled', () => {
    const disabledByDefault = axe
      .getRules([...WCAG_22_AA_TAGS])
      .filter((rule) => rule.tags.includes('wcag22aa'))
      .filter((rule) => rule.enabled === false)
      .map((rule) => rule.ruleId);

    expect(disabledByDefault).not.toEqual([]);
    expect(Object.keys(RULE_OVERRIDES).sort()).toEqual(disabledByDefault.sort());
    for (const ruleId of disabledByDefault) {
      expect(RULE_OVERRIDES[ruleId as keyof typeof RULE_OVERRIDES].enabled).toBe(true);
    }
  });

  /**
   * `wcag22aa` alone is not the conformance target: axe tags a rule with the WCAG version
   * that *introduced* it, so `color-contrast` stays `wcag2aa` forever even though 2.2
   * still requires it. Selecting the union is the whole reason `WCAG_22_AA_TAGS` is a
   * list, and a well-meaning simplification to `['wcag22aa']` would drop the audit from
   * seventy rules to one while leaving every test green.
   */
  test('selects the whole 2.2 AA rule set, not only the rules 2.2 added', () => {
    const selected = axe.getRules([...WCAG_22_AA_TAGS]);
    const introducedBy22 = selected.filter((rule) => rule.tags.includes('wcag22aa'));

    expect(introducedBy22.length).toBeLessThan(selected.length);
    expect(selected.length).toBeGreaterThan(50);

    for (const ruleId of ['color-contrast', 'label', 'aria-valid-attr-value', 'target-size']) {
      expect(selected.map((rule) => rule.ruleId)).toContain(ruleId);
    }
  });

  /**
   * The tag filter has to survive the rule overrides.
   *
   * `AxeBuilder#options` replaces the options object rather than merging into it, so
   * combining it with `withTags()` — which is how every example on the internet spells
   * this — throws the tag filter away and runs axe's whole catalogue, `best-practice`
   * included. The page below is clean under WCAG but violates `heading-order`, which is
   * `best-practice` and nothing else, so it comes back empty only while the filter is
   * really being applied.
   */
  test('runs only WCAG rules, not axe\u2019s best-practice catalogue', async ({ page }) => {
    await page.setContent(
      `<!doctype html><html lang="en"><head><title>Heading-order fixture</title></head>
       <body><main>
         <h1>Fixture</h1>
         <h3>Skips a level, which is best-practice only</h3>
       </main></body></html>`
    );

    const results = await auditPage(page);

    expect(results.violations.map((v) => v.id)).toEqual([]);
    expect(axe.getRules(['best-practice']).map((r) => r.ruleId)).toContain('heading-order');
  });

  /**
   * The gate has to be able to fail. A misconfigured `AxeBuilder` — a bad tag name, an
   * `include` that matches nothing — returns zero violations just as a clean page does,
   * and every test in `a11y.spec.ts` would pass against a blank document. This puts a
   * known violation in front of it and expects it back.
   */
  test('reports a violation that is really there', async ({ page }) => {
    await page.setContent(
      `<!doctype html><html lang="en"><head><title>Missing-alt fixture</title></head>
       <body><main>
         <h1>Fixture</h1>
         <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="1" height="1">
       </main></body></html>`
    );

    const results = await auditPage(page);

    expect(results.violations.map((v) => v.id)).toContain('image-alt');
  });
});
