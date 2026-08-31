import type { HttpEvent, HttpResponse } from '@angular/common/http';
import { InjectionToken, Injectable, inject } from '@angular/core';
import { finalize, shareReplay, type Observable } from 'rxjs';
import { HTTP_CLOCK } from './interceptors/request-trace';

/** Bounds on what {@link HttpCache} will hold and for how long. */
export interface HttpCacheConfig {
  /**
   * How many responses to keep. The least recently *used* entry is evicted past this,
   * not the least recently written: a page polling one endpoint should not be able to
   * push out the reference data every page reads.
   */
  readonly maxEntries: number;

  /**
   * Ceiling on any entry's lifetime, however long the server or the call site asked
   * for. A `max-age` measured in days is a statement about a shared CDN cache; this one
   * lives in a tab that will be reloaded, and honouring it literally would mean serving
   * yesterday's data to someone who has been looking at the same page since.
   */
  readonly maxTtlMs: number;
}

export const DEFAULT_HTTP_CACHE_CONFIG: HttpCacheConfig = {
  maxEntries: 100,
  maxTtlMs: 5 * 60_000,
};

export const HTTP_CACHE_CONFIG = new InjectionToken<HttpCacheConfig>('HTTP_CACHE_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_HTTP_CACHE_CONFIG,
});

interface CacheEntry {
  readonly response: HttpResponse<unknown>;
  readonly expiresAt: number;
}

/**
 * The storage behind `cacheInterceptor`: an in-memory, per-tab, LRU-bounded map of
 * responses, plus a registry of the requests currently in flight.
 *
 * Separate from the interceptor because the two answer different questions. The
 * interceptor decides *whether* a request may be cached — a policy question, about
 * methods and `Cache-Control` and per-call overrides. This decides what happens to a
 * response once that has been settled: how long it lives, what it displaces, and
 * whether a second caller asking for the same thing right now gets its own round trip
 * or joins the first one's.
 *
 * Nothing here is persisted. Responses to authenticated requests are held in the same
 * process that already holds the access token, and the default cache key includes the
 * `Authorization` header, so a response fetched for one identity is never a hit for
 * another — including after a sign-out, when the header is gone and the key no longer
 * matches. Stale entries for the previous session age out by TTL and eviction.
 */
@Injectable({ providedIn: 'root' })
export class HttpCache {
  private readonly clock = inject(HTTP_CLOCK);
  private readonly config = inject(HTTP_CACHE_CONFIG);

  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Observable<HttpEvent<unknown>>>();

  /** Entries currently held, expired ones included until something asks for them. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * The stored response for `key`, or `null` if there is none or it has expired.
   *
   * A hit is re-inserted so it becomes the most recently used entry — this is the
   * "used" half of LRU, and the reason `Map` insertion order can stand in for a
   * recency list.
   */
  read(key: string): HttpResponse<unknown> | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;

    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.response;
  }

  /**
   * Stores `response` under `key` for `ttlMs`, evicting the least recently used entry
   * if that takes the cache past `maxEntries`.
   *
   * The response is stored by reference and handed out by reference: every hit shares
   * one body object. Callers that mutate a response body would see the mutation on the
   * next hit, so they must not — the same rule that already applies to a body shared
   * between two components subscribed to one request.
   */
  write(key: string, response: HttpResponse<unknown>, ttlMs: number): void {
    if (ttlMs <= 0) return;

    // Delete first so a rewrite moves to the end of the insertion order rather than
    // keeping the original position and being evicted while it is the freshest thing
    // in the cache.
    this.entries.delete(key);
    this.entries.set(key, { response, expiresAt: this.clock() + ttlMs });

    while (this.entries.size > this.config.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  /** The in-flight request for `key`, or `null` if nothing is outstanding. */
  pending(key: string): Observable<HttpEvent<unknown>> | null {
    return this.inFlight.get(key) ?? null;
  }

  /**
   * Registers `request$` as the in-flight request for `key` and returns the shareable
   * form of it that {@link pending} will hand to later callers.
   *
   * `refCount: true` keeps cancellation working: if every subscriber unsubscribes — a
   * component destroyed, a `switchMap` superseding the request — the underlying HTTP
   * request is aborted, exactly as it would be without this decorator. The cost is that
   * the shared observable is single-use once that has happened, which is why `finalize`
   * unregisters it: the next caller starts a fresh request instead of subscribing to a
   * corpse.
   *
   * `finalize` runs on completion too. By then the response, if it was cacheable at
   * all, is in `entries`, and the dedup registry has nothing left to say about the key.
   *
   * The replay buffer is unbounded because what it holds is one request's event
   * sequence — `Sent` and then the response — and a caller that joined late should see
   * the same sequence as the one that started it, not just the newest event. Two
   * entries is not a memory concern; a partial event stream is a correctness one.
   */
  track(key: string, request$: Observable<HttpEvent<unknown>>): Observable<HttpEvent<unknown>> {
    const shared = request$.pipe(
      finalize(() => this.inFlight.delete(key)),
      shareReplay({ bufferSize: Infinity, refCount: true })
    );

    this.inFlight.set(key, shared);
    return shared;
  }

  /**
   * Drops every stored response. In-flight requests are left alone — they have
   * subscribers waiting on them, and cancelling those is not what "clear the cache"
   * means.
   */
  clear(): void {
    this.entries.clear();
  }
}
