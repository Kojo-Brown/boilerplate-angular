import { ApplicationRef, resource, signal } from '@angular/core';
import type { ResourceRef, Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AsyncSnapshot, QueryLike } from './async-snapshot';
import { querySnapshot, resourceSnapshot } from './async-snapshot';

interface Row {
  readonly id: string;
}

/** A promise whose settlement the spec controls, so a load can be held open. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('resourceSnapshot', () => {
  let id: WritableSignal<string | undefined>;
  let loads: { id: string; deferred: ReturnType<typeof deferred<Row>> }[];
  let ref: ResourceRef<Row | undefined>;
  let snapshot: Signal<AsyncSnapshot<Row>>;

  /** `resource` schedules its load through an effect; nothing runs until that flushes. */
  function flush(): void {
    TestBed.tick();
  }

  /** Wait for a load to make it all the way through, the way `posts.resource.spec.ts` does. */
  async function settle(): Promise<void> {
    await TestBed.inject(ApplicationRef).whenStable();
    flush();
  }

  /** The load the spec most recently started, so it can be resolved or rejected by hand. */
  function lastLoad(): ReturnType<typeof deferred<Row>> {
    const load = loads.at(-1);
    if (load === undefined) {
      throw new Error('Expected a load to have started.');
    }
    return load.deferred;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    id = signal<string | undefined>(undefined);
    loads = [];

    TestBed.runInInjectionContext(() => {
      ref = resource({
        params: () => id(),
        loader: ({ params }) => {
          const load = { id: params, deferred: deferred<Row>() };
          loads.push(load);
          return load.deferred.promise;
        },
      });
      snapshot = resourceSnapshot(ref);
    });
  });

  it('reports loading while the resource is idle for want of parameters', () => {
    flush();

    expect(ref.status()).toBe('idle');
    expect(snapshot()).toEqual({ kind: 'loading' });
  });

  it('reports loading while a load is in flight', () => {
    id.set('a');
    flush();

    expect(snapshot()).toEqual({ kind: 'loading' });
    lastLoad().resolve({ id: 'a' });
  });

  it('reports the value once the load resolves', async () => {
    id.set('a');
    flush();
    lastLoad().resolve({ id: 'a' });
    await settle();

    expect(snapshot()).toEqual({ kind: 'value', value: { id: 'a' } });
  });

  it('reports the error without ever reading the value', async () => {
    const failure = new Error('boom');
    id.set('a');
    flush();
    lastLoad().reject(failure);
    await settle();

    // What this asserts is as much that it *got here* as what it found: `ref.value()`
    // throws in the error state, so an adapter that read the value before the status
    // would fail on the call above rather than on this expectation.
    expect(ref.status()).toBe('error');
    expect(snapshot()).toEqual({ kind: 'error', error: failure });
  });

  it('holds the previous value through a reload instead of flashing a skeleton', async () => {
    id.set('a');
    flush();
    lastLoad().resolve({ id: 'a' });
    await settle();

    ref.reload();
    flush();

    expect(ref.status()).toBe('reloading');
    expect(snapshot()).toEqual({ kind: 'value', value: { id: 'a' } });
    lastLoad().resolve({ id: 'a' });
    await settle();
  });

  it('reports loading again when the parameters change, because the value is dropped', async () => {
    id.set('a');
    flush();
    lastLoad().resolve({ id: 'a' });
    await settle();

    id.set('b');
    flush();

    expect(snapshot()).toEqual({ kind: 'loading' });
    lastLoad().resolve({ id: 'b' });
    await settle();
  });
});

describe('querySnapshot', () => {
  let status: WritableSignal<'pending' | 'error' | 'success'>;
  let error: WritableSignal<unknown>;
  let data: WritableSignal<Row | undefined>;
  let query: QueryLike<Row>;
  let snapshot: Signal<AsyncSnapshot<Row>>;

  beforeEach(() => {
    // A stand-in for a TanStack query result, built from the three members `QueryLike`
    // declares. Writing it by hand is the point of the structural type: nothing under
    // `shared/` has to import the query library to be tested against its contract.
    status = signal<'pending' | 'error' | 'success'>('pending');
    error = signal<unknown>(null);
    data = signal<Row | undefined>(undefined);
    query = { status, error, data };
    snapshot = querySnapshot(query);
  });

  it('reports loading while the query is pending', () => {
    expect(snapshot()).toEqual({ kind: 'loading' });
  });

  it('reports loading for a disabled query, which is neither pending nor failed', () => {
    status.set('success');

    expect(snapshot()).toEqual({ kind: 'loading' });
  });

  it('reports the value once data arrives', () => {
    status.set('success');
    data.set({ id: 'a' });

    expect(snapshot()).toEqual({ kind: 'value', value: { id: 'a' } });
  });

  it('reports a failed refetch in preference to the data it left behind', () => {
    status.set('success');
    data.set({ id: 'stale' });
    const failure = new Error('refetch failed');
    status.set('error');
    error.set(failure);

    // The data is still there. A snapshot that asked "is there data?" first would report
    // a value, and the view would go on showing a stale row under a failure nobody
    // mentioned.
    expect(query.data()).toEqual({ id: 'stale' });
    expect(snapshot()).toEqual({ kind: 'error', error: failure });
  });

  it('tracks the query reactively rather than sampling it once', () => {
    expect(snapshot().kind).toBe('loading');

    status.set('success');
    data.set({ id: 'a' });

    expect(snapshot()).toEqual({ kind: 'value', value: { id: 'a' } });
  });
});
