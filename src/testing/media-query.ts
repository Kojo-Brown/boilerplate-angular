/**
 * Test double for `window.matchMedia`.
 *
 * Headless Chrome answers `matchMedia` from the real viewport, which a unit test cannot
 * resize. This replaces it with a registry the spec drives directly, and — because a
 * media-query listener that is never removed is exactly the leak `mediaQuerySignal`
 * exists to prevent — exposes the live listener count so a spec can assert teardown.
 */
export interface FakeMediaQuery {
  /** Change a query's result and notify every list currently listening for it. */
  set(query: string, matches: boolean): void;
  /** How many `change` listeners are registered for `query` right now. */
  listenerCount(query: string): number;
}

type ChangeListener = (event: MediaQueryListEvent) => void;

interface QueryState {
  matches: boolean;
  listeners: Set<ChangeListener>;
}

/**
 * Replace `window.matchMedia` with a controllable fake for the duration of the current
 * spec. Jasmine restores the original implementation afterwards.
 *
 * @param initial Result for each query. Queries absent from the map report `false`.
 */
export function installFakeMediaQuery(initial: Record<string, boolean> = {}): FakeMediaQuery {
  const states = new Map<string, QueryState>();
  const lists = new Map<string, MediaQueryList>();

  function stateFor(query: string): QueryState {
    const existing = states.get(query);
    if (existing !== undefined) return existing;

    const created: QueryState = { matches: initial[query] ?? false, listeners: new Set() };
    states.set(query, created);
    return created;
  }

  function listFor(query: string): MediaQueryList {
    const existing = lists.get(query);
    if (existing !== undefined) return existing;

    const state = stateFor(query);
    // Only the four members production code touches are implemented; the double cast
    // keeps the legacy `addListener`/`onchange` surface out of the fake.
    const created = {
      media: query,
      get matches(): boolean {
        return state.matches;
      },
      addEventListener: (_type: 'change', listener: ChangeListener): void => {
        state.listeners.add(listener);
      },
      removeEventListener: (_type: 'change', listener: ChangeListener): void => {
        state.listeners.delete(listener);
      },
      dispatchEvent: (): boolean => true,
    } as unknown as MediaQueryList;

    lists.set(query, created);
    return created;
  }

  spyOn(window, 'matchMedia').and.callFake(listFor);

  return {
    set(query: string, matches: boolean): void {
      const state = stateFor(query);
      state.matches = matches;
      const event = { matches, media: query } as MediaQueryListEvent;
      for (const listener of [...state.listeners]) listener(event);
    },
    listenerCount(query: string): number {
      return stateFor(query).listeners.size;
    },
  };
}
