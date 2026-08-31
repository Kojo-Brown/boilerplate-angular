import { HttpEventType, HttpResponse, type HttpEvent } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, defer } from 'rxjs';
import { HTTP_CACHE_CONFIG, HttpCache } from './http-cache';
import { HTTP_CLOCK } from './interceptors/request-trace';

describe('HttpCache', () => {
  let cache: HttpCache;
  let now: number;

  function configure(maxEntries = 3): void {
    now = 1_000;
    TestBed.configureTestingModule({
      providers: [
        { provide: HTTP_CLOCK, useValue: () => now },
        { provide: HTTP_CACHE_CONFIG, useValue: { maxEntries, maxTtlMs: 60_000 } },
      ],
    });
    cache = TestBed.inject(HttpCache);
  }

  function response(body: string): HttpResponse<unknown> {
    return new HttpResponse({ body, status: 200 });
  }

  beforeEach(() => configure());

  it('returns null for a key it has never seen', () => {
    expect(cache.read('a')).toBeNull();
  });

  it('returns a stored response inside its TTL', () => {
    cache.write('a', response('first'), 1_000);
    now += 999;

    expect(cache.read('a')?.body).toBe('first');
  });

  it('drops a stored response once its TTL has elapsed', () => {
    cache.write('a', response('first'), 1_000);
    now += 1_000;

    expect(cache.read('a')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('ignores a write with a non-positive TTL rather than storing something already stale', () => {
    cache.write('a', response('first'), 0);
    expect(cache.size).toBe(0);
  });

  it('replaces the response under an existing key', () => {
    cache.write('a', response('first'), 1_000);
    cache.write('a', response('second'), 1_000);

    expect(cache.size).toBe(1);
    expect(cache.read('a')?.body).toBe('second');
  });

  it('evicts the least recently used entry past maxEntries', () => {
    cache.write('a', response('a'), 10_000);
    cache.write('b', response('b'), 10_000);
    cache.write('c', response('c'), 10_000);

    // Touching 'a' makes 'b' the least recently used, so it goes and 'a' stays —
    // insertion order alone would have evicted 'a'.
    cache.read('a');
    cache.write('d', response('d'), 10_000);

    expect(cache.size).toBe(3);
    expect(cache.read('b')).toBeNull();
    expect(cache.read('a')?.body).toBe('a');
    expect(cache.read('c')?.body).toBe('c');
    expect(cache.read('d')?.body).toBe('d');
  });

  it('keeps a rewritten entry from being evicted while it is the freshest', () => {
    cache.write('a', response('a'), 10_000);
    cache.write('b', response('b'), 10_000);
    cache.write('c', response('c'), 10_000);
    cache.write('a', response('a2'), 10_000);

    cache.write('d', response('d'), 10_000);

    expect(cache.read('b')).toBeNull();
    expect(cache.read('a')?.body).toBe('a2');
  });

  it('drops every entry on clear', () => {
    cache.write('a', response('a'), 10_000);
    cache.write('b', response('b'), 10_000);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.read('a')).toBeNull();
  });

  describe('in-flight registry', () => {
    it('has nothing pending for an unknown key', () => {
      expect(cache.pending('a')).toBeNull();
    });

    it('registers the tracked request under its key', () => {
      const tracked = cache.track('a', new Subject<HttpEvent<unknown>>());
      expect(cache.pending('a')).toBe(tracked);
    });

    it('subscribes the source once however many callers join', () => {
      let subscriptions = 0;
      const source = defer(() => {
        subscriptions += 1;
        return new Subject<HttpEvent<unknown>>();
      });

      const tracked = cache.track('a', source);
      const first = tracked.subscribe();
      const second = cache.pending('a')?.subscribe();

      expect(subscriptions).toBe(1);

      first.unsubscribe();
      second?.unsubscribe();
    });

    it('replays to a joiner the events it missed', () => {
      const source = new Subject<HttpEvent<unknown>>();
      const tracked = cache.track('a', source);
      const held = tracked.subscribe();

      source.next({ type: HttpEventType.Sent });

      const seen: HttpEvent<unknown>[] = [];
      const joiner = cache.pending('a')?.subscribe((event) => seen.push(event));

      expect(seen).toEqual([{ type: HttpEventType.Sent }]);

      held.unsubscribe();
      joiner?.unsubscribe();
    });

    it('unregisters the request once it has ended', () => {
      const source = new Subject<HttpEvent<unknown>>();
      const held = cache.track('a', source).subscribe();

      expect(cache.pending('a')).not.toBeNull();
      source.complete();

      expect(cache.pending('a')).toBeNull();
      held.unsubscribe();
    });

    // Without this the registry would hand the next caller a shared observable whose
    // source has already been torn down.
    it('unregisters the request when the last subscriber walks away', () => {
      const source = new Subject<HttpEvent<unknown>>();
      const held = cache.track('a', source).subscribe();

      held.unsubscribe();

      expect(cache.pending('a')).toBeNull();
    });

    it('leaves in-flight requests alone on clear', () => {
      const source = new Subject<HttpEvent<unknown>>();
      const held = cache.track('a', source).subscribe();

      cache.clear();

      expect(cache.pending('a')).not.toBeNull();
      held.unsubscribe();
    });
  });
});
