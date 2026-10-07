import { TestBed } from '@angular/core/testing';
import {
  SESSION_HINT,
  SESSION_HINT_COOKIE,
  absentSessionHint,
  browserSessionHint,
} from './session-hint';

function clearHint(): void {
  document.cookie = `${SESSION_HINT_COOKIE}=; Path=/; Max-Age=0`;
}

describe('browserSessionHint', () => {
  describe('with a browser document', () => {
    const hint = (): ReturnType<typeof browserSessionHint> => browserSessionHint(document);

    beforeEach(clearHint);
    afterEach(clearHint);

    it('reports no hint when the cookie is absent', () => {
      expect(hint().exists()).toBeFalse();
    });

    /**
     * The API sets the cookie, never this application — so the spec sets it the way a
     * `Set-Cookie` would and asserts only that it is *found*.
     */
    it('reports a hint once the server has set the cookie', () => {
      document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/`;

      expect(hint().exists()).toBeTrue();
    });

    /**
     * Presence is the whole signal. The value is a constant with no meaning, so a server
     * that changes it — or an opaque session id, should someone put one there — must not
     * change the answer.
     */
    it('reports a hint whatever the value is', () => {
      document.cookie = `${SESSION_HINT_COOKIE}=active; Path=/`;

      expect(hint().exists()).toBeTrue();
    });

    it('forgets the hint', () => {
      document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/`;
      expect(hint().exists()).toBeTrue();

      hint().forget();

      expect(hint().exists()).toBeFalse();
    });

    it('accepts a forget when there was no hint', () => {
      expect(() => hint().forget()).not.toThrow();
      expect(hint().exists()).toBeFalse();
    });

    /**
     * The hint is not the credential, and this is the assertion that says so: an
     * `HttpOnly` cookie beside it stays invisible. The browser is what enforces that, so
     * the only honest place to check it is a real document — `e2e/token-storage.spec.ts`
     * does the same for a cookie set by a real `Set-Cookie` response header.
     */
    it('cannot see a cookie it did not set through document.cookie', () => {
      document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/`;

      expect(document.cookie).not.toContain('refresh_token');
    });
  });

  /**
   * What the server renders against. Every method must be callable and none may throw:
   * `AuthStore` is constructed during a render, so a throw here takes the page with it.
   */
  describe('without a document', () => {
    const hint = browserSessionHint(null);

    it('reports no hint', () => {
      expect(hint.exists()).toBeFalse();
    });

    it('accepts a forget', () => {
      expect(() => hint.forget()).not.toThrow();
    });
  });
});

describe('absentSessionHint', () => {
  it('never reports a hint', () => {
    expect(absentSessionHint().exists()).toBeFalse();
  });

  it('accepts a forget', () => {
    expect(() => absentSessionHint().forget()).not.toThrow();
  });
});

describe('SESSION_HINT', () => {
  afterEach(clearHint);

  it('defaults to the cookie-backed implementation', () => {
    document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/`;

    expect(TestBed.inject(SESSION_HINT).exists()).toBeTrue();
  });

  it('can be replaced without touching the store', () => {
    const fake = absentSessionHint();
    TestBed.configureTestingModule({
      providers: [{ provide: SESSION_HINT, useValue: fake }],
    });

    expect(TestBed.inject(SESSION_HINT)).toBe(fake);
  });
});
