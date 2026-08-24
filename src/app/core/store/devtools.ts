import type { SignalStore, StoreEvent, Transition } from './signal-store';

/**
 * The slice of the Redux DevTools Extension protocol this bridge uses.
 *
 * Hand-written rather than pulled from `@redux-devtools/extension`: that package exists
 * to be imported by a *store*, and pulls in the whole lifted-state model to type an
 * object the extension injects into `window`. Four methods and one message union is the
 * entire surface here, and typing them locally keeps a devtools-only dependency out of
 * `package.json` — the extension is either installed in the developer's browser or it is
 * not, and no npm package changes that.
 */
export interface ReduxDevtoolsConnection {
  /** Seed the monitor with a state and clear its action log. Action id 0. */
  init(state: unknown): void;
  /** Append an action and the state it produced. Ids count up from 1 after each `init`. */
  send(action: { type: string }, state: unknown): void;
  /** Listen for monitor-driven messages. Returns an unsubscribe function. */
  subscribe(listener: (message: DevtoolsMessage) => void): () => void;
  /** Surface a message in the monitor rather than the console. */
  error(message: string): void;
}

export interface ReduxDevtoolsExtension {
  connect(options: { name?: string; maxAge?: number }): ReduxDevtoolsConnection;
}

/**
 * Monitor-driven messages. `DISPATCH` is the only kind this bridge acts on; the payload
 * union covers the buttons the monitor actually offers.
 */
export interface DevtoolsMessage {
  readonly type: string;
  readonly payload?: {
    readonly type?: string;
    /** Set by `JUMP_TO_ACTION`: the id of the action to jump to. */
    readonly actionId?: number;
    /** Set by `JUMP_TO_STATE`: the *index* in the monitor's log, which is the same thing. */
    readonly index?: number;
  };
}

declare global {
  /**
   * Declared rather than cast at the call site: the extension really does add this to
   * `window`, and a `as` on every read would be four casts hiding one fact.
   */
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION__?: ReduxDevtoolsExtension;
  }
}

export interface DevtoolsOptions {
  /**
   * Instance name shown in the monitor's dropdown. Defaults to the store's `name`.
   * Two stores connected under one name share a log, which is rarely what you want.
   */
  name?: string;
  /**
   * Explicit extension object, for tests. Defaults to `window.__REDUX_DEVTOOLS_EXTENSION__`.
   */
  extension?: ReduxDevtoolsExtension;
}

/**
 * Bridge a {@link SignalStore} to the Redux DevTools browser extension, including
 * working time travel in both directions.
 *
 * Returns a disconnect function. Call it on teardown — `inject(DestroyRef).onDestroy(...)`
 * in a service — or the store keeps a listener alive for the life of the page.
 *
 * ```ts
 * const disconnect = connectDevtools(store);
 * inject(DestroyRef).onDestroy(disconnect);
 * ```
 *
 * ## It is a no-op when the extension is absent
 *
 * No extension — production, CI, a browser without it installed — and this returns a
 * disconnect function that does nothing, having subscribed to nothing. Callers do not
 * need to guard the call, only to avoid *shipping* it: `ThemeService` reaches this
 * module through a dynamic `import()`, so the bridge lands in its own lazy chunk and a
 * production bundle never loads it at all.
 *
 * ## Connecting late replays the log
 *
 * Because that import is asynchronous, transitions can already have been recorded by the
 * time this runs. The bridge replays what it finds — `init` with the oldest entry, then
 * one `send` per entry after it — so the monitor opens on the store's real history
 * rather than on whatever happened to be current when the chunk finished loading.
 *
 * ## Action ids are mapped, not assumed
 *
 * The monitor numbers actions sequentially from its own `init`; the store numbers
 * transitions monotonically and trims old ones. Those two sequences agree right up until
 * the first trim or `reset()`, after which an unmapped jump would land on the wrong
 * state. So the bridge keeps `sentIds`, in monitor order, and resolves every jump
 * through it. A jump to an entry the store has already trimmed away reports into the
 * monitor via `connection.error` instead of silently doing nothing.
 *
 * ## What is deliberately not supported
 *
 * - `IMPORT_STATE` (uploading a session JSON) would have to widen arbitrary parsed JSON
 *   into `T`. There is no runtime schema here to validate it against, so honouring it
 *   would mean an unchecked cast that could put a shape into the store no type in the
 *   app admits. It is rejected with a message in the monitor instead.
 * - `ACTION` (dispatching a hand-written action from the monitor) has the same problem
 *   and the same answer: this store has no action registry to look a dispatched name up
 *   in, only labels attached to writes that already happened.
 * - Programmatic travel — `store.undo()` from app code — does not move the monitor's
 *   cursor, because the protocol is one-way for cursor position. The monitor shows the
 *   log correctly; only its highlighted row can lag.
 */
export function connectDevtools<T extends object>(
  store: SignalStore<T>,
  options: DevtoolsOptions = {}
): () => void {
  const extension =
    options.extension ??
    (typeof window === 'undefined' ? undefined : window.__REDUX_DEVTOOLS_EXTENSION__);

  if (!extension) {
    return () => {
      /* No extension installed: nothing was connected, so there is nothing to undo. */
    };
  }

  const connection = extension.connect({ name: options.name ?? store.name });

  /** Store transition ids, indexed by the monitor's action id. Rebuilt on every `init`. */
  let sentIds: number[] = [];
  /** True while applying a monitor-driven change, so the echo is not sent straight back. */
  let applying = false;

  function seed(entries: readonly Transition<T>[]): void {
    const [first, ...rest] = entries;
    connection.init(first.state);
    sentIds = [first.id];
    for (const entry of rest) {
      connection.send({ type: entry.label }, entry.state);
      sentIds.push(entry.id);
    }
  }

  seed(store.history());

  const unsubscribeStore = store.subscribe((event: StoreEvent<T>) => {
    if (applying) return;
    switch (event.kind) {
      case 'transition':
        connection.send({ type: event.transition.label }, event.state);
        sentIds.push(event.transition.id);
        break;
      case 'rebase':
        // `reset`/`commit` invalidate every id the monitor holds, so the log is rebuilt
        // rather than appended to.
        seed(store.history());
        break;
      case 'travel':
        // One-way protocol: there is no message that moves the monitor's cursor.
        break;
    }
  });

  function jump(actionId: number): void {
    // `.at`, not `sentIds[actionId]`: without `noUncheckedIndexedAccess` the indexed
    // read is typed `number` and the missing-entry branch below would be unreachable
    // as far as the compiler is concerned. `.at` returns `number | undefined` honestly.
    const transitionId = sentIds.at(actionId);
    if (transitionId === undefined) {
      connection.error(`${store.name}: no action ${actionId} in this session.`);
      return;
    }
    const index = store.history().findIndex((entry) => entry.id === transitionId);
    if (index === -1) {
      connection.error(
        `${store.name}: action ${actionId} has been trimmed from the store's history (historyLimit).`
      );
      return;
    }
    store.jumpTo(index);
  }

  const unsubscribeConnection = connection.subscribe((message: DevtoolsMessage) => {
    if (message.type !== 'DISPATCH') {
      if (message.type === 'ACTION') {
        connection.error(
          `${store.name}: dispatching actions from the monitor is not supported — this store has no action registry, only labels recorded on writes that already happened.`
        );
      }
      return;
    }

    const payload = message.payload;
    applying = true;
    try {
      switch (payload?.type) {
        case 'JUMP_TO_ACTION':
        case 'JUMP_TO_STATE': {
          const actionId = payload.actionId ?? payload.index;
          if (actionId === undefined) return;
          jump(actionId);
          break;
        }
        case 'RESET':
          store.reset();
          seed(store.history());
          break;
        case 'COMMIT':
          store.commit();
          seed(store.history());
          break;
        case 'ROLLBACK':
          // Redux's rollback goes to the last committed state, which for this store is
          // the oldest entry it still holds — `commit()` leaves exactly one behind.
          store.jumpTo(0);
          store.commit();
          seed(store.history());
          break;
        case 'IMPORT_STATE':
          connection.error(
            `${store.name}: importing a session is not supported — the uploaded state is arbitrary JSON and there is no schema here to validate it against.`
          );
          break;
        default:
          break;
      }
    } finally {
      applying = false;
    }
  });

  return () => {
    unsubscribeStore();
    unsubscribeConnection();
  };
}
