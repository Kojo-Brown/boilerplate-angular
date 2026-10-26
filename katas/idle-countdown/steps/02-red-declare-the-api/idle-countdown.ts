/**
 * The idle-session decision: has this session been left alone for longer than the policy
 * allows?
 *
 * Nothing here touches Angular, the DOM, a timer or a clock. The verdict is a question
 * about two numbers, and `now` is a parameter so every case — the boundary instant, a
 * visitor who came back after the deadline, a poll that arrived an hour late — is one
 * call rather than a wait.
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
 * The verdict at `now`. Decides nothing yet: this step exists to get the spec past the
 * compiler so the assertion can be the thing that fails.
 */
export function settledAt(
  countdown: IdleCountdown,
  now: number,
  idleWindow: IdleWindow
): IdleCountdown {
  return countdown;
}
