import {
  HttpClient,
  HttpContext,
  HttpHeaders,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CACHE_OVERRIDE, cacheInterceptor, defaultHttpCacheKey } from './cache.interceptor';
import { HTTP_CACHE_CONFIG, HttpCache } from '../http-cache';
import { HTTP_CLOCK, REQUEST_TRACE } from './request-trace';

const CACHEABLE = { 'Cache-Control': 'max-age=60' };

describe('cacheInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let now: number;

  beforeEach(() => {
    now = 1_000;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([cacheInterceptor])),
        provideHttpClientTesting(),
        { provide: HTTP_CLOCK, useValue: () => now },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  /** Issues a GET, answers it, and returns the body the caller saw. */
  function fetch(url: string, headers: Record<string, string> = CACHEABLE): unknown {
    let body: unknown = null;
    http.get(url).subscribe((res) => (body = res));
    controller.expectOne(url).flush({ url }, { headers: new HttpHeaders(headers) });
    return body;
  }

  it('serves a second identical request from the cache without a round trip', () => {
    expect(fetch('/api/posts')).toEqual({ url: '/api/posts' });

    let body: unknown = null;
    http.get('/api/posts').subscribe((res) => (body = res));

    controller.expectNone('/api/posts');
    expect(body).toEqual({ url: '/api/posts' });
  });

  it('does not store a response the server did not mark cacheable', () => {
    fetch('/api/posts', {});

    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
  });

  it('does not store a response the server marked no-store', () => {
    fetch('/api/posts', { 'Cache-Control': 'no-store, max-age=60' });

    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
  });

  // `no-cache` permits storage but demands revalidation, which this cache cannot do.
  it('does not store a response the server marked no-cache', () => {
    fetch('/api/posts', { 'Cache-Control': 'no-cache' });

    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
  });

  it('re-fetches once the max-age has elapsed', () => {
    fetch('/api/posts', { 'Cache-Control': 'max-age=1' });

    now += 1_001;
    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
  });

  it('keys on the query string, so two searches do not share an entry', () => {
    http.get('/api/posts', { params: { q: 'a' } }).subscribe();
    controller.expectOne('/api/posts?q=a').flush({}, { headers: new HttpHeaders(CACHEABLE) });

    http.get('/api/posts', { params: { q: 'b' } }).subscribe();
    controller.expectOne('/api/posts?q=b').flush({}, { headers: new HttpHeaders(CACHEABLE) });
  });

  it('never caches a mutating request', () => {
    http.post('/api/posts', {}).subscribe();
    controller.expectOne('/api/posts').flush({}, { headers: new HttpHeaders(CACHEABLE) });

    http.post('/api/posts', {}).subscribe();
    controller.expectOne('/api/posts').flush({});
  });

  it('collapses two concurrent identical requests into one round trip', () => {
    const bodies: unknown[] = [];
    http.get('/api/posts').subscribe((res) => bodies.push(res));
    http.get('/api/posts').subscribe((res) => bodies.push(res));

    controller.expectOne('/api/posts').flush({ ok: true });

    expect(bodies).toEqual([{ ok: true }, { ok: true }]);
  });

  it('lets the next caller start a fresh request once the shared one has ended', () => {
    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({}, { headers: new HttpHeaders({}) });

    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
  });

  it('cancels the underlying request when every subscriber has walked away', () => {
    const first = http.get('/api/posts').subscribe();
    const second = http.get('/api/posts').subscribe();
    const request = controller.expectOne('/api/posts');

    first.unsubscribe();
    expect(request.cancelled).toBeFalse();

    second.unsubscribe();
    expect(request.cancelled).toBeTrue();
  });

  it('caches for the TTL a call site names, whatever the response headers say', () => {
    const context = new HttpContext().set(CACHE_OVERRIDE, { ttlMs: 30_000 });
    http.get('/api/posts', { context }).subscribe();
    controller.expectOne('/api/posts').flush({ ok: true });

    let body: unknown = null;
    http.get('/api/posts').subscribe((res) => (body = res));

    controller.expectNone('/api/posts');
    expect(body).toEqual({ ok: true });
  });

  it('takes a bypassed request out of the decorator entirely', () => {
    fetch('/api/posts');

    const context = new HttpContext().set(CACHE_OVERRIDE, { bypass: true });
    http.get('/api/posts', { context }).subscribe();

    controller.expectOne('/api/posts').flush({});
  });

  it('bypasses a progress-reporting request, which has no replayable event stream', () => {
    http.get('/api/report', { reportProgress: true, observe: 'events' }).subscribe();
    controller.expectOne('/api/report').flush({}, { headers: new HttpHeaders(CACHEABLE) });

    http.get('/api/report', { reportProgress: true, observe: 'events' }).subscribe();
    controller.expectOne('/api/report').flush({});
  });

  it('does not store a 204, which has nothing to replay', () => {
    http.get('/api/posts').subscribe();
    controller
      .expectOne('/api/posts')
      .flush(null, { status: 204, statusText: 'No Content', headers: new HttpHeaders(CACHEABLE) });

    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
  });

  it('clamps a max-age beyond the configured ceiling', () => {
    TestBed.resetTestingModule();
    now = 1_000;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([cacheInterceptor])),
        provideHttpClientTesting(),
        { provide: HTTP_CLOCK, useValue: () => now },
        { provide: HTTP_CACHE_CONFIG, useValue: { maxEntries: 10, maxTtlMs: 2_000 } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);

    fetch('/api/posts', { 'Cache-Control': 'max-age=3600' });

    now += 2_001;
    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
  });

  describe('request trace', () => {
    function traceFor(url: string, headers: Record<string, string> = CACHEABLE): HttpContext {
      const context = new HttpContext();
      http.get(url, { context }).subscribe();
      controller.expectOne(url).flush({}, { headers: new HttpHeaders(headers) });
      return context;
    }

    it('reports a miss on the request that populated the cache', () => {
      expect(traceFor('/api/posts').get(REQUEST_TRACE).cache).toBe('miss');
    });

    it('reports a hit on the request served from it', () => {
      traceFor('/api/posts');

      const context = new HttpContext();
      http.get('/api/posts', { context }).subscribe();

      expect(context.get(REQUEST_TRACE).cache).toBe('hit');
    });

    it('reports a dedup on a request that joined one in flight', () => {
      http.get('/api/posts').subscribe();

      const context = new HttpContext();
      http.get('/api/posts', { context }).subscribe();
      expect(context.get(REQUEST_TRACE).cache).toBe('dedup');

      controller.expectOne('/api/posts').flush({});
    });

    it('reports a bypass on a request the decorator never considered', () => {
      const context = new HttpContext();
      http.post('/api/posts', {}, { context }).subscribe();
      controller.expectOne('/api/posts').flush({});

      expect(context.get(REQUEST_TRACE).cache).toBe('bypass');
    });
  });
});

describe('defaultHttpCacheKey', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  /** The request object as the chain would see it, without running any interceptor. */
  function capture(
    url: string,
    options: { headers?: Record<string, string>; params?: Record<string, string> } = {}
  ): string {
    http.get(url, { headers: options.headers, params: options.params }).subscribe();
    const request = controller.expectOne(() => true);
    request.flush({});
    return defaultHttpCacheKey(request.request);
  }

  it('separates two identities asking for the same URL', () => {
    const asAlice = capture('/api/me', { headers: { Authorization: 'Bearer mock-token-alice' } });
    const asBob = capture('/api/me', { headers: { Authorization: 'Bearer mock-token-bob' } });

    expect(asAlice).not.toBe(asBob);
  });

  it('separates an authenticated request from an anonymous one', () => {
    const authenticated = capture('/api/me', {
      headers: { Authorization: 'Bearer mock-token-alice' },
    });
    const anonymous = capture('/api/me');

    expect(authenticated).not.toBe(anonymous);
  });

  it('separates two query strings', () => {
    expect(capture('/api/posts', { params: { q: 'a' } })).not.toBe(
      capture('/api/posts', { params: { q: 'b' } })
    );
  });

  it('gives the same request the same key twice', () => {
    expect(capture('/api/posts')).toBe(capture('/api/posts'));
  });
});

describe('HttpCache wiring', () => {
  it('is a root singleton the application can clear', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([cacheInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    const http = TestBed.inject(HttpClient);
    const controller = TestBed.inject(HttpTestingController);
    const cache = TestBed.inject(HttpCache);

    http.get('/api/posts').subscribe();
    controller
      .expectOne('/api/posts')
      .flush({}, { headers: new HttpHeaders({ 'Cache-Control': 'max-age=60' }) });
    expect(cache.size).toBe(1);

    cache.clear();

    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
    controller.verify();
  });
});
