import { of } from 'rxjs';
import type { Observable } from 'rxjs';
import type { InviteCheckResult, InviteCheckerApi } from '@/app/features/auth/invite.service';

/**
 * A stand-in for `InviteService`.
 *
 * It extends `InviteCheckerApi` rather than restating it, so a method added to the real
 * service is a compile error here until it is added to the double as well.
 */
export interface FakeInviteChecker extends InviteCheckerApi {
  readonly check: jasmine.Spy<(email: string, code: string) => Observable<InviteCheckResult>>;
  /**
   * Decides the answer for one pair. Replace it mid-spec to script a scenario — it is
   * read at call time, not captured when the double is built.
   */
  answer: (email: string, code: string) => InviteCheckResult;
}

/**
 * The double, answering **synchronously**.
 *
 * That is deliberate and it is what keeps a component spec about the component: the
 * asynchrony worth asserting on at this level is `asyncCrossFieldValidator`'s debounce,
 * which is a timer in the validator and is driven by `tick()`. Cancelling a request that
 * is genuinely in flight is a property of the validator, and is asserted against a real
 * `HttpTestingController` in `async-cross-field.spec.ts`, where `TestRequest.cancelled`
 * can say so — a hand-rolled fake would only be able to confirm its own bookkeeping.
 *
 * @param answer The initial verdict function. Accepts every pair by default.
 */
export function createFakeInviteChecker(
  answer: (email: string, code: string) => InviteCheckResult = () => ({ problem: null })
): FakeInviteChecker {
  const fake: FakeInviteChecker = {
    answer,
    check: jasmine
      .createSpy('check')
      .and.callFake((email: string, code: string) => of(fake.answer(email, code))),
  };

  return fake;
}
