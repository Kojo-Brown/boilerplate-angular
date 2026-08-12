import { effect, inject, Injector, signal, untracked } from '@angular/core';
import type { Signal, ValueEqualityFn } from '@angular/core';

export interface DebouncedSignalOptions<T> {
  /**
   * Injector that owns the underlying effect. Required when `debouncedSignal` is called
   * outside an injection context (a lifecycle hook, an event handler, an async callback).
   */
  injector?: Injector;
  /** Equality function for the debounced signal. Defaults to Angular's `Object.is`. */
  equal?: ValueEqualityFn<T>;
  /** Debug name shown for the effect in Angular DevTools. */
  debugName?: string;
}

/**
 * A read-only signal that trails `source`, only settling once `source` has been quiet
 * for `delayMs`. Rapid changes collapse into a single update — the standard shape for
 * a search box that should not fire a request per keystroke.
 *
 * ```ts
 * readonly term = signal('');
 * readonly debouncedTerm = debouncedSignal(this.term, 300);
 * ```
 *
 * Cleanup semantics, which are the whole point of the `onCleanup` callback:
 *
 * - Every time `source` changes, the effect re-runs and its previous cleanup fires
 *   first, clearing the timer that had been armed. That cancellation *is* the debounce;
 *   without it each keystroke would land after its own delay.
 * - When the owning injector is destroyed the effect is destroyed too, and its last
 *   cleanup runs. A pending timer therefore cannot resolve into a component that is
 *   already gone.
 *
 * The initial value is available synchronously — only *changes* are delayed. Reading
 * the result never triggers work, so it is safe inside a `computed` or a template.
 *
 * @param source Signal to follow.
 * @param delayMs Quiet period, in milliseconds. Must be finite and non-negative.
 * @throws RangeError if `delayMs` is negative, `NaN`, or infinite.
 */
export function debouncedSignal<T>(
  source: Signal<T>,
  delayMs: number,
  options: DebouncedSignalOptions<T> = {}
): Signal<T> {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError(`debouncedSignal: delayMs must be a finite, non-negative number.`);
  }

  const injector = options.injector ?? inject(Injector);
  const debounced = signal(untracked(source), { equal: options.equal });
  let settled = false;

  effect(
    (onCleanup) => {
      const value = source();

      // The first run happens on the flush after creation, not at creation time, so
      // `source` may already have moved on from the value captured above. Adopt it
      // synchronously: the caller has not seen a debounced value yet, so there is
      // nothing to debounce against.
      if (!settled) {
        settled = true;
        debounced.set(value);
        return;
      }

      const handle = setTimeout(() => debounced.set(value), delayMs);
      onCleanup(() => clearTimeout(handle));
    },
    { injector, debugName: options.debugName ?? 'debouncedSignal' }
  );

  return debounced.asReadonly();
}
