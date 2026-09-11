import type { ActivityAction, ActivityEntry } from './activity.models';

/**
 * How many entries the log holds.
 *
 * The number the spec item names, and it is not arbitrary: ten thousand rows is roughly
 * where a table stops being a rendering problem and starts being a *layout* problem. A
 * browser will happily build 10,000 rows — it is the recalculation of style and layout
 * across ~60,000 cells on every subsequent change that takes hundreds of milliseconds.
 */
export const ACTIVITY_ROW_COUNT = 10_000;

/** Fixed, so two runs of the application show the same log. */
const SEED = 20_260_911;

/** The instant the newest entry happened, and the anchor every other one counts back from. */
const NEWEST_AT = Date.UTC(2026, 8, 11, 9, 0, 0);

/** At most this far, in minutes, between one entry and the next one older than it. */
const MAX_GAP_MINUTES = 7;

const ACTIONS: readonly ActivityAction[] = ['created', 'updated', 'deleted', 'viewed', 'exported'];

/**
 * Obviously fake actors — a fixture that reads like a real directory invites someone to
 * treat it as one.
 */
const ACTORS: readonly string[] = [
  'ada.sample@example.test',
  'grace.sample@example.test',
  'alan.sample@example.test',
  'katherine.sample@example.test',
  'linus.sample@example.test',
  'barbara.sample@example.test',
  'edsger.sample@example.test',
];

const RESOURCE_KINDS: readonly string[] = ['post', 'comment', 'report', 'invoice', 'workspace'];

/**
 * `mulberry32`: a 32-bit PRNG in four lines, seeded and therefore reproducible.
 *
 * `Math.random()` would make every page load a different data set, and with it every
 * screenshot, every bug report and — if a spec ever asserts on a row's contents — every test
 * run. Determinism is the whole requirement here; the statistical quality of the stream is
 * not, which is why this does not need to be anything more than four lines.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Build the activity log: `count` entries, newest first, identical on every call.
 *
 * ## Why this is generated rather than fetched
 *
 * Virtual scrolling is about the cost of *rendering* a large row set, and this repo has no
 * server to ask for one. Generating the rows keeps the demonstration about the thing it is
 * demonstrating — and keeps the page's cost honest, because the generated array is a real
 * 10,000-element array in memory with all the allocation that implies.
 *
 * That is also the one cost virtualisation does not remove, and it is worth being plain
 * about: rendering is bounded by the viewport, but *holding* the data is linear in `count`.
 * A log that genuinely grows without bound needs a paged
 * `DataSource` driven by `CdkVirtualScrollViewport.renderedRangeStream`, which is a
 * different feature from this one — see
 * [`docs/virtual-scrolling.md`](../../../../../docs/virtual-scrolling.md#what-this-does-not-do).
 *
 * Timestamps walk backwards from {@link NEWEST_AT} by a random gap, so `sequence` order and
 * `occurredAt` order agree. That is what a real audit trail looks like, and it means a spec
 * sorting by one and asserting on the other is not accidentally asserting on noise.
 */
export function generateActivityLog(count: number = ACTIVITY_ROW_COUNT): readonly ActivityEntry[] {
  const random = createRandom(SEED);
  const entries: ActivityEntry[] = [];
  let occurredAtMs = NEWEST_AT;

  for (let index = 0; index < count; index++) {
    const kind = RESOURCE_KINDS[Math.floor(random() * RESOURCE_KINDS.length)];
    const resourceNumber = 1_000 + Math.floor(random() * 9_000);

    entries.push({
      id: `activity-${index + 1}`,
      sequence: index + 1,
      occurredAt: new Date(occurredAtMs).toISOString(),
      actor: ACTORS[Math.floor(random() * ACTORS.length)],
      action: ACTIONS[Math.floor(random() * ACTIONS.length)],
      resource: `${kind}/${resourceNumber}`,
      // 12–512 ms. Wide enough that sorting by it reorders the log visibly.
      durationMs: 12 + Math.floor(random() * 500),
    });

    occurredAtMs -= Math.max(1, Math.floor(random() * MAX_GAP_MINUTES * 60_000));
  }

  return entries;
}
