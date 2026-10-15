import { Component, CSP_NONCE, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TitleStrategy } from '@angular/router';
import { appConfig } from './app.config';
import { AppTitleStrategy } from '@/app/core/routing/title.strategy';
import { AuthStore } from '@/app/store/auth/auth.store';
import { SESSION_HINT_COOKIE } from '@/app/store/auth/session-hint';
import { CSRF_BOOTSTRAP_PATH, CSRF_CONTRACT } from '@/app/core/http/csrf';
import { SUBSCRIBE_WEB_VITALS } from '@/app/core/vitals';
import { environment } from '@/environments/environment';
import { host, requireEl } from '@/testing';

/**
 * The two readable cookies the API sets beside the `HttpOnly` refresh cookie: the marker
 * that says a session exists, and the CSRF token that authorises acting within it. See
 * `docs/token-storage.md` and `docs/csrf.md` — both are set in the same response, with
 * the same `Max-Age`, which is what makes the restore below cost one request rather than
 * two.
 */
function setSessionHint(): void {
  document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/`;
  document.cookie = `${CSRF_CONTRACT.cookieName}=mock-csrf-token; Path=/`;
}

function clearSessionHint(): void {
  document.cookie = `${SESSION_HINT_COOKIE}=; Path=/; Max-Age=0`;
  document.cookie = `${CSRF_CONTRACT.cookieName}=; Path=/; Max-Age=0`;
}

/**
 * Reads one signal and one plain field into the same template, so a single assertion
 * can tell "change detection ran" apart from "change detection ran and saw the field".
 */
@Component({
  standalone: true,
  template: `<p data-testid="probe">{{ fromSignal() }}/{{ fromField }}</p>`,
})
class ProbeComponent {
  readonly fromSignal = signal('a');
  fromField = 'a';
}

describe('appConfig', () => {
  beforeEach(() => {
    // The providers the real application bootstraps with. Environment providers set
    // here outrank the testing platform's, so a `provideZoneChangeDetection()` that
    // crept back into `app.config.ts` would win — which is what makes these
    // assertions about the shipped configuration rather than about the test setup.
    //
    // `provideHttpClientTesting()` comes after them so the app initializer's `/auth/me`
    // request lands on a controller instead of the network. Storage is cleared because
    // that initializer reads it, and a token left behind by another spec would make
    // these specs issue a request they never asked for.
    //
    // `SUBSCRIBE_WEB_VITALS` is stubbed for the same reason storage is cleared: these
    // specs bootstrap the real configuration many times over, and the real subscriber
    // loads `web-vitals` and registers a fresh set of `PerformanceObserver`s and
    // page-lifecycle listeners on each one — none of which a `TestBed` teardown removes,
    // because they belong to the page rather than to the injector. They then report
    // against Karma's own document as the suite ends. What these specs are about is
    // change detection; `core/vitals/` has its own.
    clearSessionHint();
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: SUBSCRIBE_WEB_VITALS, useValue: async () => undefined },
      ],
    });
  });

  afterEach(clearSessionHint);

  function text(fixture: ReturnType<typeof TestBed.createComponent<ProbeComponent>>): string {
    return requireEl(host(fixture), '[data-testid="probe"]').textContent?.trim() ?? '';
  }

  it('bootstraps without an Angular zone', () => {
    const zone = TestBed.inject(NgZone);

    // A real `NgZone` enters the Angular zone for the duration of `run`. The noop
    // implementation zoneless installs just calls the function. `zone.js` is loaded in
    // the test bundle for `fakeAsync`, so this distinguishes the two implementations
    // rather than merely detecting whether ZoneJS exists.
    expect(zone.run(() => NgZone.isInAngularZone())).toBe(false);
  });

  it('refreshes the view when a signal read in the template changes', async () => {
    const fixture = TestBed.createComponent(ProbeComponent);
    await fixture.whenStable();
    expect(text(fixture)).toBe('a/a');

    fixture.componentInstance.fromSignal.set('b');
    await fixture.whenStable();

    expect(text(fixture)).toBe('b/a');
  });

  it('does not refresh the view for a plain field mutated outside Angular', async () => {
    const fixture = TestBed.createComponent(ProbeComponent);
    await fixture.whenStable();

    fixture.componentInstance.fromField = 'b';
    await fixture.whenStable();

    // Nothing notified the scheduler, so no refresh is even attempted. This is the
    // behaviour every non-signal source of state has to account for under zoneless —
    // see `docs/zoneless.md`.
    expect(text(fixture)).toBe('a/a');

    // The field is not stale data Angular refuses to read; it is data Angular was
    // never told to go looking for. The next refresh, from any source, picks it up.
    fixture.componentInstance.fromSignal.set('b');
    await fixture.whenStable();

    expect(text(fixture)).toBe('b/b');
  });

  // Regression test for NG0200, and the one place the restore runs through the real
  // interceptor chain. `jwtInterceptor` injects `AuthStore`, so a request issued from a
  // store hook re-enters its factory, never leaves, and the session silently fails to
  // restore. Driving it from an app initializer instead means the store is fully
  // constructed by the time it runs — and this spec fails at `expectOne` if that ever
  // moves back.
  //
  // What it restores *from* is the point of `docs/token-storage.md`: nothing on the
  // client but a cookie this code cannot read. The access token comes back over the
  // wire and is then attached to the profile request by the interceptor.
  it('rebuilds a session from the refresh cookie in an app initializer', () => {
    setSessionHint();

    // The first injection runs the app initializers.
    const store = TestBed.inject(AuthStore);
    const httpTesting = TestBed.inject(HttpTestingController);

    expect(store.isRestoringSession()).toBeTrue();

    const refresh = httpTesting.expectOne('http://localhost:3000/api/v1/auth/refresh');
    expect(refresh.request.withCredentials)
      .withContext('the refresh cookie only travels on a credentialed request')
      .toBeTrue();
    expect(refresh.request.headers.has('Authorization'))
      .withContext('/auth/refresh is an AUTH_BYPASS_PATH — its 401 is not a stale token')
      .toBeFalse();
    // The endpoint CSRF protection exists for: it is authorised by a cookie rather than
    // by a bearer token, which is exactly what makes it forgeable. See `docs/csrf.md`.
    expect(refresh.request.headers.get(CSRF_CONTRACT.headerName))
      .withContext('a cookie-authorised mutation carries the CSRF token')
      .toBe('mock-csrf-token');
    refresh.flush({ accessToken: 'mock-access-token' });

    const profile = httpTesting.expectOne('http://localhost:3000/api/v1/auth/me');
    expect(profile.request.headers.get('Authorization')).toBe('Bearer mock-access-token');
    profile.flush({ id: '1', email: 'test@example.com', name: 'Test User', role: 'user' });

    expect(store.isAuthenticated()).toBeTrue();
    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  /**
   * What it costs when the API has not set the CSRF cookie alongside the hint — a token
   * that expired early, or an API that only sets one on `/csrf`.
   *
   * The restore is a `POST`, so it cannot go out without a token, and the bootstrap has
   * to complete first: two sequential round trips before the session comes back instead
   * of one. That is the reason `docs/csrf.md` requires the token to be set in the same
   * response as `session_hint` with the same `Max-Age`, rather than leaving it to the
   * bootstrap — and it is asserted here so the requirement has a failing test behind it
   * rather than a sentence in a document.
   */
  it('bootstraps a CSRF token first when the API left none beside the hint', () => {
    document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/`;

    const store = TestBed.inject(AuthStore);
    const httpTesting = TestBed.inject(HttpTestingController);

    expect(store.isRestoringSession()).toBeTrue();

    // The refresh is waiting on a token rather than in flight.
    httpTesting.expectNone('http://localhost:3000/api/v1/auth/refresh');
    const bootstrap = httpTesting.expectOne(`http://localhost:3000/api/v1${CSRF_BOOTSTRAP_PATH}`);
    document.cookie = `${CSRF_CONTRACT.cookieName}=late-csrf-token; Path=/`;
    bootstrap.flush('');

    const refresh = httpTesting.expectOne('http://localhost:3000/api/v1/auth/refresh');
    expect(refresh.request.headers.get(CSRF_CONTRACT.headerName)).toBe('late-csrf-token');
    refresh.flush({ accessToken: 'mock-access-token' });

    httpTesting
      .expectOne('http://localhost:3000/api/v1/auth/me')
      .flush({ id: '1', email: 'test@example.com', name: 'Test User', role: 'user' });

    expect(store.isAuthenticated()).toBeTrue();
    httpTesting.verify();
  });

  /** No hint, no request: an anonymous visitor pays nothing for the restore path. */
  it('restores nothing when no session hint is present', () => {
    const store = TestBed.inject(AuthStore);
    const httpTesting = TestBed.inject(HttpTestingController);

    expect(store.isRestoringSession()).toBeFalse();
    httpTesting.verify();
  });

  /**
   * `useExisting`, not `useClass`, and the difference is the whole route announcer.
   *
   * `AppTitleStrategy` is `providedIn: 'root'`. `useClass` would have the injector
   * construct a *second* instance for the router to call, leaving the root one — the
   * instance `RouteAnnouncerComponent` injects — subscribed to a stream nothing ever
   * pushes to. The tab title would still be correct, because the router's copy is what
   * sets it, so the only symptom would be a route announcer that is silent forever with
   * nothing logged anywhere.
   */
  it('gives the router the same title strategy the route announcer reads', () => {
    expect(TestBed.inject(TitleStrategy)).toBe(TestBed.inject(AppTitleStrategy));
  });

  /**
   * `CSP_NONCE` belongs to `app.config.server.ts` and must not leak into the shared
   * configuration.
   *
   * On the server it is provided as the build-time placeholder, so the renderer can stamp
   * it onto the event-replay script it injects (see `core/security/nonce.ts`). In the
   * browser Angular's own default for the token reads the live `ngCspNonce` attribute off
   * `<app-root>`, which `src/server.ts` has by then rewritten to this response's real
   * nonce.
   *
   * Providing it here would override that default with the placeholder, and every
   * `<style>` element Angular injected as a lazy component arrived would carry a nonce
   * the policy does not list. Nothing would error: the styles would simply not apply, on
   * lazily-routed components only, in a production build only.
   */
  it('does not provide CSP_NONCE, which the browser must read from the document', () => {
    expect(TestBed.inject(CSP_NONCE, null)).toBeNull();
  });
  /**
   * Where the credentials are allowed to travel, asserted against the chain the
   * application actually bootstraps.
   *
   * This is deliberately not in `jwt.interceptor.spec.ts`, and that is the whole point of
   * it being here. `jwtInterceptor` is correct in isolation — handed a request and a
   * token, it attaches a `Bearer` header, which is its job and what its own spec proves.
   * Whether that is *safe* is decided one level up, by where the interceptor is installed:
   * for most of this repository's life it sat at the top of `withInterceptors([…])`,
   * outside the `requestsUnder(environment.apiUrl)` scope that already bounded the CSRF
   * token, so every request `HttpClient` made to any host in the world would have carried
   * the access token.
   *
   * Nothing failed, and nothing could have: every URL this application builds is
   * `environment.apiUrl` plus a path, so no existing spec and no e2e case ever posted to a
   * third-party host to notice. The exposure was entirely in the next call someone added —
   * an analytics endpoint, a feature-flag service, a map tile server — which would have
   * been handed a working session token with nothing in CI to say so. A bearer token is
   * strictly more valuable than the CSRF token the repository already refuses to leak.
   *
   * So the assertion is about the configuration, not the interceptor, and the off-origin
   * case is the one that would have been green before the fix.
   */
  describe('where a credential is allowed to travel', () => {
    function withSession(): HttpTestingController {
      TestBed.inject(AuthStore).updateAccessToken('mock-access-token');
      return TestBed.inject(HttpTestingController);
    }

    it('attaches the bearer token to a request for the configured API', () => {
      const httpTesting = withSession();

      TestBed.inject(HttpClient)
        .get(`${environment.apiUrl}/posts`)
        .subscribe({ error: () => undefined });

      const request = httpTesting.expectOne(`${environment.apiUrl}/posts`);
      expect(request.request.headers.get('Authorization')).toBe('Bearer mock-access-token');
      request.flush([]);
    });

    it('sends no bearer token to an origin that is not the configured API', () => {
      const httpTesting = withSession();
      const thirdParty = 'https://third-party.example/collect';

      TestBed.inject(HttpClient)
        .get(thirdParty)
        .subscribe({ error: () => undefined });

      const request = httpTesting.expectOne(thirdParty);
      expect(request.request.headers.has('Authorization')).toBeFalse();
      request.flush({});
    });

    /**
     * The 401 handler is credential machinery too. A third-party host answering 401 — for
     * its own unrelated reasons — must not spend this application's refresh cookie, which
     * is what an unscoped `jwtInterceptor` would do: one 401 from an analytics endpoint
     * and the session is refreshed, or, if the refresh fails, cleared.
     */
    it('does not spend the refresh cookie on a 401 from somewhere else', () => {
      const httpTesting = withSession();
      const thirdParty = 'https://third-party.example/collect';

      TestBed.inject(HttpClient)
        .get(thirdParty)
        .subscribe({ error: () => undefined });
      httpTesting.expectOne(thirdParty).flush({}, { status: 401, statusText: 'Unauthorized' });

      httpTesting.verify();
      expect(TestBed.inject(AuthStore).accessToken()).toBe('mock-access-token');
    });
  });
});
