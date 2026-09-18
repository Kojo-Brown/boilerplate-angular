import { host } from './dom';
import type { ComponentFixture } from '@angular/core/testing';

/**
 * What a `@for` block's track expression is worth, as something a spec can assert.
 *
 * `scripts/ci/assert-for-track.mjs` reads every track expression and classifies it, which
 * catches the shapes that are wrong by construction. It cannot answer the two questions
 * that actually matter, because both are properties of the data rather than of the
 * expression:
 *
 *   - Are the keys unique? Angular throws NG0955 on a duplicate, but only in development
 *     and only from a render that reaches it.
 *   - Are the keys *stable*? A key that changes when the data has not — object identity
 *     against a refetch, a position against a filter — destroys and rebuilds every row.
 *     Nothing throws. The rendered text is identical either way, so an assertion on
 *     `textContent` passes in both worlds.
 *
 * The observable difference is which DOM nodes survive. These helpers make that the
 * assertion: capture the nodes, change the data the way the application will, and check
 * that the nodes which should have been kept were kept.
 *
 * ```ts
 * const before = trackedNodes(fixture, '[data-testid="author-row"]');
 * refetchWithEqualButFreshObjects();
 * await fixture.whenStable();
 *
 * expectSameNodes(before, trackedNodes(fixture, '[data-testid="author-row"]'));
 * ```
 *
 * @see [`docs/track-expressions.md`](../../docs/track-expressions.md)
 */

/**
 * The elements a `@for` block currently renders, in document order.
 *
 * Returns the live `Element` objects and not a snapshot of their contents: node identity is
 * the whole measurement, so anything that copied them would destroy the thing being
 * measured.
 */
export function trackedNodes(fixture: ComponentFixture<unknown>, selector: string): Element[] {
  return Array.from(host(fixture).querySelectorAll(selector));
}

/**
 * Assert that a `@for` block kept the DOM nodes it rendered before the data changed.
 *
 * This is the assertion that fails when a track expression stops identifying the row. Both
 * the count and each position are checked, and the message says which: a length change is
 * a different failure from a length-preserving rebuild, and the second is the one a reader
 * will not otherwise believe is happening.
 */
export function expectSameNodes(before: readonly Element[], after: readonly Element[]): void {
  if (before.length === 0) {
    throw new Error(
      'expectSameNodes was given no "before" nodes, so it cannot prove anything. Check the ' +
        'selector and that the fixture had rendered rows when they were captured.'
    );
  }

  if (before.length !== after.length) {
    throw new Error(
      `Expected the same ${before.length} node(s) after the change, but ${after.length} ` +
        `are rendered. The collection changed length, so this is not a tracking question yet.`
    );
  }

  const rebuilt = before.reduce(
    (count, node, index) => (node === after[index] ? count : count + 1),
    0
  );

  if (rebuilt > 0) {
    throw new Error(
      `${rebuilt} of ${before.length} row(s) were destroyed and rebuilt rather than reused. ` +
        `The track expression is not identifying the row across this change — see ` +
        `docs/track-expressions.md.`
    );
  }
}

/**
 * Assert that every rendered row has a distinct DOM node.
 *
 * Cheap, and it catches the one way a track expression fails that does *not* look like a
 * rebuild: a non-unique key, where Angular is handed two items it believes are one row.
 */
export function expectDistinctNodes(nodes: readonly Element[]): void {
  if (new Set(nodes).size !== nodes.length) {
    throw new Error(
      `${nodes.length} row(s) rendered but only ${new Set(nodes).size} distinct node(s). ` +
        `The track expression produced duplicate keys.`
    );
  }
}

/**
 * Assert that a collection's track keys are unique, given the expression as a function.
 *
 * The data-side half, and the one worth running against a *generator*: 10,000 rows from
 * `activity-log.data.ts` are exactly where a key that is unique in a five-row fixture stops
 * being unique, and no rendering assertion will ever visit row 7,214.
 *
 * ```ts
 * expectUniqueKeys(generateActivityLog(), (entry) => entry.id);
 * ```
 */
export function expectUniqueKeys<T>(items: readonly T[], key: (item: T) => unknown): void {
  const seen = new Map<unknown, number>();

  for (const [index, item] of items.entries()) {
    const value = key(item);
    const first = seen.get(value);
    if (first !== undefined) {
      throw new Error(
        `Duplicate track key ${JSON.stringify(value)} at index ${index}; first seen at ` +
          `index ${first}. Angular reports this as NG0955, but only from a render that ` +
          `reaches the duplicate.`
      );
    }
    seen.set(value, index);
  }

  if (items.length === 0) {
    throw new Error('expectUniqueKeys was given an empty collection, so it proves nothing.');
  }
}
