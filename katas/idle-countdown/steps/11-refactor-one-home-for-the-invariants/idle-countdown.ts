/**
 * The idle-session decision, as three transitions over one immutable value.
 *
 * Nothing here touches Angular, the DOM, a timer or a clock. That is not tidiness: the
 * verdict "this session has been idle too long" is a question about two numbers, and a
 * function of two numbers can be driven through every case it has — the boundary
 * instant, a clock that jumped, a visitor who came back after the deadline — in a
 * millisecond each, with no test bed to arrange. `provide-idle-session.ts` is the part
 * that owns the clock, the listeners and the session, and it is deliberately thin.
 *
 * This module is also the subject of the repository's TDD kata, which is recorded step
 * by step in `katas/idle-countdown/` and replayed by `scripts/ci/assert-tdd-kata.mjs`.
 * Three of the four properties below exist because writing the test first turned up a
 * case the implementation got wrong; `docs/tdd.md` has the transcript.
 *
 * ## The clock contract
 *
 * `now` must come from a **monotonic** clock — `performance.now()`, not `Date.now()`.
 * Every function here measures an *interval*, and `Date.now()` is not a measure of
 * intervals: it is the operating system's idea of the wall clock, which an NTP
 * correction or a user changing the time zone can move in either direction while the
 * page is open. Moved backwards by an hour, `now - lastActivityAt` goes negative and a
 * session that should have ended keeps running for that hour.
 *
 * Nothing in this module defends against that, on purpose. A single sample cannot tell a
 * clock that jumped from a visitor who was idle, so the defence is to be handed a clock
 * that cannot jump — which is what {@link IDLE_CLOCK} provides and
 * `provide-idle-session.spec.ts` pins. Stating the contract in one place beats a
 * `Math.max(0, …)` in three that would make a broken clock look handled.
 */

/** The policy: how long a session may sit unused. */
export interface IdleWindow {
  /** Milliseconds of inactivity after which the session is over. */
  readonly idleAfterMs: number;
}

/** A live session, counting down from the last thing the user did. */
export interface CountingDown {
  readonly status: 'counting';
  /** Reading of the caller's monotonic clock at the last activity. */
  readonly lastActivityAt: number;
}

/** A session the countdown has ended. Terminal: no transition leaves this state. */
export interface Expired {
  readonly status: 'expired';
  /** Reading of the caller's monotonic clock when the deadline was noticed. */
  readonly expiredAt: number;
}

export type IdleCountdown = CountingDown | Expired;

/**
 * Start counting at `now`.
 *
 * The caller restarts the countdown whenever a session begins, which is not the same
 * instant the page loaded: a visitor who left the sign-in form open for an hour and then
 * signed in has an hour-old `lastActivityAt`, and a window that began before the session
 * did would end it on the first poll.
 */
export function countdownFrom(now: number): IdleCountdown {
  return { status: 'counting', lastActivityAt: now };
}

/** Move the deadline out to `now`, because the user did something at `now`. */
export function withActivityAt(countdown: IdleCountdown, now: number): IdleCountdown {
  return whileCounting(countdown, (counting) =>
    counting.lastActivityAt === now ? counting : { status: 'counting', lastActivityAt: now }
  );
}

/**
 * The verdict at `now`: expired once the session has been idle for the whole window.
 *
 * `>=` rather than `>`, so a window of exactly `idleAfterMs` is over at the instant it
 * elapses rather than one clock reading later.
 *
 * The verdict is a function of the two timestamps and nothing else — in particular not
 * of how often this is called. A tab the browser has throttled to one timer callback a
 * minute, or a machine that was asleep, reaches the same answer in one call that it
 * would have reached in nine hundred. The poll rate bounds how *late* expiry is noticed;
 * it cannot change whether the session expired.
 */
export function settledAt(
  countdown: IdleCountdown,
  now: number,
  idleWindow: IdleWindow
): IdleCountdown {
  return whileCounting(countdown, (counting) =>
    now - counting.lastActivityAt >= idleWindow.idleAfterMs
      ? { status: 'expired', expiredAt: now }
      : counting
  );
}

/**
 * Apply `transition` only while the countdown is still running, and hand back the value
 * that was passed in when it is not.
 *
 * Two invariants live here, and they are the two that are easiest to lose by writing an
 * obvious-looking transition:
 *
 * 1. **Expiry is terminal.** Activity arriving after the deadline must not revive the
 *    session — otherwise the mouse movement of someone returning to a laptop left open
 *    on a dashboard cancels the expiry that was meant to protect it, and the only
 *    sessions the feature ever ends are the ones nobody came back to.
 * 2. **Nothing changed means the same value back.** Callers detect the transition into
 *    `expired` by identity, so a transition that rebuilds an equal object reports a
 *    change on every poll: the sign-out fires once a poll for as long as the tab is
 *    open, and in a signal it would notify once a poll forever.
 *
 * Holding both in one place is the point. They are properties of *every* transition, so
 * a fourth one added later gets them by construction rather than by remembering to copy
 * two guards that look incidental.
 */
function whileCounting(
  countdown: IdleCountdown,
  transition: (counting: CountingDown) => IdleCountdown
): IdleCountdown {
  return countdown.status === 'expired' ? countdown : transition(countdown);
}
