import { connectDevtools } from './devtools';
import type { DevtoolsMessage, ReduxDevtoolsConnection, ReduxDevtoolsExtension } from './devtools';
import { createSignalStore } from './signal-store';
import type { SignalStore } from './signal-store';

interface CounterState {
  count: number;
}

/** Records everything the bridge sends and lets a test play the monitor's side. */
class FakeConnection implements ReduxDevtoolsConnection {
  readonly inits: CounterState[] = [];
  readonly sent: { type: string; state: CounterState }[] = [];
  readonly errors: string[] = [];
  private listener: ((message: DevtoolsMessage) => void) | undefined;

  init(state: unknown): void {
    this.inits.push(state as CounterState);
  }

  send(action: { type: string }, state: unknown): void {
    this.sent.push({ type: action.type, state: state as CounterState });
  }

  subscribe(listener: (message: DevtoolsMessage) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  error(message: string): void {
    this.errors.push(message);
  }

  /** Play a message from the monitor. Returns false if nobody is listening. */
  dispatch(message: DevtoolsMessage): boolean {
    if (!this.listener) return false;
    this.listener(message);
    return true;
  }

  /** The action labels sent since the last `init`, in monitor order. */
  get log(): string[] {
    return this.sent.map((entry) => entry.type);
  }
}

class FakeExtension implements ReduxDevtoolsExtension {
  readonly connection = new FakeConnection();
  readonly names: (string | undefined)[] = [];

  connect(options: { name?: string }): ReduxDevtoolsConnection {
    this.names.push(options.name);
    return this.connection;
  }
}

function jumpTo(actionId: number): DevtoolsMessage {
  return { type: 'DISPATCH', payload: { type: 'JUMP_TO_ACTION', actionId } };
}

function dispatch(type: string): DevtoolsMessage {
  return { type: 'DISPATCH', payload: { type } };
}

describe('connectDevtools', () => {
  let extension: FakeExtension;
  let store: SignalStore<CounterState>;

  beforeEach(() => {
    extension = new FakeExtension();
    store = createSignalStore<CounterState>({ count: 0 }, { name: 'counter' });
  });

  describe('without the extension', () => {
    it('is a no-op and returns a disconnect that does nothing', () => {
      // Nothing in the Karma browser installs the extension, so this is the real path.
      expect(window.__REDUX_DEVTOOLS_EXTENSION__).toBeUndefined();

      const disconnect = connectDevtools(store);

      expect(() => {
        disconnect();
      }).not.toThrow();
      // The store is untouched: no listener was registered, so writes still work.
      store.patch('counter/a', { count: 1 });
      expect(store.state().count).toBe(1);
    });

    it('finds the extension on window when no override is given', () => {
      window.__REDUX_DEVTOOLS_EXTENSION__ = extension;
      try {
        const disconnect = connectDevtools(store);
        expect(extension.names).toEqual(['counter']);
        disconnect();
      } finally {
        delete window.__REDUX_DEVTOOLS_EXTENSION__;
      }
    });
  });

  describe('store to monitor', () => {
    it('uses the store name, overridable per connection', () => {
      connectDevtools(store, { extension });
      connectDevtools(store, { extension, name: 'other' });

      expect(extension.names).toEqual(['counter', 'other']);
    });

    it('replays existing history on a late connection', () => {
      // The bridge arrives through a dynamic import, so this is the normal case rather
      // than an edge one: transitions are already recorded when it connects.
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      connectDevtools(store, { extension });

      expect(extension.connection.inits).toEqual([{ count: 0 }]);
      expect(extension.connection.log).toEqual(['counter/a', 'counter/b']);
    });

    it('sends each subsequent transition', () => {
      connectDevtools(store, { extension });

      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      expect(extension.connection.log).toEqual(['counter/a', 'counter/b']);
      expect(extension.connection.sent[1].state).toEqual({ count: 2 });
    });

    it('does not send anything for programmatic time travel', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });

      store.undo();
      store.redo();

      expect(extension.connection.log).toEqual(['counter/a']);
    });

    it('re-inits rather than appending when the store rebases', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });

      store.commit();

      expect(extension.connection.inits).toEqual([{ count: 0 }, { count: 1 }]);
      // The log restarts: the ids the monitor held are gone with the old history.
      expect(extension.connection.log).toEqual(['counter/a']);
    });

    it('stops sending after disconnect', () => {
      const disconnect = connectDevtools(store, { extension });

      disconnect();
      store.patch('counter/a', { count: 1 });

      expect(extension.connection.log).toEqual([]);
      expect(extension.connection.dispatch(jumpTo(0))).toBe(false);
    });
  });

  describe('monitor to store', () => {
    it('jumps to the state behind an action id', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      // Action 0 is the `init`; 1 and 2 are the two sends.
      extension.connection.dispatch(jumpTo(1));

      expect(store.state()).toEqual({ count: 1 });
      expect(store.cursor()).toBe(1);
    });

    it('accepts JUMP_TO_STATE, which carries an index instead of an actionId', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });

      extension.connection.dispatch({
        type: 'DISPATCH',
        payload: { type: 'JUMP_TO_STATE', index: 0 },
      });

      expect(store.state()).toEqual({ count: 0 });
    });

    it('reports a jump to an action id it never sent', () => {
      connectDevtools(store, { extension });

      extension.connection.dispatch(jumpTo(7));

      expect(extension.connection.errors).toEqual([
        jasmine.stringContaining('no action 7 in this session'),
      ]);
      expect(store.cursor()).toBe(0);
    });

    it('reports a jump to an entry the store has trimmed away', () => {
      // This is why the bridge maps ids instead of trusting the monitor's numbering.
      // With room for two entries, the third write drops `@@init` — so the monitor
      // still offers action 0 and the store can no longer produce it. Under a naive
      // `history()[actionId]` this would silently land on the wrong state.
      const trimmed = createSignalStore<CounterState>({ count: 0 }, { historyLimit: 2 });
      connectDevtools(trimmed, { extension });
      trimmed.patch('counter/a', { count: 1 });
      trimmed.patch('counter/b', { count: 2 });

      extension.connection.dispatch(jumpTo(0));

      expect(extension.connection.errors).toEqual([jasmine.stringContaining('has been trimmed')]);
      expect(trimmed.state()).toEqual({ count: 2 });
    });

    it('ignores a jump with neither an actionId nor an index', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });

      extension.connection.dispatch({ type: 'DISPATCH', payload: { type: 'JUMP_TO_ACTION' } });

      expect(store.cursor()).toBe(1);
      expect(extension.connection.errors).toEqual([]);
    });

    it('resets the store and re-seeds the monitor exactly once', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });

      extension.connection.dispatch(dispatch('RESET'));

      expect(store.state()).toEqual({ count: 0 });
      // Two inits total, not three: the rebase the reset itself emits is suppressed
      // while the bridge is applying a monitor-driven change.
      expect(extension.connection.inits.length).toBe(2);
      expect(extension.connection.log).toEqual(['counter/a']);
    });

    it('commits the current state as the new baseline', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });

      extension.connection.dispatch(dispatch('COMMIT'));

      expect(store.state()).toEqual({ count: 1 });
      expect(store.canUndo()).toBe(false);
      expect(extension.connection.inits).toEqual([{ count: 0 }, { count: 1 }]);
    });

    it('rolls back to the oldest state the store still holds', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });
      store.patch('counter/b', { count: 2 });

      extension.connection.dispatch(dispatch('ROLLBACK'));

      expect(store.state()).toEqual({ count: 0 });
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
    });

    it('refuses IMPORT_STATE with a reason, leaving the store alone', () => {
      connectDevtools(store, { extension });
      store.patch('counter/a', { count: 1 });

      extension.connection.dispatch(dispatch('IMPORT_STATE'));

      expect(extension.connection.errors).toEqual([
        jasmine.stringContaining('importing a session is not supported'),
      ]);
      expect(store.state()).toEqual({ count: 1 });
    });

    it('refuses a hand-dispatched ACTION with a reason', () => {
      connectDevtools(store, { extension });

      extension.connection.dispatch({ type: 'ACTION', payload: { type: 'counter/whatever' } });

      expect(extension.connection.errors).toEqual([
        jasmine.stringContaining('dispatching actions from the monitor is not supported'),
      ]);
    });

    it('ignores messages it has no handler for', () => {
      connectDevtools(store, { extension });

      extension.connection.dispatch({ type: 'START' });
      extension.connection.dispatch(dispatch('PAUSE_RECORDING'));

      expect(extension.connection.errors).toEqual([]);
      expect(store.cursor()).toBe(0);
    });
  });
});
