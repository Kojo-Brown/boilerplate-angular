import { computed, signal } from '@angular/core';
import type { Signal } from '@angular/core';

/** A single recorded point in a store's history. */
export interface Transition<T> {
  /**
   * Monotonic id, unique for the lifetime of the store and never reused — not a
   * position in `history`, which shifts when the log is trimmed or rebased.
   * `connectDevtools` maps the extension's action ids onto these.
   */
  readonly id: number;
  /** Human-readable action name, e.g. `theme/toggle`. Shown in the DevTools log. */
  readonly label: string;
  /** The state *after* this transition. Snapshots, not patches — see the file header. */
  readonly state: T;
  /** `Date.now()` when the transition was recorded. */
  readonly at: number;
}

/**
 * What just happened to a store, delivered synchronously to every `subscribe` listener.
 *
 * Three kinds rather than one, because a devtools bridge has to react differently to
 * each: a new entry is appended to the log, a cursor move is invisible to the
 * extension, and a rebase invalidates every action id it holds.
 */
export type StoreEventKind =
  /** A new entry was appended at the cursor. */
  | 'transition'
  /** The cursor moved over existing history: `undo`, `redo`, `jumpTo`. */
  | 'travel'
  /** History was replaced wholesale: `reset`, `commit`. Previous ids are gone. */
  | 'rebase';

export interface StoreEvent<T> {
  readonly kind: StoreEventKind;
  /** The entry now at the cursor. */
  readonly transition: Transition<T>;
  /** `transition.state`, repeated for callers that only want the state. */
  readonly state: T;
}

export interface SignalStoreOptions {
  /** Store name, used as the DevTools instance name. Defaults to `'store'`. */
  name?: string;
  /**
   * Maximum number of entries kept in `history`. The oldest are dropped first.
   * Must be at least 1. Defaults to 50.
   */
  historyLimit?: number;
}

export interface SignalStore<T> {
  /** Store name, as passed in `options.name`. */
  readonly name: string;
  /** Current state — the entry at `cursor`. */
  readonly state: Signal<T>;
  /** The recorded log, oldest first. Index 0 is not necessarily the initial state. */
  readonly history: Signal<readonly Transition<T>[]>;
  /** Index into `history` of the entry currently applied. */
  readonly cursor: Signal<number>;
  readonly canUndo: Signal<boolean>;
  readonly canRedo: Signal<boolean>;

  /** A memoized signal for one key of the state. Repeated calls return the same signal. */
  select<K extends keyof T>(key: K): Signal<T[K]>;
  /** Record a transition computed from the current state. */
  update(label: string, recipe: (current: T) => T): void;
  /** Record a transition that merges `partial` into the current state. */
  patch(label: string, partial: Partial<T>): void;

  undo(): void;
  redo(): void;
  /** Move the cursor to `index`. Out-of-range indexes are ignored. */
  jumpTo(index: number): void;
  /** Discard history and go back to the state the store was created with. */
  reset(): void;
  /** Discard history and keep the current state as the new baseline. */
  commit(): void;

  /**
   * Observe every event synchronously, in order. Returns an unsubscribe function.
   *
   * Synchronous on purpose: an `effect` would coalesce two transitions that happen in
   * the same tick into one notification, and a devtools log that silently drops actions
   * is worse than none. Listeners must not write to the store.
   */
  subscribe(listener: (event: StoreEvent<T>) => void): () => void;
}

/**
 * A small signal-backed store with a recorded, navigable history.
 *
 * This is deliberately *not* a replacement for `@ngrx/signals` — `AuthStore` stays a
 * `signalStore`, because rxMethod, entity helpers and the store feature ecosystem are
 * worth far more than a history log for state that size. What this adds is the one
 * thing `signalStore` has no answer for: every write carries a label and lands in an
 * ordered log the app can walk backwards, which is what makes Redux DevTools' time
 * travel work against it.
 *
 * ```ts
 * const store = createSignalStore({ theme: 'light' as Theme }, { name: 'theme' });
 * store.patch('theme/set', { theme: 'dark' });
 * store.undo(); // back to 'light'
 * ```
 *
 * ## History holds snapshots, not patches
 *
 * Each entry carries the whole state after its transition, so `jumpTo` is an index
 * assignment rather than a fold over every patch since the start, and a jump can never
 * drift from what a replay would have produced. The cost is memory proportional to
 * `historyLimit × sizeof(state)`, which is why `historyLimit` exists and defaults to a
 * bounded 50 rather than growing for the life of the tab.
 *
 * ## Trimming shifts indexes, which is why ids exist
 *
 * Once the log is full the oldest entry is dropped, so `history()[0]` stops being the
 * initial state and every index shifts down by one. Anything that needs to refer to an
 * entry across time — the devtools bridge, mainly — must hold `Transition.id`, which is
 * monotonic and never reused. `reset()` keeps its own reference to the initial state for
 * the same reason: `jumpTo(0)` is not a synonym for it.
 *
 * ## Writing while time-travelled truncates the redo tail
 *
 * The standard undo-stack rule: history is a line, not a tree. Jump back three steps and
 * write, and the three entries ahead of the cursor are discarded — otherwise `redo`
 * would step into a future that no longer follows from the present.
 *
 * ## No injection context
 *
 * Nothing here injects, and there is nothing to tear down: no timers, no subscriptions,
 * no effects. A store can be created at module scope, in a service constructor, or
 * inside a plain unit test with no `TestBed`. The *devtools bridge* does have teardown —
 * that is why it is a separate function taking a `DestroyRef`, and not an option here.
 *
 * @param initialState State to start from, and the state `reset()` returns to.
 * @param options See {@link SignalStoreOptions}.
 * @throws RangeError if `historyLimit` is less than 1 or not an integer.
 */
export function createSignalStore<T extends object>(
  initialState: T,
  options: SignalStoreOptions = {}
): SignalStore<T> {
  const historyLimit = options.historyLimit ?? 50;
  if (!Number.isInteger(historyLimit) || historyLimit < 1) {
    throw new RangeError(`createSignalStore: historyLimit must be an integer >= 1.`);
  }

  const name = options.name ?? 'store';
  let nextId = 0;
  const stamp = (label: string, state: T): Transition<T> => ({
    id: nextId++,
    label,
    state,
    at: Date.now(),
  });

  const initial = stamp('@@init', initialState);
  const history = signal<readonly Transition<T>[]>([initial]);
  const cursor = signal(0);

  // Derived, not stored. A second writable signal holding the same value is a second
  // source of truth, and the two drift the moment a write updates one and not the other
  // — including through an `equal` option, where the state signal would decline an
  // update the log had already recorded. There is exactly one place state lives.
  const state = computed(() => history()[cursor()].state);

  const listeners = new Set<(event: StoreEvent<T>) => void>();
  const emit = (kind: StoreEventKind, transition: Transition<T>): void => {
    // Copied before iterating: a listener that unsubscribes itself — the normal shape
    // of a one-shot listener — would otherwise mutate the set mid-iteration.
    for (const listener of [...listeners]) {
      listener({ kind, transition, state: transition.state });
    }
  };

  const selectors = new Map<keyof T, Signal<T[keyof T]>>();

  function record(label: string, next: T): void {
    const entry = stamp(label, next);
    const kept = [...history().slice(0, cursor() + 1), entry].slice(-historyLimit);
    history.set(kept);
    cursor.set(kept.length - 1);
    emit('transition', entry);
  }

  function rebase(entries: readonly Transition<T>[]): void {
    const entry = entries[entries.length - 1];
    history.set(entries);
    cursor.set(entries.length - 1);
    emit('rebase', entry);
  }

  function travel(index: number): void {
    const entries = history();
    if (index < 0 || index >= entries.length || index === cursor()) return;
    cursor.set(index);
    emit('travel', entries[index]);
  }

  return {
    name,
    state,
    history: history.asReadonly(),
    cursor: cursor.asReadonly(),
    canUndo: computed(() => cursor() > 0),
    canRedo: computed(() => cursor() < history().length - 1),

    select<K extends keyof T>(key: K): Signal<T[K]> {
      const existing = selectors.get(key);
      if (existing) return existing as Signal<T[K]>;
      // Memoized so that a selector read in a template is one `computed` for the life of
      // the store rather than a fresh, never-cached node on every change detection pass.
      const selector = computed(() => state()[key]);
      selectors.set(key, selector as Signal<T[keyof T]>);
      return selector;
    },

    update(label: string, recipe: (current: T) => T): void {
      record(label, recipe(state()));
    },

    patch(label: string, partial: Partial<T>): void {
      record(label, { ...state(), ...partial });
    },

    undo(): void {
      travel(cursor() - 1);
    },

    redo(): void {
      travel(cursor() + 1);
    },

    jumpTo(index: number): void {
      travel(index);
    },

    reset(): void {
      rebase([stamp('@@reset', initialState)]);
    },

    commit(): void {
      rebase([stamp('@@commit', state())]);
    },

    subscribe(listener: (event: StoreEvent<T>) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
