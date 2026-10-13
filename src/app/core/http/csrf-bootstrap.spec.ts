import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '@/environments/environment';
import { CSRF_BOOTSTRAP_PATH } from './csrf';
import { CsrfBootstrap } from './csrf-bootstrap';

const BOOTSTRAP_URL = `${environment.apiUrl}${CSRF_BOOTSTRAP_PATH}`;

describe('CsrfBootstrap', () => {
  let bootstrap: CsrfBootstrap;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    bootstrap = TestBed.inject(CsrfBootstrap);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
  });

  it('issues nothing until something subscribes', () => {
    bootstrap.ensureToken();

    controller.expectNone(BOOTSTRAP_URL);
  });

  it('asks the API for a cookie with credentials on', () => {
    bootstrap.ensureToken().subscribe();

    const request = controller.expectOne(BOOTSTRAP_URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    // The body is never read, and asking for JSON is how an empty 204 or a `text/plain`
    // acknowledgement becomes a parse error on a wholly successful response.
    expect(request.request.responseType).toBe('text');
    request.flush('');
  });

  it('shares one request between concurrent callers', () => {
    let first = false;
    let second = false;
    bootstrap.ensureToken().subscribe(() => (first = true));
    bootstrap.ensureToken().subscribe(() => (second = true));

    controller.expectOne(BOOTSTRAP_URL).flush('');

    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  /**
   * A waiter that unsubscribes before the next one arrives must not cancel the request
   * and have it re-issued — which is what `shareReplay`'s default `refCount: true` would
   * do, and it would be invisible except as a duplicated round trip.
   */
  it('does not re-issue the request when the first waiter leaves early', () => {
    const subscription = bootstrap.ensureToken().subscribe();
    const request = controller.expectOne(BOOTSTRAP_URL);
    subscription.unsubscribe();

    let completed = false;
    bootstrap.ensureToken().subscribe(() => (completed = true));

    controller.expectNone(BOOTSTRAP_URL);
    request.flush('');
    expect(completed).toBe(true);
  });

  /**
   * Once the API has answered, the next mutation reads the cookie and never reaches this
   * class. But if it does — the cookie expired, or the response set none — it must get a
   * fresh attempt rather than a replay of a settled one.
   */
  it('issues a new request after the previous one has settled', () => {
    bootstrap.ensureToken().subscribe();
    controller.expectOne(BOOTSTRAP_URL).flush('');

    bootstrap.ensureToken().subscribe();
    controller.expectOne(BOOTSTRAP_URL).flush('');
  });

  /**
   * It never fails, by design: a caller cannot tell a 503 from a token, because the
   * decision this application makes about a missing token is "send it anyway and let the
   * server answer". See the header of `csrf.ts`.
   */
  it('completes successfully when the API rejects the request', () => {
    let completed = false;
    let errored = false;
    bootstrap.ensureToken().subscribe({
      next: () => (completed = true),
      error: () => (errored = true),
    });

    controller
      .expectOne(BOOTSTRAP_URL)
      .flush('', { status: 503, statusText: 'Service Unavailable' });

    expect(completed).toBe(true);
    expect(errored).toBe(false);
  });

  it('tries again after a failure', () => {
    bootstrap.ensureToken().subscribe();
    controller.expectOne(BOOTSTRAP_URL).flush('', { status: 503, statusText: 'Unavailable' });

    bootstrap.ensureToken().subscribe();
    controller.expectOne(BOOTSTRAP_URL).flush('');
  });
});
