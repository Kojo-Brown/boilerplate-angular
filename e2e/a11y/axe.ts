import AxeBuilder from '@axe-core/playwright';
import type { AxeResults, Result } from 'axe-core';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The rule set this repository is held to: WCAG 2.2 Level AA and everything it inherits.
 *
 * axe tags a rule by the *version that introduced it*, not by every version that still
 * contains it — `color-contrast` is `wcag2aa` and stays `wcag2aa` in 2.2. So asking for
 * `wcag22aa` alone selects the rules 2.2 added and nothing else, which is one rule. The
 * conformance target is the union.
 *
 * `best-practice` is deliberately absent. It is axe's own advice rather than a success
 * criterion — `region`, `page-has-heading-one` and `heading-order` live there as well as
 * under a WCAG tag, and a zero-violation gate has to be a gate on a standard, not on a
 * vendor's taste, or the next axe release moves the goalposts on a green branch.
 */
export const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/**
 * Rules axe ships disabled that this gate turns back on.
 *
 * Without this the "WCAG 2.2" in the name is decoration. 2.2 AA adds exactly one rule to
 * axe-core — `target-size`, for success criterion 2.5.8 — and axe ships it `enabled:
 * false` because it is expensive and prone to false positives on overlapping layouts. A
 * gate that passes `wcag22aa` to `withTags()` and stops there selects that one rule and
 * then never runs it, so it checks precisely the same thing a WCAG 2.1 gate does while
 * claiming otherwise. `e2e/a11y/axe.spec.ts` asserts that this object still switches a
 * rule from off to on, so a future axe release enabling it by default is a failing test
 * rather than a silent no-op.
 */
export const RULE_OVERRIDES = {
  'target-size': { enabled: true },
} as const;

/**
 * Runs the audit against whatever is currently rendered in `page`.
 *
 * `runOnly` and `rules` go through a single `options()` call, and that is not a style
 * choice. `AxeBuilder#options` **replaces** the whole options object, including whatever
 * `withTags()` put there — so the obvious spelling,
 * `.withTags(WCAG_22_AA_TAGS).options({ rules: RULE_OVERRIDES })`, silently drops the tag
 * filter and runs axe's entire catalogue. That version of this function reported
 * `heading-order` — a `best-practice` rule, no WCAG tag on it at all — as a WCAG 2.2 AA
 * violation on the dashboard. The failure mode is the dangerous direction for a gate
 * (stricter than advertised, and on a moving target), but it is still the gate not
 * checking what it says. `axe.spec.ts` asserts the filter survives.
 */
export function auditPage(page: Page): Promise<AxeResults> {
  return new AxeBuilder({ page })
    .options({
      runOnly: { type: 'tag', values: [...WCAG_22_AA_TAGS] },
      rules: { ...RULE_OVERRIDES },
    })
    .analyze();
}

/**
 * Renders a violation the way a person fixing it needs to read it.
 *
 * Playwright prints the assertion message and nothing else, and axe's own objects are
 * several hundred lines of JSON per page. What actually locates the problem is the rule,
 * the selector, the element, and axe's own sentence about what is wrong with it — so
 * that is what goes in, and the help URL for the rule that is not obvious.
 */
function formatViolations(violations: readonly Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => {
          const summary = (n.failureSummary ?? '').split('\n').map((l) => `      ${l.trim()}`);
          return [`    ${n.target.join(' ')}`, `      ${n.html}`, ...summary].join('\n');
        })
        .join('\n');
      return `  [${v.impact ?? 'unknown'}] ${v.id} — ${v.help}\n  ${v.helpUrl}\n${nodes}`;
    })
    .join('\n\n');
}

/**
 * The gate: audit what is on screen and fail on any violation.
 *
 * Zero, with no allow-list and no severity floor. An `impact: 'minor'` violation is still
 * a failed success criterion, and a threshold is the mechanism by which an a11y gate
 * becomes a number nobody looks at.
 *
 * `incomplete` is *not* failed on. Those are the checks axe could not decide — a colour
 * behind a gradient, a target whose neighbours overlap — and failing on them would make
 * the gate non-deterministic on exactly the elements it is least sure about. They are
 * reported in `axe.spec.ts` instead, where the count is asserted to be what we last
 * reviewed, so a new one has to be looked at rather than accumulating unseen.
 */
export async function expectNoViolations(page: Page, label: string): Promise<AxeResults> {
  const results = await auditPage(page);

  expect(
    results.violations,
    results.violations.length === 0
      ? ''
      : `${results.violations.length} WCAG 2.2 AA violation(s) on ${label}:\n\n` +
          `${formatViolations(results.violations)}\n`
  ).toEqual([]);

  return results;
}
