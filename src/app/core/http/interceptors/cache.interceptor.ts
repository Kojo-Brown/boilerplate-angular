import {
  HttpContextToken,
  HttpEventType,
  type HttpInterceptorFn,
  type HttpRequest,
  type HttpResponse,
} from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';
import { of, tap } from 'rxjs';
import { HTTP_CACHE_CONFIG, HttpCache, type HttpCacheConfig } from '../http-cache';
import { REQUEST_TRACE } from './request-trace';

/** Derives the identity under which a request's response is stored. */
export type HttpCacheKeyFn = (request: HttpRequest<unknown>) => string;

/**
 * The default key: method, URL with its query string, and the `Authorization` header.
 *
 * The header is part of the key rather than a reason to refuse caching, because it is
 * the only thing distinguishing two otherwise identical requests made as two different
 * people. Leaving it out would make `/users/me` a single cache slot shared by every
 * identity the tab has held.
 *
 * No other request header is considered. A `Vary` response header naming one — a
 * `Accept-Language` that changes the body, say — is not honoured, so an application
 * that varies on more than the credential should provide a key function that says so.
 */
export const defaultHttpCacheKey: HttpCacheKeyFn = (request) =>
  `${request.method.toUpperCase()} ${request.urlWithParams}\n${request.headers.get('Authorization') ?? ''}`;

export const HTTP_CACHE_KEY = new InjectionToken<HttpCacheKeyFn>('HTTP_CACHE_KEY', {
  providedIn: 'root',
  factory: () => defaultHttpCacheKey,
});

/**
 * A per-request decision that outranks what the response's headers say.
 *
 * `{ ttlMs }` caches the response for that long whatever `Cache-Control` it carries —
 * for the very common API that sends no cache headers at all and whose staleness
 * budget only the caller knows. `{ bypass: true }` takes the request out of the
 * decorator entirely: no lookup, no dedup, no store.
 */
export type CacheOverride = { readonly ttlMs: number } | { readonly bypass: true };

export const CACHE_OVERRIDE = new HttpContextToken<CacheOverride | null>(() => null);

/**
 * Serves a stored response when there is a fresh one, joins an identical request
 * already in flight when there is one, and otherwise stores what comes back if the
 * response says it may be stored.
 *
 * Sits beneath `jwtInterceptor` so that the request it keys on is the one that will
 * actually be sent, `Authorization` header included, and above `retryInterceptor` so
 * that a cache hit is never retried and a retried attempt does not each write a
 * separate entry.
 *
 * Nothing is cached by default. A response is only stored when the server sends a
 * `Cache-Control: max-age` — or when the call site overrides that with an explicit
 * `ttlMs` — so adding this decorator to an application whose API sends no cache headers
 * changes exactly one thing: two identical GETs issued at the same moment become one
 * round trip. That is deliberate. A decorator that guessed a TTL would be inventing a
 * freshness guarantee nobody made, and the failure mode — a stale page after a write
 * that succeeded — looks like a bug in the write.
 *
 * A cache hit emits the `HttpResponse` alone, with no preceding `HttpEventType.Sent`:
 * nothing was sent. Callers using `observe: 'events'` to drive an activity indicator
 * should therefore opt out with `{ bypass: true }`; `reportProgress` requests are
 * bypassed automatically, since a replayed response has no progress to report.
 */
export const cacheInterceptor: HttpInterceptorFn = (req, next) => {
  const cache = inject(HttpCache);
  const config = inject(HTTP_CACHE_CONFIG);
  const keyOf = inject(HTTP_CACHE_KEY);
  const trace = req.context.get(REQUEST_TRACE);
  const override = req.context.get(CACHE_OVERRIDE);

  if (!isCacheCandidate(req, override)) {
    trace.cache = 'bypass';
    return next(req);
  }

  const key = keyOf(req);

  const cached = cache.read(key);
  if (cached !== null) {
    trace.cache = 'hit';
    return of(cached);
  }

  const pending = cache.pending(key);
  if (pending !== null) {
    trace.cache = 'dedup';
    return pending;
  }

  trace.cache = 'miss';
  return cache.track(
    key,
    next(req).pipe(
      tap((event) => {
        if (event.type !== HttpEventType.Response) return;
        const ttlMs = storableTtlMs(event, override, config);
        if (ttlMs !== null) cache.write(key, event, ttlMs);
      })
    )
  );
};

/**
 * Whether the decorator should involve itself in this request at all.
 *
 * Read-only methods only: a cache that answered a `POST` from a stored response would
 * be skipping a write. `HEAD` is included and keyed separately from `GET`, so a
 * body-less response can never be served to a caller that asked for a body.
 */
function isCacheCandidate(req: HttpRequest<unknown>, override: CacheOverride | null): boolean {
  if (override !== null && 'bypass' in override) return false;
  if (req.reportProgress) return false;
  return req.method.toUpperCase() === 'GET' || req.method.toUpperCase() === 'HEAD';
}

/**
 * How long this response may be held, or `null` if it may not be held at all.
 *
 * Only `200` is stored. A `204` has nothing to store; `206` is a fragment whose range
 * the key does not capture; a `3xx` that reached here has already been followed by the
 * browser. Statuses outside 2xx never arrive as a response event in the first place.
 */
function storableTtlMs(
  response: HttpResponse<unknown>,
  override: CacheOverride | null,
  config: HttpCacheConfig
): number | null {
  if (response.status !== 200) return null;

  if (override !== null && 'ttlMs' in override) {
    return override.ttlMs > 0 ? Math.min(override.ttlMs, config.maxTtlMs) : null;
  }

  const directives = parseCacheControl(response.headers.get('Cache-Control'));

  // `no-cache` permits storage but requires revalidation before reuse, and this cache
  // has no revalidation step — no conditional request, no `ETag` handling. Treating it
  // as "do not store" is the only reading that cannot serve a response the server said
  // to check first.
  if (directives.has('no-store') || directives.has('no-cache')) return null;

  const maxAge = Number(directives.get('max-age'));
  if (!Number.isFinite(maxAge) || maxAge <= 0) return null;

  return Math.min(maxAge * 1000, config.maxTtlMs);
}

/**
 * `Cache-Control` as a directive map, valueless directives mapping to the empty string.
 *
 * Directive names are case-insensitive per RFC 9111 and are lower-cased here; a quoted
 * value has its quotes stripped. Nothing beyond splitting is attempted — a malformed
 * header yields directives that no caller matches, which lands on "do not store".
 */
function parseCacheControl(header: string | null): Map<string, string> {
  const directives = new Map<string, string>();
  if (header === null) return directives;

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    const name = (separator === -1 ? part : part.slice(0, separator)).trim().toLowerCase();
    if (name === '') continue;

    const value =
      separator === -1
        ? ''
        : part
            .slice(separator + 1)
            .trim()
            .replace(/^"|"$/g, '');
    directives.set(name, value);
  }

  return directives;
}
