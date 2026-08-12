import { effect, inject, Injector, signal } from '@angular/core';
import type { Signal } from '@angular/core';

export interface IntervalSignalOptions {
  /**
   * Injector that owns the underlying effect. Required when `intervalSignal` is called
   * outside an injection context.
   */
  injector?: Injector;
  /** Debug name shown for the effect in Angular DevTools. */
  debugName?: string;
}

/**
 * A counter signal that increments once per `period`, starting at `0`.
 *
 * Use it as a clock to drive derived state — a relative timestamp, a countdown, a
 * poll trigger — rather than storing the time itself:
 *
 * ```ts
 * private readonly tick = intervalSignal(1_000);
 * readonly elapsedLabel = computed(() => `${this.tick()}s since load`);
 * ```
 *
 * `period` may be a signal, which is what makes the cleanup contract interesting:
 *
 * - Changing the period tears the old timer down before arming the new one, so the
 *   two never run side by side. The counter keeps its value across the change; only
 *   the cadence moves.
 * - A period of `null` pauses the clock: the effect re-runs, the previous cleanup
 *   clears the timer, and no new one is armed. Setting a number again resumes from
 *   the current count. Pausing on `document.visibilityState === 'hidden'` costs one
 *   `computed` and no extra teardown code.
 * - Destroying the owning injector destroys the effect, which clears the timer. An
 *   interval that outlives its component is the classic leak this closes.
 *
 * @param period Milliseconds between ticks, or `null` to pause. Must be finite and
 *   greater than zero when it is a number.
 * @throws RangeError if a non-null period is not a finite number greater than zero. A
 *   constant period is checked at the call site; a signal period is only read inside
 *   the effect, so the error surfaces on the first flush and travels through Angular's
 *   effect error handling rather than back to the caller.
 */
export function intervalSignal(
  period: number | Signal<number | null>,
  options: IntervalSignalOptions = {}
): Signal<number> {
  if (typeof period === 'number') {
    assertPeriod(period);
  }

  const injector = options.injector ?? inject(Injector);
  const ticks = signal(0);

  effect(
    (onCleanup) => {
      const current = typeof period === 'number' ? period : period();
      if (current === null) return;
      assertPeriod(current);

      const handle = setInterval(() => ticks.update((count) => count + 1), current);
      onCleanup(() => clearInterval(handle));
    },
    { injector, debugName: options.debugName ?? 'intervalSignal' }
  );

  return ticks.asReadonly();
}

function assertPeriod(period: number): void {
  if (!Number.isFinite(period) || period <= 0) {
    throw new RangeError(`intervalSignal: period must be a finite number greater than zero.`);
  }
}
