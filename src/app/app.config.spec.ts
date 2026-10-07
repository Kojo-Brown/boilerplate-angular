import { Component, CSP_NONCE, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TitleStrategy } from '@angular/router';
import { appConfig } from './app.config';
import { AppTitleStrategy } from '@/app/core/routing/title.strategy';
import { AuthStore } from '@/app/store/auth/auth.store';
import { SESSION_HINT_COOKIE } from '@/app/store/auth/session-hint';
import { SUBSCRIBE_WEB_VITALS } from '@/app/core/vitals';
import { host, requireEl } from '@/testing';

/** The marker the API sets beside the refresh cookie. See `docs/token-storage.md`. */
function setSessionHint(): void {
  document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/`;
}

function clearSessionHint(): void {
  document.cookie = `${SESSION_HINT_COOKIE}=; Path=/; Max-Age=0`;
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
    refresh.flush({ accessToken: 'mock-access-token' });

    const profile = httpTesting.expectOne('http://localhost:3000/api/v1/auth/me');
    expect(profile.request.headers.get('Authorization')).toBe('Bearer mock-access-token');
    profile.flush({ id: '1', email: 'test@example.com', name: 'Test User', role: 'user' });

    expect(store.isAuthenticated()).toBeTrue();
    expect(store.isRestoringSession()).toBeFalse();
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
});
