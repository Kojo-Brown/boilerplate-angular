import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { environment } from '@/environments/environment';
import { CSRF_BOOTSTRAP_PATH, CSRF_CONTRACT } from '../csrf';
import { interceptWhen, requestsUnder } from './compose';
import { csrfInterceptor } from './csrf.interceptor';

const API = environment.apiUrl;
const BOOTSTRAP_URL = `${API}${CSRF_BOOTSTRAP_PATH}`;
const TOKEN = 'mock-csrf-token';

/**
 * Writes the cookie the API would have set, for the duration of one spec.
 *
 * A real cookie on the real document rather than a stubbed extractor, because the
 * component under test here is partly Angular's: `HttpXsrfTokenExtractor` is what reads
 * the jar, `withXsrfConfiguration` is what tells it which name to look for, and a fake
 * that returned a string would assert nothing about either being wired up.
 */
function setCsrfCookie(value: string): void {
  document.cookie = `${CSRF_CONTRACT.cookieName}=${value}; Path=/`;
}

function clearCsrfCookie(): void {
  document.cookie = `${CSRF_CONTRACT.cookieName}=; Path=/; Max-Age=0`;
}

describe('csrfInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  /**
   * The interceptor as `app.config.ts` installs it: scoped to the configured API by the
   * same predicate, since that scoping is a security property of the design rather than
   * a detail of the chain — a token echoed to an arbitrary origin is a token leaked.
   */
  function setup(platform: string = 'browser'): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withXsrfConfiguration(CSRF_CONTRACT),
          withInterceptors([interceptWhen(requestsUnder(API), csrfInterceptor)])
        ),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    clearCsrfCookie();
  });

  describe('with a token in the jar', () => {
    beforeEach(() => {
      setCsrfCookie(TOKEN);
      setup();
    });

    it('echoes the cookie back in the header on a POST', () => {
      http.post(`${API}/posts`, { title: 'x' }).subscribe();

      const request = controller.expectOne(`${API}/posts`);
      expect(request.request.headers.get(CSRF_CONTRACT.headerName)).toBe(TOKEN);
      request.flush({});
    });

    /**
     * The half that is easy to leave out and fatal to leave out: the server compares the
     * header against the cookie, and a cross-origin request without this flag carries no
     * cookie at all. The comparison then has one side, and every mutation is rejected.
     */
    it('sends credentials, so the cookie the token came from travels with it', () => {
      http.delete(`${API}/posts/1`).subscribe();

      const request = controller.expectOne(`${API}/posts/1`);
      expect(request.request.withCredentials).toBe(true);
      request.flush({});
    });

    it('protects every mutating method', () => {
      http.post(`${API}/a`, {}).subscribe();
      http.put(`${API}/b`, {}).subscribe();
      http.patch(`${API}/c`, {}).subscribe();
      http.delete(`${API}/d`).subscribe();

      for (const path of ['a', 'b', 'c', 'd']) {
        const request = controller.expectOne(`${API}/${path}`);
        expect(request.request.headers.get(CSRF_CONTRACT.headerName))
          .withContext(request.request.method)
          .toBe(TOKEN);
        request.flush({});
      }
    });

    it('leaves safe methods alone', () => {
      http.get(`${API}/posts`).subscribe();
      http.head(`${API}/posts`).subscribe();
      http.options(`${API}/posts`).subscribe();

      for (const request of controller.match(`${API}/posts`)) {
        expect(request.request.headers.has(CSRF_CONTRACT.headerName))
          .withContext(request.request.method)
          .toBe(false);
        expect(request.request.withCredentials).withContext(request.request.method).toBe(false);
        request.flush({});
      }
    });

    /**
     * `request('post', …)` is the spelling that bypasses a case-sensitive check, and the
     * failure is silent: the request succeeds, carries no token, and is rejected only by
     * a server that is doing its job.
     */
    it('protects a request whose method was written in lower case', () => {
      http.request('post', `${API}/posts`, { body: {} }).subscribe();

      const request = controller.expectOne(`${API}/posts`);
      expect(request.request.headers.get(CSRF_CONTRACT.headerName)).toBe(TOKEN);
      request.flush({});
    });

    /**
     * A call site that set the header itself has taken on this contract, credentials
     * included. Half-adopting it — overwriting the value but leaving `withCredentials`
     * alone, or the reverse — would be worse than either choice.
     */
    it('does not overwrite a header the caller already set', () => {
      http
        .post(`${API}/posts`, {}, { headers: { [CSRF_CONTRACT.headerName]: 'caller-owned' } })
        .subscribe();

      const request = controller.expectOne(`${API}/posts`);
      expect(request.request.headers.get(CSRF_CONTRACT.headerName)).toBe('caller-owned');
      expect(request.request.withCredentials).toBe(false);
      request.flush({});
    });

    it('issues no bootstrap request when it already has a token', () => {
      http.post(`${API}/posts`, {}).subscribe();

      controller.expectNone(BOOTSTRAP_URL);
      controller.expectOne(`${API}/posts`).flush({});
    });

    /**
     * The scope is the security property. Angular's built-in interceptor refuses
     * cross-origin requests precisely so a token cannot be handed to a third party, and
     * widening that without restoring the bound would be the wrong fix.
     */
    it('never sends the token to an origin that is not the configured API', () => {
      http.post('https://analytics.example.com/collect', {}).subscribe();

      const request = controller.expectOne('https://analytics.example.com/collect');
      expect(request.request.headers.has(CSRF_CONTRACT.headerName)).toBe(false);
      expect(request.request.withCredentials).toBe(false);
      request.flush({});
    });
  });

  describe('with no token yet', () => {
    beforeEach(() => {
      clearCsrfCookie();
      setup();
    });

    /**
     * The cold-sign-in case, which is the reason `CsrfBootstrap` exists: the first API
     * request a visit to `/login` makes is itself a mutation, so there has been no
     * response to set the cookie.
     */
    it('fetches a token first, then sends the mutation carrying it', () => {
      let completed = false;
      http.post(`${API}/auth/login`, {}).subscribe(() => (completed = true));

      // Nothing has gone out to the endpoint yet: the mutation is waiting.
      controller.expectNone(`${API}/auth/login`);

      const bootstrap = controller.expectOne(BOOTSTRAP_URL);
      expect(bootstrap.request.method).toBe('GET');
      expect(bootstrap.request.withCredentials)
        .withContext('a cross-origin Set-Cookie is dropped without this')
        .toBe(true);

      // What the API's `Set-Cookie` does, from the document's point of view.
      setCsrfCookie(TOKEN);
      bootstrap.flush('');

      const login = controller.expectOne(`${API}/auth/login`);
      expect(login.request.headers.get(CSRF_CONTRACT.headerName)).toBe(TOKEN);
      login.flush({});
      expect(completed).toBe(true);
    });

    /**
     * Two mutations in one tick must not each fetch a token: the second would race the
     * first's `Set-Cookie` and could echo a value the server has already replaced.
     */
    it('fetches one token for several mutations dispatched together', () => {
      http.post(`${API}/a`, {}).subscribe();
      http.post(`${API}/b`, {}).subscribe();

      const bootstrap = controller.expectOne(BOOTSTRAP_URL);
      setCsrfCookie(TOKEN);
      bootstrap.flush('');

      for (const path of ['a', 'b']) {
        const request = controller.expectOne(`${API}/${path}`);
        expect(request.request.headers.get(CSRF_CONTRACT.headerName)).toBe(TOKEN);
        request.flush({});
      }
    });

    /**
     * A client-side refusal protects nobody — the forged request comes from a page that
     * will never run this code. So a bootstrap that fails leaves the mutation to go out
     * and the server to reject it, which is the honest 403, on the endpoint the user was
     * reaching for, with a server-side log behind it.
     */
    it('still sends the mutation when the bootstrap fails', () => {
      let failure: unknown = null;
      http.post(`${API}/posts`, {}).subscribe({ error: (err: unknown) => (failure = err) });

      controller.expectOne(BOOTSTRAP_URL).flush('', { status: 503, statusText: 'Unavailable' });

      const request = controller.expectOne(`${API}/posts`);
      expect(request.request.headers.has(CSRF_CONTRACT.headerName)).toBe(false);
      request.flush({ message: 'csrf' }, { status: 403, statusText: 'Forbidden' });

      // The caller sees the server's 403, not a client-side refusal invented here — the
      // bootstrap's own 503 is not what surfaces.
      expect(failure).toBeTruthy();
      expect((failure as { status?: number }).status).toBe(403);
    });

    /**
     * And the misconfiguration that looks like success: a 200 with no `Set-Cookie`, or
     * one set on a domain this document cannot read. There is nothing to find and nothing
     * to report, so the request goes out and the server answers.
     */
    it('sends the mutation unprotected when the bootstrap sets no cookie', () => {
      http.post(`${API}/posts`, {}).subscribe({ error: () => undefined });

      controller.expectOne(BOOTSTRAP_URL).flush('');

      const request = controller.expectOne(`${API}/posts`);
      expect(request.request.headers.has(CSRF_CONTRACT.headerName)).toBe(false);
      expect(request.request.withCredentials).toBe(false);
      request.flush({}, { status: 403, statusText: 'Forbidden' });
    });

    it('does not bootstrap for a safe method', () => {
      http.get(`${API}/posts`).subscribe();

      controller.expectNone(BOOTSTRAP_URL);
      controller.expectOne(`${API}/posts`).flush({});
    });
  });

  /**
   * Server-side rendering has no visitor whose cookies `DOCUMENT` could hold, so there is
   * nothing to read and nothing a bootstrap could store. Angular's extractor reaches the
   * same answer by itself, but relying on that alone would leave the bootstrap firing —
   * a credentialed request, once per server render, on behalf of nobody.
   */
  describe('under server-side rendering', () => {
    it('sends the mutation untouched and makes no bootstrap request', () => {
      setCsrfCookie(TOKEN);
      setup('server');

      http.post(`${API}/posts`, {}).subscribe();

      controller.expectNone(BOOTSTRAP_URL);
      const request = controller.expectOne(`${API}/posts`);
      expect(request.request.headers.has(CSRF_CONTRACT.headerName)).toBe(false);
      expect(request.request.withCredentials).toBe(false);
      request.flush({});
    });
  });

  /**
   * ## Why this interceptor exists at all
   *
   * These two cases are the finding behind it, asserted rather than written down: with
   * Angular's XSRF support configured exactly as `app.config.ts` configures it, and
   * **no** interceptor of ours, a mutation to a cross-origin API carries no token. The
   * same mutation to a same-origin path carries one.
   *
   * It is not a bug in Angular. Its interceptor resolves the request URL against
   * `PlatformLocation` and returns early when the origins differ, deliberately, so a
   * token cannot be handed to a third-party host. But it means `withXsrfConfiguration`
   * on its own is inert for this application — a cookie name, a header name, a
   * documented contract, and not one request carrying a token — and nothing anywhere
   * says so. The application works; only the server's rejections would ever show it, and
   * a server given no token by a client it believes is protected has nothing to reject.
   */
  describe('Angular’s built-in XSRF support alone', () => {
    beforeEach(() => {
      setCsrfCookie(TOKEN);
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withXsrfConfiguration(CSRF_CONTRACT)),
          provideHttpClientTesting(),
        ],
      });
      http = TestBed.inject(HttpClient);
      controller = TestBed.inject(HttpTestingController);
    });

    it('attaches nothing to a cross-origin API mutation', () => {
      http.post(`${API}/posts`, {}).subscribe();

      const request = controller.expectOne(`${API}/posts`);
      expect(request.request.headers.has(CSRF_CONTRACT.headerName)).toBe(false);
      request.flush({});
    });

    it('does attach to a same-origin one, which is what makes the gap invisible', () => {
      http.post('/api/v1/posts', {}).subscribe();

      const request = controller.expectOne('/api/v1/posts');
      expect(request.request.headers.get(CSRF_CONTRACT.headerName)).toBe(TOKEN);
      request.flush({});
    });
  });

  afterEach(() => {
    controller.verify();
  });
});
