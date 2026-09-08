import type { ComponentFixture } from '@angular/core/testing';

/** How many macrotask turns {@link settleUntil} waits before giving up. */
const MAX_TURNS = 25;

/**
 * Render repeatedly until `rendered()` holds, for work Angular is not tracking.
 *
 * `ComponentFixture.whenStable()` resolves when Angular's own scheduler has nothing left
 * to do, and under zoneless change detection that is a narrower promise than it sounds:
 * it covers pending tasks the framework knows about — `HttpClient` requests, `resource()`
 * loaders, router navigations — and nothing else. A TanStack Query `queryFn` registers no
 * `PendingTask`, so `whenStable()` resolves with the query still `pending` and the spec
 * asserts against a skeleton.
 *
 * Awaiting a fixed number of turns instead would be worse, not better. The resolution and
 * the notification are separate: TanStack batches subscriber notifications through its own
 * scheduled callback, so the data lands one turn and the signals update the next — and how
 * many turns that adds up to is a property of a dependency's internals, which is not
 * something a spec should be encoding. So this waits for the *outcome* the spec is about,
 * and says so when it never arrives:
 *
 * ```ts
 * const fixture = TestBed.createComponent(InsightsPanelComponent);
 * fixture.detectChanges();      // the query starts
 * await settleUntil(fixture, () => host(fixture).querySelector('[data-testid=panel]') !== null);
 * ```
 *
 * Reach for it only when the completion of a read is genuinely invisible to Angular. A
 * `resource()` or an `HttpClient` call needs `whenStable()` alone, and using this instead
 * would hide a missing `PendingTask` behind a poll that happens to run long enough.
 *
 * @param rendered Checked after each render. Read the DOM or a signal — anything the spec
 *   is waiting for.
 * @throws If `rendered()` is still false after {@link MAX_TURNS} turns, naming the limit
 *   rather than letting Jasmine report an anonymous timeout several seconds later.
 */
export async function settleUntil(
  fixture: ComponentFixture<unknown>,
  rendered: () => boolean
): Promise<void> {
  for (let turn = 0; turn <= MAX_TURNS; turn++) {
    await fixture.whenStable();
    fixture.detectChanges();
    if (rendered()) return;
    // A macrotask boundary, which drains every microtask queued ahead of it and lets any
    // timer-scheduled callback — TanStack's notifier among them — run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(
    `settleUntil: the fixture never reached the expected state — still false after ${MAX_TURNS} turns.`
  );
}
