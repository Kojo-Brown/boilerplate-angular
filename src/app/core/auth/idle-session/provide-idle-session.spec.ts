import { Component } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { AuthFacade } from '@/app/core/auth/auth.facade';
import { createFakeAuthFacade } from '@/testing';
import type { FakeAuthFacade } from '@/testing';
import { IDLE_CLOCK, IDLE_POLL_MS, provideIdleSessionTimeout } from './provide-idle-session';

/** A one-minute window: long enough for several polls, short enough to read. */
const WINDOW_MS = 60_000;

/** Nothing renders; the feature under test lives in an app initializer. */
@Component({ standalone: true, template: '' })
class HostComponent {}

interface Harness {
  readonly auth: FakeAuthFacade;
  readonly doc: Document;
  /** Move the injected clock on without letting any timer fire. */
  readonly skip: (ms: number) => void;
  /** Move the clock and the virtual timers together, as real time does. */
  readonly wait: (ms: number) => void;
  readonly destroy: () => void;
}

/**
 * Bootstrap the real providers with a clock the spec owns.
 *
 * `skip` and `wait` are separate on purpose. Real time moves both the clock and the
 * timer queue; a throttled tab, a sleeping machine and a long garbage-collection pause
 * move the clock while the queue stands still. Several assertions below are about
 * exactly that difference, and a helper that advanced them together would make those
 * cases unreachable.
 */
function startIdleSession(options: { signedIn?: boolean; idleAfterMs?: number } = {}): Harness {
  const auth = createFakeAuthFacade({ isSignedIn: options.signedIn ?? true });
  let reading = 5_000;

  TestBed.configureTestingModule({
    providers: [
      provideIdleSessionTimeout({ idleAfterMs: options.idleAfterMs ?? WINDOW_MS }),
      { provide: AuthFacade, useValue: auth },
      { provide: IDLE_CLOCK, useValue: () => reading },
    ],
  });

  // Creating the first component is what runs the app initializers, and the render is
  // what runs the `afterNextRender` the activity listeners are registered from.
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();

  return {
    auth,
    doc: TestBed.inject(DOCUMENT),
    skip: (ms) => {
      reading += ms;
    },
    wait: (ms) => {
      reading += ms;
      tick(ms);
    },
    destroy: () => fixture.destroy(),
  };
}

/** A trusted-looking event of the kind the browser sends for real input. */
function sendActivity(doc: Document, type: 'keydown' | 'pointerdown' | 'pointermove' | 'wheel') {
  doc.dispatchEvent(new Event(type, { bubbles: true }));
}

describe('provideIdleSessionTimeout', () => {
  it('refuses a window that is not a positive number of milliseconds', () => {
    for (const idleAfterMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => provideIdleSessionTimeout({ idleAfterMs })).toThrowError(
        RangeError,
        /idleAfterMs must be a finite number of milliseconds greater than zero/
      );
    }
  });

  it('signs the user out once the window has elapsed with no activity', fakeAsync(() => {
    const { auth, wait, destroy } = startIdleSession();

    wait(WINDOW_MS - IDLE_POLL_MS);
    expect(auth.signOut).not.toHaveBeenCalled();

    wait(IDLE_POLL_MS);

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    destroy();
  }));

  it('keeps the session alive while the user is doing something', fakeAsync(() => {
    const { auth, doc, wait, destroy } = startIdleSession();

    // Four windows' worth of time, with input arriving between every poll.
    for (let elapsed = 0; elapsed < WINDOW_MS * 4; elapsed += IDLE_POLL_MS) {
      sendActivity(doc, 'pointermove');
      wait(IDLE_POLL_MS);
    }

    expect(auth.signOut).not.toHaveBeenCalled();
    destroy();
    discardPeriodicTasks();
  }));

  /**
   * The poll rate is a detection delay and not a deadline, which is the property that
   * makes this feature survive the two things that stop timers running: a background tab
   * whose timers the browser throttles to about one callback a minute, and a machine that
   * was asleep. Both deliver one callback with a long gap behind it, which is what `skip`
   * reproduces — the clock has moved by ten windows and exactly one poll fires.
   */
  it('signs the user out on the first poll after a lapse it slept through', fakeAsync(() => {
    const { auth, skip, wait, destroy } = startIdleSession();

    skip(WINDOW_MS * 10);
    expect(auth.signOut).not.toHaveBeenCalled();

    wait(IDLE_POLL_MS);

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    destroy();
  }));

  /**
   * `signOut()` is not only a state change: `AuthStore.logout` also sends a revocation
   * request. The fake facade's `signOut` is a spy that does *not* flip `isSignedIn`,
   * which is the hostile version of the real store — if the loop depended on the session
   * going away to stop, this is where it would send one request per poll forever.
   */
  it('signs the user out exactly once, however long the tab stays open', fakeAsync(() => {
    const { auth, wait, destroy } = startIdleSession();

    wait(WINDOW_MS);
    expect(auth.signOut).toHaveBeenCalledTimes(1);

    for (let poll = 0; poll < 40; poll++) {
      wait(IDLE_POLL_MS);
    }

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    destroy();
    discardPeriodicTasks();
  }));

  /**
   * The expiry is terminal in `idle-countdown.ts`, and this is that property reaching the
   * user: somebody comes back to a laptop whose session has already lapsed, moves the
   * mouse, and the sign-out that already happened is not undone.
   */
  it('does not let activity after the deadline revive the session', fakeAsync(() => {
    const { auth, doc, wait, destroy } = startIdleSession();

    wait(WINDOW_MS);
    expect(auth.signOut).toHaveBeenCalledTimes(1);

    sendActivity(doc, 'keydown');
    wait(IDLE_POLL_MS);

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    destroy();
    discardPeriodicTasks();
  }));

  /**
   * The window belongs to the session, not to the page load. Without the re-base on the
   * signed-out pass, a visitor who left the sign-in form open longer than the window
   * would be signed out by the first poll after signing in — a feature that makes it
   * impossible to stay signed in, from a bug with no error anywhere.
   *
   * It also covers the half nobody can see: `fakeAsync` fails a spec that ends with a
   * periodic timer still queued, so reaching the sign-in below without
   * `discardPeriodicTasks()` is the assertion that no poll was armed while nobody was
   * signed in.
   */
  it('starts the window when the session starts, not when the page loaded', fakeAsync(() => {
    const { auth, skip, wait, destroy } = startIdleSession({ signedIn: false });

    skip(WINDOW_MS * 3);
    wait(IDLE_POLL_MS * 4);
    expect(auth.signOut).not.toHaveBeenCalled();

    auth.isSignedIn.set(true);
    TestBed.tick();

    wait(WINDOW_MS - IDLE_POLL_MS);
    expect(auth.signOut).not.toHaveBeenCalled();

    wait(IDLE_POLL_MS);

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    destroy();
  }));

  /**
   * Activity is read in the capture phase, so a component that stops an event on its way
   * up — which a dialog, a menu or a drag implementation does as ordinary defensive code
   * — cannot make the person typing into it look absent. In the bubble phase this spec
   * fails: the session expires under someone who is using the application.
   */
  it('sees input that a component stops from propagating', fakeAsync(() => {
    const { auth, doc, wait, destroy } = startIdleSession();
    const target = doc.createElement('div');
    doc.body.appendChild(target);
    target.addEventListener('keydown', (event) => event.stopPropagation());

    for (let elapsed = 0; elapsed < WINDOW_MS * 2; elapsed += IDLE_POLL_MS) {
      target.dispatchEvent(new Event('keydown', { bubbles: true }));
      wait(IDLE_POLL_MS);
    }

    expect(auth.signOut).not.toHaveBeenCalled();
    target.remove();
    destroy();
    discardPeriodicTasks();
  }));

  /**
   * Focus is not presence here, because this application moves focus itself after every
   * navigation (`core/a11y/route-focus.ts`). Counting `focusin` would let a redirect loop
   * — or a toast taking focus — hold a session open with nobody at the keyboard.
   */
  it('does not count focus moving as the user being present', fakeAsync(() => {
    const { auth, doc, wait, destroy } = startIdleSession();

    for (let elapsed = 0; elapsed < WINDOW_MS; elapsed += IDLE_POLL_MS) {
      doc.dispatchEvent(new Event('focusin', { bubbles: true }));
      doc.dispatchEvent(new Event('scroll', { bubbles: true }));
      wait(IDLE_POLL_MS);
    }

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    destroy();
  }));

  /**
   * Removal has to present the same `capture` flag as registration or it removes nothing:
   * the browser keys a listener on (type, callback, capture), so the bubble-phase
   * `removeEventListener` that reads correctly leaves four live listeners on a document
   * that outlives the injector, each holding a closure over a destroyed one. The document
   * here is Karma's own, which outlives every spec in the suite.
   *
   * Destroying the *component* is not what releases them, which is why this spec resets
   * the test module: the listeners belong to the injector the app initializer ran in,
   * which is the environment injector, and it is still alive with the fixture gone.
   */
  it('removes every activity listener it added when the application is destroyed', () => {
    const harness = startIdleSession();
    const removed = spyOn(harness.doc, 'removeEventListener').and.callThrough();

    harness.destroy();
    TestBed.resetTestingModule();

    const removals = removed.calls
      .allArgs()
      .filter(([type]) => typeof type === 'string')
      .map(([type, , options]) => ({ type, options }));

    for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel']) {
      expect(removals).toContain({
        type,
        options: { capture: true, passive: true } as AddEventListenerOptions,
      });
    }
  });

  /**
   * The default clock is `performance.now()`, and the assertion is the one thing that
   * tells it from `Date.now()` without reading the source: its readings are milliseconds
   * since this document started, so they are six orders of magnitude smaller than epoch
   * milliseconds. `idle-countdown.ts` requires a monotonic clock because it measures an
   * interval, and `Date.now()` can move backwards while the page is open.
   */
  it('measures with a monotonic clock, not the wall clock', () => {
    TestBed.configureTestingModule({});
    const clock = TestBed.inject(IDLE_CLOCK);

    const first = clock();
    const second = clock();

    expect(second).toBeGreaterThanOrEqual(first);
    expect(first).toBeLessThan(Date.now() / 1_000);
  });
});
