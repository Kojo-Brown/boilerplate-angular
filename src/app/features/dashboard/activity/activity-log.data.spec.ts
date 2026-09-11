import { ACTIVITY_ROW_COUNT, generateActivityLog } from './activity-log.data';

describe('generateActivityLog', () => {
  it('produces the row count the page is built around', () => {
    expect(generateActivityLog().length).toBe(ACTIVITY_ROW_COUNT);
    expect(ACTIVITY_ROW_COUNT).toBe(10_000);
  });

  it('produces the same log on every call', () => {
    // The point of seeding it. Without this, a screenshot, a bug report and a spec that
    // asserts on a row all describe a different data set each time the page loads.
    expect(generateActivityLog(50)).toEqual(generateActivityLog(50));
  });

  it('is a prefix-stable stream, so a smaller log is the start of a bigger one', () => {
    const long = generateActivityLog(100);

    expect(generateActivityLog(10)).toEqual(long.slice(0, 10));
  });

  it('gives every entry a unique id', () => {
    const entries = generateActivityLog();

    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  it('numbers entries from one, newest first', () => {
    const entries = generateActivityLog(5);

    expect(entries.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('orders timestamps the same way it orders sequence numbers', () => {
    // Sorting by `occurredAt` and sorting by `sequence` have to agree, or a spec that sorts
    // one column and asserts on another is asserting on noise rather than on the sort.
    const entries = generateActivityLog(500);

    for (let index = 1; index < entries.length; index++) {
      expect(entries[index].occurredAt < entries[index - 1].occurredAt).toBeTrue();
    }
  });

  it('writes timestamps as UTC ISO-8601, which is what lets them be compared as strings', () => {
    for (const entry of generateActivityLog(20)) {
      expect(entry.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('keeps every actor obviously fake', () => {
    // A fixture that reads like a real directory invites being treated as one.
    for (const entry of generateActivityLog(200)) {
      expect(entry.actor).toMatch(/^[a-z.]+@example\.test$/);
    }
  });

  it('varies action, actor and duration enough for a sort to be visible', () => {
    const entries = generateActivityLog(500);

    expect(new Set(entries.map((entry) => entry.action)).size).toBeGreaterThan(1);
    expect(new Set(entries.map((entry) => entry.actor)).size).toBeGreaterThan(1);
    expect(new Set(entries.map((entry) => entry.durationMs)).size).toBeGreaterThan(50);
  });

  it('keeps durations inside the range the column is sized for', () => {
    for (const entry of generateActivityLog(1_000)) {
      expect(entry.durationMs).toBeGreaterThanOrEqual(12);
      expect(entry.durationMs).toBeLessThan(512);
    }
  });

  it('names a resource as kind/number', () => {
    for (const entry of generateActivityLog(50)) {
      expect(entry.resource).toMatch(/^(post|comment|report|invoice|workspace)\/\d{4}$/);
    }
  });

  it('returns nothing for a count of zero rather than throwing', () => {
    expect(generateActivityLog(0)).toEqual([]);
  });
});
