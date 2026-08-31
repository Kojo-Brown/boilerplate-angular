import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  HttpHeaders,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  DEFAULT_RETRY_POLICY,
  RETRY_OVERRIDE,
  RETRY_POLICY,
  fullJitter,
  isRetryableFailure,
  retryDelayMs,
  retryInterceptor,
  type RetryPolicy,
} from './retry.interceptor';
import { REQUEST_TRACE } from './request-trace';

/** No jitter, so a spec can `tick` the exact backoff the policy computes. */
const TEST_POLICY: RetryPolicy = {
  ...DEFAULT_RETRY_POLICY,
  baseDelayMs: 100,
  jitter: (delayMs) => delayMs,
};

describe('retryInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  function setup(policy: RetryPolicy = TEST_POLICY): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([retryInterceptor])),
        provideHttpClientTesting(),
        { provide: RETRY_POLICY, useValue: policy },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  }

  /** Fails the outstanding request with `status`, then advances past its backoff. */
  function failAndWait(url: string, status: number, delayMs: number): void {
    controller.expectOne(url).flush(null, { status, statusText: 'Failed' });
    tick(delayMs);
  }

  it('retries a 503 and returns the response of the successful attempt', fakeAsync(() => {
    setup();
    let body: unknown = null;
    http.get('/api/posts').subscribe((res) => (body = res));

    failAndWait('/api/posts', 503, 100);
    controller.expectOne('/api/posts').flush({ ok: true });

    expect(body).toEqual({ ok: true });
    controller.verify();
  }));

  it('doubles the delay between attempts', fakeAsync(() => {
    setup();
    http.get('/api/posts').subscribe({ error: () => undefined });

    controller.expectOne('/api/posts').flush(null, { status: 503, statusText: 'Failed' });

    // Nothing is in flight while the first backoff is still running.
    tick(99);
    controller.expectNone('/api/posts');
    tick(1);

    controller.expectOne('/api/posts').flush(null, { status: 503, statusText: 'Failed' });
    tick(199);
    controller.expectNone('/api/posts');
    tick(1);

    controller.expectOne('/api/posts').flush(null, { status: 503, statusText: 'Failed' });
    controller.verify();
  }));

  it('gives up after maxRetries and surfaces the last failure', fakeAsync(() => {
    setup();
    let status = 0;
    http.get('/api/posts').subscribe({ error: (err: HttpErrorResponse) => (status = err.status) });

    failAndWait('/api/posts', 503, 100);
    failAndWait('/api/posts', 503, 200);
    controller.expectOne('/api/posts').flush(null, { status: 503, statusText: 'Failed' });

    expect(status).toBe(503);
    controller.verify();
  }));

  it('does not retry a status the policy excludes', fakeAsync(() => {
    setup();
    let status = 0;
    http.get('/api/posts').subscribe({ error: (err: HttpErrorResponse) => (status = err.status) });

    controller.expectOne('/api/posts').flush(null, { status: 404, statusText: 'Not Found' });
    tick(5_000);

    expect(status).toBe(404);
    controller.verify();
  }));

  it('does not retry a method the policy excludes', fakeAsync(() => {
    setup();
    http.post('/api/posts', { title: 'x' }).subscribe({ error: () => undefined });

    controller.expectOne('/api/posts').flush(null, { status: 503, statusText: 'Failed' });
    tick(5_000);

    controller.verify();
  }));

  it('honours a per-request override that switches retries off', fakeAsync(() => {
    setup();
    const context = new HttpContext().set(RETRY_OVERRIDE, { maxRetries: 0 });
    http.get('/api/posts', { context }).subscribe({ error: () => undefined });

    controller.expectOne('/api/posts').flush(null, { status: 503, statusText: 'Failed' });
    tick(5_000);

    controller.verify();
  }));

  it('honours a per-request override that raises the ceiling', fakeAsync(() => {
    setup();
    const context = new HttpContext().set(RETRY_OVERRIDE, { maxRetries: 3 });
    let body: unknown = null;
    http.get('/api/posts', { context }).subscribe((res) => (body = res));

    failAndWait('/api/posts', 503, 100);
    failAndWait('/api/posts', 503, 200);
    failAndWait('/api/posts', 503, 400);
    controller.expectOne('/api/posts').flush({ ok: true });

    expect(body).toEqual({ ok: true });
    controller.verify();
  }));

  it('waits the number of seconds a Retry-After header asks for', fakeAsync(() => {
    setup();
    http.get('/api/posts').subscribe({ error: () => undefined });

    const headers = new HttpHeaders({ 'Retry-After': '2' });
    controller
      .expectOne('/api/posts')
      .flush(null, { status: 429, statusText: 'Too Many', headers });

    // 2s, not the 100ms the policy would otherwise have computed.
    tick(1_999);
    controller.expectNone('/api/posts');
    tick(1);

    controller.expectOne('/api/posts').flush({ ok: true });
    controller.verify();
  }));

  it('records the retry count on the request trace', fakeAsync(() => {
    setup();
    const context = new HttpContext();
    http.get('/api/posts', { context }).subscribe();

    failAndWait('/api/posts', 503, 100);
    failAndWait('/api/posts', 503, 200);
    controller.expectOne('/api/posts').flush({ ok: true });

    expect(context.get(REQUEST_TRACE).retries).toBe(2);
    controller.verify();
  }));

  it('leaves the trace at zero retries for a request that succeeds first time', fakeAsync(() => {
    setup();
    const context = new HttpContext();
    http.get('/api/posts', { context }).subscribe();

    controller.expectOne('/api/posts').flush({ ok: true });

    expect(context.get(REQUEST_TRACE).retries).toBe(0);
    controller.verify();
  }));
});

describe('isRetryableFailure', () => {
  it('accepts a status the policy lists', () => {
    const error = new HttpErrorResponse({ status: 502 });
    expect(isRetryableFailure(error, DEFAULT_RETRY_POLICY)).toBeTrue();
  });

  it('rejects a status the policy does not list', () => {
    const error = new HttpErrorResponse({ status: 422 });
    expect(isRetryableFailure(error, DEFAULT_RETRY_POLICY)).toBeFalse();
  });

  // Anything that is not an `HttpErrorResponse` came from an interceptor above, not
  // from the transport, so a second attempt would repeat whatever it objected to.
  it('rejects a rejection that is not an HttpErrorResponse', () => {
    expect(isRetryableFailure(new Error('boom'), DEFAULT_RETRY_POLICY)).toBeFalse();
  });
});

describe('retryDelayMs', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');

  it('grows exponentially from the base delay', () => {
    expect(retryDelayMs(new HttpErrorResponse({ status: 500 }), 1, TEST_POLICY, now)).toBe(100);
    expect(retryDelayMs(new HttpErrorResponse({ status: 500 }), 2, TEST_POLICY, now)).toBe(200);
    expect(retryDelayMs(new HttpErrorResponse({ status: 500 }), 3, TEST_POLICY, now)).toBe(400);
  });

  it('clamps the computed backoff to maxDelayMs', () => {
    expect(retryDelayMs(new HttpErrorResponse({ status: 500 }), 20, TEST_POLICY, now)).toBe(
      TEST_POLICY.maxDelayMs
    );
  });

  it('applies the policy jitter to the computed backoff', () => {
    const halved: RetryPolicy = { ...TEST_POLICY, jitter: (delayMs) => delayMs / 2 };
    expect(retryDelayMs(new HttpErrorResponse({ status: 500 }), 2, halved, now)).toBe(100);
  });

  it('reads Retry-After as a delta in seconds', () => {
    const error = new HttpErrorResponse({
      status: 429,
      headers: new HttpHeaders({ 'Retry-After': '3' }),
    });
    expect(retryDelayMs(error, 1, TEST_POLICY, now)).toBe(3_000);
  });

  it('reads Retry-After as an HTTP date, relative to the clock it is given', () => {
    const error = new HttpErrorResponse({
      status: 503,
      headers: new HttpHeaders({ 'Retry-After': 'Thu, 01 Jan 2026 00:00:02 GMT' }),
    });
    expect(retryDelayMs(error, 1, TEST_POLICY, now)).toBe(2_000);
  });

  it('treats a Retry-After date already in the past as no wait at all', () => {
    const error = new HttpErrorResponse({
      status: 503,
      headers: new HttpHeaders({ 'Retry-After': 'Wed, 31 Dec 2025 23:59:00 GMT' }),
    });
    expect(retryDelayMs(error, 1, TEST_POLICY, now)).toBe(0);
  });

  it('clamps a Retry-After far in the future to maxDelayMs', () => {
    const error = new HttpErrorResponse({
      status: 503,
      headers: new HttpHeaders({ 'Retry-After': '3600' }),
    });
    expect(retryDelayMs(error, 1, TEST_POLICY, now)).toBe(TEST_POLICY.maxDelayMs);
  });

  it('is not jittered when the server named the time', () => {
    const doubled: RetryPolicy = { ...TEST_POLICY, jitter: (delayMs) => delayMs * 2 };
    const error = new HttpErrorResponse({
      status: 429,
      headers: new HttpHeaders({ 'Retry-After': '1' }),
    });
    expect(retryDelayMs(error, 1, doubled, now)).toBe(1_000);
  });

  it('falls back to the backoff for an unparseable Retry-After', () => {
    const error = new HttpErrorResponse({
      status: 503,
      headers: new HttpHeaders({ 'Retry-After': 'soonish' }),
    });
    expect(retryDelayMs(error, 1, TEST_POLICY, now)).toBe(100);
  });

  it('falls back to the backoff for a negative Retry-After', () => {
    const error = new HttpErrorResponse({
      status: 503,
      headers: new HttpHeaders({ 'Retry-After': '-5' }),
    });
    expect(retryDelayMs(error, 1, TEST_POLICY, now)).toBe(100);
  });

  it('falls back to the backoff for a rejection carrying no headers at all', () => {
    expect(retryDelayMs('not a response', 1, TEST_POLICY, now)).toBe(100);
  });
});

describe('fullJitter', () => {
  it('draws from the whole window, keeping both ends of it', () => {
    const random = spyOn(Math, 'random');

    random.and.returnValue(0);
    expect(fullJitter(1_000)).toBe(0);

    random.and.returnValue(0.5);
    expect(fullJitter(1_000)).toBe(500);

    // `Math.random()` is documented as `[0, 1)`, so the window's upper bound is
    // approached and never reached — a jittered delay is strictly under the backoff.
    random.and.returnValue(0.999_999);
    expect(fullJitter(1_000)).toBeLessThan(1_000);
  });
});
