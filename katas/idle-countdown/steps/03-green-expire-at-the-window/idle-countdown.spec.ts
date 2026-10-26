import { countdownFrom, settledAt } from './idle-countdown';
import type { IdleCountdown, IdleWindow } from './idle-countdown';

/** The policy `app.config.ts` ships. */
const FIFTEEN_MINUTES: IdleWindow = { idleAfterMs: 15 * 60_000 };

/**
 * A reading of a monotonic clock, which is what every function here takes — so the
 * numbers are milliseconds since the page started, not since 1970, and a small
 * non-zero one is the realistic case. Zero would hide an implementation that happened
 * to work only because it was comparing against a falsy value.
 */
const PAGE_LOAD = 1_234;

/**
 * `expiredAt` read through a narrowing, because the union is the point: a running
 * countdown has no `expiredAt` field, so the compiler refuses to let a spec read one
 * without first establishing the state it is asserting about. The alternative — a
 * `status` flag beside a nullable timestamp — would let every one of these assertions
 * compile against a value that cannot hold them.
 */
function expiredAtOf(countdown: IdleCountdown): number | null {
  return countdown.status === 'expired' ? countdown.expiredAt : null;
}

describe('idleCountdown', () => {
  describe('settledAt', () => {
    it('expires a session that has been idle for the whole window', () => {
      const countdown = countdownFrom(PAGE_LOAD);

      const settled = settledAt(
        countdown,
        PAGE_LOAD + FIFTEEN_MINUTES.idleAfterMs,
        FIFTEEN_MINUTES
      );

      expect(settled.status).toBe('expired');
    });

    /**
     * The boundary, from the other side. On its own this assertion cannot fail — a
     * `settledAt` that does nothing at all passes it — which is exactly why it is here
     * beside the one above rather than instead of it.
     */
    it('leaves a session one millisecond short of the window running', () => {
      const countdown = countdownFrom(PAGE_LOAD);

      const settled = settledAt(
        countdown,
        PAGE_LOAD + FIFTEEN_MINUTES.idleAfterMs - 1,
        FIFTEEN_MINUTES
      );

      expect(settled.status).toBe('counting');
    });

    it('reports the reading the deadline was noticed at', () => {
      const noticedAt = PAGE_LOAD + FIFTEEN_MINUTES.idleAfterMs + 7_000;

      const settled = settledAt(countdownFrom(PAGE_LOAD), noticedAt, FIFTEEN_MINUTES);

      expect(expiredAtOf(settled)).toBe(noticedAt);
    });

    /**
     * The property that makes the poll rate a detection delay rather than part of the
     * policy. A browser throttles timers in a background tab to roughly one callback a
     * minute, and a suspended machine runs none at all; both arrive at a single call
     * with a long gap behind it. Asserting the two paths agree is what says the verdict
     * is a function of the clock and not of how often it was asked.
     */
    it('reaches the same verdict in one late call as in every call it missed', () => {
      const window = { idleAfterMs: 60_000 };
      const start = countdownFrom(PAGE_LOAD);

      const once = settledAt(start, PAGE_LOAD + 600_000, window);

      let polled: IdleCountdown = start;
      for (let elapsed = 1_000; elapsed <= 600_000; elapsed += 1_000) {
        polled = settledAt(polled, PAGE_LOAD + elapsed, window);
      }

      expect(once.status).toBe('expired');
      expect(polled.status).toBe('expired');
      // The readings differ — the late caller notices at 600s, the busy one at 60s —
      // and that difference is the detection delay, which is the only thing the poll
      // rate is allowed to change.
      expect(expiredAtOf(once)).toBe(PAGE_LOAD + 600_000);
      expect(expiredAtOf(polled)).toBe(PAGE_LOAD + 60_000);
    });
  });
});
