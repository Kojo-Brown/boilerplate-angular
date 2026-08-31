import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  HTTP_TELEMETRY_SINK,
  consoleTelemetrySink,
  noopTelemetrySink,
  statusOf,
  telemetryInterceptor,
  type HttpSpan,
} from './telemetry.interceptor';
import { HTTP_CLOCK, REQUEST_TRACE } from './request-trace';

describe('telemetryInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let recorded: HttpSpan[];
  let now: number;

  beforeEach(() => {
    recorded = [];
    now = 1_000;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([telemetryInterceptor])),
        provideHttpClientTesting(),
        { provide: HTTP_CLOCK, useValue: () => now },
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

  it('records a successful request with its status and duration', () => {
    http.get('/api/posts').subscribe();
    now += 42;
    controller.expectOne('/api/posts').flush({ ok: true });

    expect(recorded.length).toBe(1);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].url).toBe('/api/posts');
    expect(recorded[0].outcome).toBe('success');
    expect(recorded[0].status).toBe(200);
    expect(recorded[0].durationMs).toBe(42);
  });

  it('records a failed request as an error carrying the status', () => {
    http.get('/api/posts').subscribe({ error: () => undefined });
    controller.expectOne('/api/posts').flush(null, { status: 502, statusText: 'Bad Gateway' });

    expect(recorded.length).toBe(1);
    expect(recorded[0].outcome).toBe('error');
    expect(recorded[0].status).toBe(502);
  });

  // A `switchMap` typeahead cancels its previous request every keystroke. Counting
  // those as errors is how an error-rate panel reports an outage during a demo.
  it('records an abandoned request as cancelled rather than as an error', () => {
    const subscription = http.get('/api/posts').subscribe();
    const request = controller.expectOne('/api/posts');

    subscription.unsubscribe();

    expect(request.cancelled).toBeTrue();
    expect(recorded.length).toBe(1);
    expect(recorded[0].outcome).toBe('cancelled');
    expect(recorded[0].status).toBe(0);
  });

  it('records exactly one span per request', () => {
    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});
    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});

    expect(recorded.length).toBe(2);
  });

  it('reports the URL without its query string', () => {
    http.get('/api/search', { params: { q: 'a-search-term' } }).subscribe();
    controller.expectOne('/api/search?q=a-search-term').flush({});

    expect(recorded[0].url).toBe('/api/search');
  });

  it('upper-cases a lower-cased method so spans aggregate', () => {
    http.request('get', '/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});

    expect(recorded[0].method).toBe('GET');
  });

  it('reports what the decorators beneath it recorded on the trace', () => {
    const context = new HttpContext();
    const trace = context.get(REQUEST_TRACE);
    trace.retries = 2;
    trace.cache = 'miss';

    http.get('/api/posts', { context }).subscribe();
    controller.expectOne('/api/posts').flush({});

    expect(recorded[0].retries).toBe(2);
    expect(recorded[0].cache).toBe('miss');
  });

  it('reports no retries and a bypass when nothing beneath it wrote to the trace', () => {
    http.get('/api/posts').subscribe();
    controller.expectOne('/api/posts').flush({});

    expect(recorded[0].retries).toBe(0);
    expect(recorded[0].cache).toBe('bypass');
  });

  it('passes the response through unchanged', () => {
    let body: unknown = null;
    http.get('/api/posts').subscribe((res) => (body = res));
    controller.expectOne('/api/posts').flush({ ok: true });

    expect(body).toEqual({ ok: true });
  });
});

describe('noopTelemetrySink', () => {
  it('accepts a span and does nothing observable with it', () => {
    expect(() =>
      noopTelemetrySink.record({
        method: 'GET',
        url: '/api/posts',
        outcome: 'success',
        status: 200,
        durationMs: 1,
        retries: 0,
        cache: 'bypass',
      })
    ).not.toThrow();
  });
});

describe('consoleTelemetrySink', () => {
  it('prints one line naming the outcome, the retries and the cache result', () => {
    const debug = spyOn(console, 'debug');

    consoleTelemetrySink.record({
      method: 'GET',
      url: '/api/posts',
      outcome: 'success',
      status: 200,
      durationMs: 12.7,
      retries: 1,
      cache: 'miss',
    });

    expect(debug).toHaveBeenCalledOnceWith(
      '[http] GET /api/posts success 200 13ms retries=1 cache=miss'
    );
  });
});

describe('statusOf', () => {
  it('reads an HttpErrorResponse', () => {
    expect(statusOf(new HttpErrorResponse({ status: 404 }))).toBe(404);
  });

  // What `errorInterceptor` produces, which is what this decorator sees from above it.
  it('reads the normalised ApiError shape', () => {
    expect(statusOf({ status: 422, message: 'Unprocessable' })).toBe(422);
  });

  it('reports zero for a rejection with no status at all', () => {
    expect(statusOf(new Error('boom'))).toBe(0);
    expect(statusOf(null)).toBe(0);
    expect(statusOf({ status: 'gone' })).toBe(0);
    expect(statusOf({ status: Number.NaN })).toBe(0);
  });
});
