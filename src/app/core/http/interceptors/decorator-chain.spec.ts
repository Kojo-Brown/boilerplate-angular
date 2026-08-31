import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { composeInterceptors, interceptWhen, requestsUnder } from './compose';
import { cacheInterceptor } from './cache.interceptor';
import { DEFAULT_RETRY_POLICY, RETRY_POLICY, retryInterceptor } from './retry.interceptor';
import { HTTP_TELEMETRY_SINK, telemetryInterceptor, type HttpSpan } from './telemetry.interceptor';
import { HTTP_CLOCK } from './request-trace';

/**
 * The three decorators as `app.config.ts` composes them, checked together rather than
 * one at a time.
 *
 * Each of the three has its own spec proving it does its own job. What only shows up
 * here is that they add up: that a retried attempt is one cache entry and one telemetry
 * span rather than three of each, and that the span reports what the two decorators
 * beneath it did — which is the thing the `HttpContext` trace exists for and the thing
 * that silently stops working if anyone reorders the chain.
 */
describe('the composed HTTP decorator chain', () => {
  const API = 'http://localhost:3000/api/v1';
  const CACHEABLE = new HttpHeaders({ 'Cache-Control': 'max-age=60' });

  let http: HttpClient;
  let controller: HttpTestingController;
  let recorded: HttpSpan[];
  let now: number;

  beforeEach(() => {
    recorded = [];
    now = 1_000;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withInterceptors([
            telemetryInterceptor,
            interceptWhen(
              requestsUnder(API),
              composeInterceptors(cacheInterceptor, retryInterceptor)
            ),
          ])
        ),
        provideHttpClientTesting(),
        { provide: HTTP_CLOCK, useValue: () => now },
        {
          provide: RETRY_POLICY,
          useValue: { ...DEFAULT_RETRY_POLICY, baseDelayMs: 100, jitter: (ms: number) => ms },
        },
        {
          provide: HTTP_TELEMETRY_SINK,
          useValue: { record: (span: HttpSpan) => recorded.push(span) },
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('reports one span for a request that took two attempts, and caches it once', fakeAsync(() => {
    let body: unknown = null;
    http.get(`${API}/posts`).subscribe((res) => (body = res));

    controller.expectOne(`${API}/posts`).flush(null, { status: 503, statusText: 'Unavailable' });
    tick(100);
    controller.expectOne(`${API}/posts`).flush({ ok: true }, { headers: CACHEABLE });

    expect(body).toEqual({ ok: true });
    expect(recorded.length).toBe(1);
    expect(recorded[0].outcome).toBe('success');
    expect(recorded[0].retries).toBe(1);

    // The retry re-subscribed the layer beneath the cache, not the cache itself, so
    // there is one entry and its outcome is still the original miss.
    expect(recorded[0].cache).toBe('miss');

    // And the entry the second attempt produced is the one a later caller gets.
    let cached: unknown = null;
    http.get(`${API}/posts`).subscribe((res) => (cached = res));
    expect(cached).toEqual({ ok: true });
    expect(recorded[1].cache).toBe('hit');
    expect(recorded[1].retries).toBe(0);
  }));

  it('includes the retry backoff in the duration the caller experienced', fakeAsync(() => {
    http.get(`${API}/posts`).subscribe({ error: () => undefined });

    controller.expectOne(`${API}/posts`).flush(null, { status: 503, statusText: 'Unavailable' });
    now += 100;
    tick(100);
    controller.expectOne(`${API}/posts`).flush(null, { status: 503, statusText: 'Unavailable' });
    now += 200;
    tick(200);
    controller.expectOne(`${API}/posts`).flush(null, { status: 503, statusText: 'Unavailable' });

    // 300ms of backoff that a decorator beneath the retry could not have seen.
    expect(recorded[0].durationMs).toBe(300);
    expect(recorded[0].outcome).toBe('error');
    expect(recorded[0].retries).toBe(2);
  }));

  it('measures a cache hit as a request that took no time and made no attempts', () => {
    http.get(`${API}/posts`).subscribe();
    controller.expectOne(`${API}/posts`).flush({ ok: true }, { headers: CACHEABLE });

    now += 5_000;
    http.get(`${API}/posts`).subscribe();

    expect(recorded[1].cache).toBe('hit');
    expect(recorded[1].durationMs).toBe(0);
    expect(recorded[1].status).toBe(200);
  });

  it('leaves a request outside the API untouched by cache and retry, but still measures it', () => {
    http.get('https://cdn.example.test/logo.svg').subscribe({ error: () => undefined });
    controller
      .expectOne('https://cdn.example.test/logo.svg')
      .flush(null, { status: 503, statusText: 'Unavailable' });

    // No second attempt, no cache involvement — and a span all the same, because
    // telemetry sits outside the scoping predicate.
    expect(recorded.length).toBe(1);
    expect(recorded[0].outcome).toBe('error');
    expect(recorded[0].retries).toBe(0);
    expect(recorded[0].cache).toBe('bypass');
  });

  it('reports both callers of a deduplicated request, and only one round trip', () => {
    http.get(`${API}/posts`).subscribe();
    http.get(`${API}/posts`).subscribe();

    controller.expectOne(`${API}/posts`).flush({ ok: true });

    expect(recorded.length).toBe(2);
    expect(recorded.map((span) => span.cache)).toEqual(['miss', 'dedup']);
  });
});
