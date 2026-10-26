/**
 * The idle-session decision, as the transitions of one immutable value.
 *
 * Nothing here touches Angular, the DOM, a timer or a clock. The verdict is a question
 * about two numbers, and `now` is a parameter so every case — the boundary instant, a
 * visitor who came back after the deadline, a poll that arrived an hour late — is one
 * call rather than a wait.
 *
 * `now` must come from a **monotonic** clock. Every function here measures an interval,
 * and `Date.now()` does not measure intervals: an NTP correction can move it in either
 * direction while the page is open.
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

/** A session the countdown has ended. */
export interface Expired {
  readonly status: 'expired';
  /** Reading of the caller's monotonic clock when the deadline was noticed. */
  readonly expiredAt: number;
}

export type IdleCountdown = CountingDown | Expired;

/** Start counting at `now`. */
export function countdownFrom(now: number): IdleCountdown {
  return { status: 'counting', lastActivityAt: now };
}

/**
 * The verdict at `now`: expired once the session has been idle for the whole window.
 *
 * `>=` rather than `>`, so a window of exactly `idleAfterMs` is over at the instant it
 * elapses rather than one clock reading later.
 *
 * The expired case returns early because the compiler insists: `lastActivityAt` is a
 * field of `CountingDown` and not of `Expired`, so the union cannot be read without
 * first establishing which state it is in.
 */
export function settledAt(
  countdown: IdleCountdown,
  now: number,
  idleWindow: IdleWindow
): IdleCountdown {
  if (countdown.status === 'expired') {
    return countdown;
  }

  return now - countdown.lastActivityAt >= idleWindow.idleAfterMs
    ? { status: 'expired', expiredAt: now }
    : countdown;
}

/** Move the deadline out to `now`, because the user did something at `now`. */
export function withActivityAt(countdown: IdleCountdown, now: number): IdleCountdown {
  // Expiry is terminal. Without this, the mouse movement of someone returning to a
  // laptop left open on a dashboard cancels the expiry that was meant to protect it.
  if (countdown.status === 'expired') {
    return countdown;
  }

  // Nothing changed, so hand back the value that was passed in. The caller applies the
  // recorded activity on every poll and detects a change by identity, so an equal-but-new
  // object reports a change once a poll for as long as the tab is open.
  if (countdown.lastActivityAt === now) {
    return countdown;
  }

  return { status: 'counting', lastActivityAt: now };
}
