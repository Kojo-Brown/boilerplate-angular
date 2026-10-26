import { DOCUMENT } from '@angular/common';
import type { EnvironmentProviders } from '@angular/core';
import {
  DestroyRef,
  InjectionToken,
  afterNextRender,
  computed,
  effect,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { intervalSignal } from '@/app/core/reactivity/interval-signal';
import { AuthFacade } from '@/app/core/auth/auth.facade';
import { countdownFrom, settledAt, withActivityAt } from './idle-countdown';
import type { IdleCountdown, IdleWindow } from './idle-countdown';

/**
 * A monotonic clock, in milliseconds, for measuring how long the session has sat unused.
 *
 * `performance.now()` and deliberately **not** `Date.now()`. What this feature measures
 * is an interval, and `Date.now()` does not measure intervals: it reports the operating
 * system's wall clock, which an NTP correction, a daylight-saving change or a user
 * editing the system time can move in either direction while the page is open. Moved
 * backwards by an hour, the arithmetic in `settledAt` goes negative and a session that
 * should have ended stays alive for that hour — silently, since nothing about the page
 * looks wrong. `performance.now()` is specified to be monotonically non-decreasing and
 * is not affected by clock adjustments, which is the property `idle-countdown.ts`
 * documents as its contract and this token exists to satisfy.
 *
 * It also exists so specs can hand the feature a clock they control, which is the only
 * way to drive a fifteen-minute window without waiting fifteen minutes.
 *
 * Available on the server too: Node has had `performance` as a global since 16, and the
 * readings are milliseconds since this process (or this document) started rather than
 * since 1970 — so they are small numbers, and comparing one against a `Date.now()`
 * reading is a bug rather than a unit mismatch to paper over.
 */
export const IDLE_CLOCK = new InjectionToken<() => number>('IDLE_CLOCK', {
  providedIn: 'root',
  factory: () => () => performance.now(),
});

/** The window {@link provideIdleSessionTimeout} was configured with. */
export const IDLE_WINDOW = new InjectionToken<IdleWindow>('IDLE_WINDOW');

/**
 * How often the countdown is asked whether the window has elapsed.
 *
 * This is not the policy — {@link IdleWindow} is — and it is not a second deadline. The
 * verdict is computed from two clock readings, so the poll rate bounds only how *late*
 * expiry is noticed: at fifteen seconds, a session that lapsed is signed out within
 * fifteen seconds of lapsing, and a browser that has throttled this tab's timers to one
 * callback a minute signs it out within a minute. Neither can keep a lapsed session
 * alive, which is what makes this number a cost/latency trade and not a security
 * parameter. `idle-countdown.spec.ts` pins that property directly.
 */
export const IDLE_POLL_MS = 15_000;

/**
 * The events that count as the user being present.
 *
 * Chosen to be the smallest set that covers a person who is there, with two deliberate
 * omissions. `focusin` is not here: this application moves focus itself after every
 * navigation (`core/a11y/route-focus.ts`), so a focus event is as likely to be the
 * framework as the user, and counting it would let a redirect loop hold a session open.
 * Nor is `scroll`, for the same reason — `scrollIntoView` and anchor navigation both
 * produce one with nobody touching anything. What is left is input: keys, pointers and
 * the wheel, all of which a person has to do.
 *
 * `pointerdown` and `pointermove` cover mouse, touch and pen in one event each, so
 * `mousedown`/`touchstart` would only add duplicates of what has already been recorded.
 */
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;

/**
 * `capture` so that activity is still seen when something stops the event, and `passive`
 * because none of these listeners will ever call `preventDefault`.
 *
 * The capture phase is the half that is easy to get wrong. A listener in the bubble
 * phase sees an event only if every handler between the target and the document lets it
 * through, and `stopPropagation()` in a dialog, a menu or a drag implementation is
 * ordinary defensive code — so a document-level listener in the bubble phase reports a
 * user who is typing into exactly those components as absent. Capture runs from the
 * document downwards, before any of them.
 *
 * `passive: true` tells the browser the listener cannot cancel the gesture, so scrolling
 * and panning are never blocked waiting for it. On `pointermove` and `wheel` — the two
 * high-frequency events here — that is the difference between a scroll that stays on the
 * compositor and one that does not.
 */
const ACTIVITY_LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

/**
 * End the session after `idleWindow.idleAfterMs` with no user input.
 *
 * What this is worth is bounded and worth stating: it protects a signed-in page left
 * open on a screen somebody else can reach, and it bounds how long a stolen refresh
 * cookie keeps answering if the tab it was stolen from is still open. It does nothing
 * about a closed laptop or a stolen credential used elsewhere — `docs/token-storage.md`
 * draws that line, and this is the other half of it: the refresh cookie is good for
 * thirty days, and nothing before this made the *tab* stop using it.
 *
 * ## Why no visible warning
 *
 * Because there is nowhere honest to put one yet. A countdown dialog is a feature of its
 * own — a focus trap, a live region, two translated strings, a route budget — and
 * `idle-countdown.ts` can already answer "how long is left" for whoever builds it. Until
 * then this behaves exactly as the sign-out button does, which is the comparison that
 * matters: `AuthFacade.signOut()` clears the session and the interface reacts to
 * `isSignedIn`. A user who comes back to a signed-out page sees what they would have
 * seen had they pressed it themselves. `docs/tdd.md` lists it as the known gap it is.
 *
 * ## Zoneless
 *
 * `pointermove` arrives hundreds of times a second and the handler writes a plain
 * `let` — not a signal. That is the whole reason it is a plain field: a `signal.set` per
 * pointer event would schedule a change-detection pass per pointer event, which is the
 * one way a presence detector can make an application feel worse than not having it.
 * The signal in this loop is `intervalSignal`'s counter, which moves once per poll, and
 * the effect reads the recorded timestamp as data when it does. See `docs/zoneless.md`.
 */
export function provideIdleSessionTimeout(idleWindow: IdleWindow): EnvironmentProviders {
  if (!Number.isFinite(idleWindow.idleAfterMs) || idleWindow.idleAfterMs <= 0) {
    throw new RangeError(
      'provideIdleSessionTimeout: idleAfterMs must be a finite number of milliseconds greater than zero.'
    );
  }

  return makeEnvironmentProviders([
    { provide: IDLE_WINDOW, useValue: idleWindow },
    provideAppInitializer(() => {
      startIdleSessionTimeout();
    }),
  ]);
}

/**
 * The loop, in an injection context.
 *
 * Registered from an app initializer rather than from a service nothing injects: the
 * countdown has to run whether or not any component asked for it, and a `providedIn:
 * 'root'` service that is never injected is never constructed.
 */
function startIdleSessionTimeout(): void {
  const doc = inject(DOCUMENT);
  const destroyRef = inject(DestroyRef);
  const clock = inject(IDLE_CLOCK);
  const auth = inject(AuthFacade);
  const idleWindow = inject(IDLE_WINDOW);

  /**
   * The last reading at which the user did something, and the countdown measuring it.
   * Both plain fields: see the zoneless note above, and nothing renders either of them.
   *
   * `null` is "there is no session to count", which is a third state rather than a
   * missing value: it is what the window starting at the session rather than at the page
   * load looks like in a field.
   */
  let lastActivityAt = clock();
  let countdown: IdleCountdown | null = null;

  const recordActivity = (): void => {
    lastActivityAt = clock();
  };

  afterNextRender(() => {
    for (const type of ACTIVITY_EVENTS) {
      doc.addEventListener(type, recordActivity, ACTIVITY_LISTENER_OPTIONS);
    }

    destroyRef.onDestroy(() => {
      for (const type of ACTIVITY_EVENTS) {
        doc.removeEventListener(type, recordActivity, ACTIVITY_LISTENER_OPTIONS);
      }
    });
  });

  /**
   * No timer at all while there is no session to lose. `null` pauses `intervalSignal`
   * by tearing its timer down, so an anonymous visitor — and the server, where
   * `isSignedIn` is false through every render — pays nothing for this feature.
   */
  const pollPeriod = computed(() => (auth.isSignedIn() ? IDLE_POLL_MS : null));
  const poll = intervalSignal(pollPeriod, { debugName: 'idleSessionPoll' });

  effect(
    () => {
      const signedIn = auth.isSignedIn();
      // The reactive dependency that makes this effect a loop. Read unconditionally and
      // before the early return below, so a signed-out pass still subscribes to it.
      poll();

      const now = clock();

      if (!signedIn) {
        // No session, nothing to count, and nothing left behind for the next one to
        // inherit.
        countdown = null;
        return;
      }

      if (countdown === null) {
        // The window belongs to the session, so it starts on the pass that first sees
        // one. Deriving it from the page load instead is a bug with no error anywhere:
        // a visitor who leaves the sign-in form open for longer than the window is
        // signed out by the first poll after signing in, which presents as "this
        // application will not let me stay signed in".
        //
        // It has to happen here rather than on the signed-out pass above, and that is
        // the part that is easy to get wrong: while nobody is signed in the poll is
        // paused, so this effect does not re-run and a timestamp refreshed on that pass
        // is as old as the moment the session ended. There is exactly one pass where
        // the countdown can be given a current reading, and it is this one.
        lastActivityAt = now;
        countdown = countdownFrom(now);
        return;
      }

      const next = settledAt(withActivityAt(countdown, lastActivityAt), now, idleWindow);
      if (next === countdown) return;

      countdown = next;
      if (next.status === 'expired') {
        // Once. `withActivityAt` and `settledAt` both hand back the countdown they were
        // given once it is expired, so this branch cannot be reached twice for one
        // expiry — which matters because `signOut()` also sends a revocation request.
        auth.signOut();
      }
    },
    { debugName: 'idleSessionTimeout' }
  );
}
