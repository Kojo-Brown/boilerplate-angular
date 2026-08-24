import { createSignalStore } from './signal-store';
import type { SignalStore, StoreEvent } from './signal-store';

interface CounterState {
  count: number;
  label: string;
}

function createCounter(historyLimit?: number): SignalStore<CounterState> {
  return createSignalStore<CounterState>(
    { count: 0, label: 'start' },
    { name: 'counter', historyLimit }
  );
}

describe('createSignalStore', () => {
  // No TestBed anywhere in this file, deliberately: the primitive injects nothing and
  // owns no teardown, so needing one would be a design smell rather than a test detail.

  describe('state and selectors', () => {
    it('starts at the initial state, recorded as the first history entry', () => {
      const store = createCounter();

      expect(store.state()).toEqual({ count: 0, label: 'start' });
      expect(store.history().length).toBe(1);
      expect(store.history()[0].label).toBe('@@init');
      expect(store.cursor()).toBe(0);
    });

    it('patches a subset of keys and leaves the rest alone', () => {
      const store = createCounter();

      store.patch('counter/increment', { count: 1 });

      expect(store.state()).toEqual({ count: 1, label: 'start' });
    });

    it('updates from the current state', () => {
      const store = createCounter();

      store.update('counter/double', (current) => ({ ...current, count: current.count + 5 }));
      store.update('counter/double', (current) => ({ ...current, count: current.count * 2 }));

      expect(store.state().count).toBe(10);
    });

    it('returns the same signal for repeated select calls on one key', () => {
      const store = createCounter();

      expect(store.select('count')).toBe(store.select('count'));
      expect(store.select('count')).not.toBe(store.select('label'));
    });

    it('tracks state through a selector', () => {
      const store = createCounter();
      const count = store.select('count');

      store.patch('counter/set', { count: 42 });

      expect(count()).toBe(42);
    });

    it('rejects a historyLimit below one', () => {
      expect(() => createCounter(0)).toThrowError(RangeError);
      expect(() => createCounter(1.5)).toThrowError(RangeError);
    });
  });

  describe('history', () => {
    it('appends one labelled entry per write', () => {
      const store = createCounter();

      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      expect(store.history().map((entry) => entry.label)).toEqual([
        '@@init',
        'counter/a',
        'counter/b',
      ]);
      expect(store.cursor()).toBe(2);
    });

    it('stores a snapshot per entry, so an earlier entry is unaffected by later writes', () => {
      const store = createCounter();

      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      expect(store.history()[1].state).toEqual({ count: 1, label: 'start' });
    });

    it('drops the oldest entries once the limit is reached', () => {
      const store = createCounter(3);

      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });
      store.patch('counter/c', { count: 3 });

      expect(store.history().map((entry) => entry.label)).toEqual([
        'counter/a',
        'counter/b',
        'counter/c',
      ]);
      expect(store.cursor()).toBe(2);
      expect(store.state().count).toBe(3);
    });

    it('keeps transition ids monotonic across a trim, so they are not indexes', () => {
      const store = createCounter(2);

      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });
      store.patch('counter/c', { count: 3 });

      // Index 0 now holds transition 2, not transition 0 — the exact confusion that
      // would send a devtools jump to the wrong state if ids were positions.
      expect(store.history().map((entry) => entry.id)).toEqual([2, 3]);
    });
  });

  describe('time travel', () => {
    it('undoes and redoes across recorded entries', () => {
      const store = createCounter();
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      store.undo();
      expect(store.state().count).toBe(1);

      store.undo();
      expect(store.state().count).toBe(0);

      store.redo();
      expect(store.state().count).toBe(1);
    });

    it('reports what it can do at each end of the log', () => {
      const store = createCounter();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);

      store.patch('counter/a', { count: 1 });
      expect(store.canUndo()).toBe(true);
      expect(store.canRedo()).toBe(false);

      store.undo();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);
    });

    it('ignores an undo at the start and a redo at the end', () => {
      const store = createCounter();
      store.patch('counter/a', { count: 1 });

      store.redo();
      expect(store.cursor()).toBe(1);

      store.undo();
      store.undo();
      expect(store.cursor()).toBe(0);
    });

    it('ignores an out-of-range jump', () => {
      const store = createCounter();
      store.patch('counter/a', { count: 1 });

      store.jumpTo(99);
      store.jumpTo(-1);

      expect(store.cursor()).toBe(1);
      expect(store.state().count).toBe(1);
    });

    it('does not record a jump as a new entry', () => {
      const store = createCounter();
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      store.undo();

      expect(store.history().length).toBe(3);
    });

    it('truncates the redo tail when a write lands mid-history', () => {
      const store = createCounter();
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });
      store.patch('counter/c', { count: 3 });

      store.jumpTo(1);
      store.patch('counter/d', { count: 9 });

      expect(store.history().map((entry) => entry.label)).toEqual([
        '@@init',
        'counter/a',
        'counter/d',
      ]);
      expect(store.canRedo()).toBe(false);
      expect(store.state().count).toBe(9);
    });
  });

  describe('reset and commit', () => {
    it('reset returns to the initial state and clears the log', () => {
      const store = createCounter();
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      store.reset();

      expect(store.state()).toEqual({ count: 0, label: 'start' });
      expect(store.history().map((entry) => entry.label)).toEqual(['@@reset']);
      expect(store.canUndo()).toBe(false);
    });

    it('reset still finds the initial state after it has been trimmed away', () => {
      // The case that makes `reset()` more than `jumpTo(0)`: with a limit of 2 the
      // `@@init` entry is long gone from the log by the time reset is called.
      const store = createCounter(2);
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });
      store.patch('counter/c', { count: 3 });

      store.reset();

      expect(store.state()).toEqual({ count: 0, label: 'start' });
    });

    it('commit keeps the current state and clears the log', () => {
      const store = createCounter();
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      store.commit();

      expect(store.state().count).toBe(2);
      expect(store.history().map((entry) => entry.label)).toEqual(['@@commit']);
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('subscribe', () => {
    function collect(store: SignalStore<CounterState>): StoreEvent<CounterState>[] {
      const events: StoreEvent<CounterState>[] = [];
      store.subscribe((event) => events.push(event));
      return events;
    }

    it('reports each event kind', () => {
      const store = createCounter();
      const events = collect(store);

      store.patch('counter/a', { count: 1 });
      store.undo();
      store.commit();

      expect(events.map((event) => event.kind)).toEqual(['transition', 'travel', 'rebase']);
      expect(events[0].transition.label).toBe('counter/a');
      expect(events[1].state.count).toBe(0);
    });

    it('delivers synchronously, without coalescing writes in one tick', () => {
      // The reason `subscribe` exists rather than an `effect`: an effect would report
      // once for the pair below, and a devtools log that skips actions is broken.
      const store = createCounter();
      const events = collect(store);

      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      expect(events.length).toBe(2);
      expect(events.map((event) => event.state.count)).toEqual([1, 2]);
    });

    it('stops delivering after unsubscribe', () => {
      const store = createCounter();
      const events: StoreEvent<CounterState>[] = [];
      const unsubscribe = store.subscribe((event) => events.push(event));

      store.patch('counter/a', { count: 1 });
      unsubscribe();
      store.patch('counter/b', { count: 2 });

      expect(events.length).toBe(1);
    });

    it('survives a listener that unsubscribes itself mid-notification', () => {
      const store = createCounter();
      const seen: string[] = [];
      const unsubscribeFirst = store.subscribe((event) => {
        seen.push(`first:${event.transition.label}`);
        unsubscribeFirst();
      });
      store.subscribe((event) => seen.push(`second:${event.transition.label}`));

      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      expect(seen).toEqual(['first:counter/a', 'second:counter/a', 'second:counter/b']);
    });
  });
});
