import { DestroyRef, inject } from '@angular/core';
import type { Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, take, tap, timer } from 'rxjs';
import type { Observable } from 'rxjs';
import type { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';

/** {@link asyncCrossFieldValidator}'s debounce when the caller does not pick one. */
const DEFAULT_DEBOUNCE_MS = 400;

/** How many settled answers {@link asyncCrossFieldValidator} remembers by default. */
const DEFAULT_CACHE_SIZE = 20;

export interface AsyncCrossFieldOptions<TKey> {
  /**
   * Quiet period before a key is sent to `check`, in milliseconds. Defaults to 400 —
   * longer than a typeahead's, because the answer is a blocking error message rather
   * than a list the user can ignore.
   */
  debounceMs?: number;
  /**
   * Compares two keys. Defaults to `Object.is`, which is right for a string key and
   * wrong for an object one — a composite key needs either a `string` spelling or an
   * `equal` that looks at its fields, or the cache never hits and the validator
   * re-checks a pair it has already settled.
   */
  equal?: (a: TKey, b: TKey) => boolean;
  /**
   * What the control gets when `check` errors. Defaults to `null` — fail open.
   *
   * That default is a decision, not an omission. This validator stands in front of a
   * network, and a form that refuses to submit because a *validation* request timed out
   * has turned an availability blip into a lost sign-up. The server still rejects the
   * submission it was going to reject; the client just stops pretending it knew first.
   * Pass an errors object for the rare rule where letting a value through is the more
   * expensive mistake.
   */
  onFailure?: ValidationErrors | null;
  /**
   * How many settled answers to remember. 0 disables the cache. Defaults to 20.
   *
   * A cache is not an optimisation here, it is what makes {@link revalidateWhen}
   * affordable: every keystroke in a sibling field re-runs this validator, and without
   * memoisation each one would re-send a pair that has already been answered.
   */
  cacheSize?: number;
}

/**
 * An {@link AsyncValidatorFn} that debounces, cancels, and de-duplicates a server-side
 * check of a value assembled from **more than one control**.
 *
 * ```ts
 * const inviteControl = form.controls.inviteCode;
 *
 * inviteControl.addAsyncValidators(
 *   asyncCrossFieldValidator(
 *     (control) => {
 *       const email = control.parent?.get('email')?.value as string | undefined;
 *       const code = control.value as string;
 *       return email && code ? `${email}\u0000${code}` : null;
 *     },
 *     (key) => invites.check(...key.split('\u0000'))
 *   )
 * );
 * ```
 *
 * ## The three behaviours, and where each one comes from
 *
 * **Debounce** is `timer(debounceMs)` at the head of the returned Observable rather than
 * a `debounceTime` operator, because there is no long-lived stream to debounce: Angular
 * calls an async validator afresh on every revalidation and subscribes to whatever comes
 * back. A delay before the work starts is the only shape a debounce can take here.
 *
 * **Cancellation** is Angular's, and it is why the delay has to be *inside* the returned
 * Observable. `AbstractControl.updateValueAndValidity()` unsubscribes the previous async
 * validation run before starting the next one, which clears a pending `timer` and aborts
 * an `HttpClient` request already in flight. A debounce applied outside — around the
 * caller, or by scheduling the `addAsyncValidators` call — is invisible to that
 * mechanism and leaves superseded requests running.
 *
 * **De-duplication** is `keyOf` plus the cache. A cross-field validator is re-run by
 * every field it reads, so the same pair arrives many times over; returning a remembered
 * answer synchronously means the control never goes `PENDING` for a question that has
 * already been answered.
 *
 * ## `take(1)`, and why a missing one is not a test failure
 *
 * A control stays `PENDING` until its async validator's Observable **completes** —
 * emitting is not enough, and `status` is what `form.valid` and every disabled submit
 * button read. `HttpClient` completes after one response, so the bug hides: the form
 * works against the real transport and hangs against a `BehaviorSubject` in a spec, a
 * `toObservable` bridge, or any check that outlives its answer. `take(1)` is applied
 * here so no caller has to remember it.
 *
 * ## What this does not do
 *
 * It does not decide *which* control carries the error. Angular runs a control's async
 * validators only when that control's own synchronous validators pass, and a `FormGroup`
 * is the whole form — so hanging the check on the group means no request is ever sent
 * while any field is still empty, and the invite error appears only after the password
 * fields are filled in. Putting it on the field the message belongs to, and reaching up
 * through `control.parent` for the rest of the key, keeps the message next to its input
 * and the request independent of unrelated fields. {@link revalidateWhen} is the other
 * half: a control is not revalidated when a *sibling* changes, so the dependency has to
 * be declared.
 *
 * See [`docs/async-validators.md`](../../../../docs/async-validators.md).
 *
 * @param keyOf Projects the control (and whatever it reaches through `parent`) onto the
 *   value the check actually depends on. Return `null` to skip the check entirely and
 *   report no error — an incomplete pair is not an invalid one.
 * @param check Runs one check. Must return an **Observable**: cancellation here is
 *   unsubscription, and a Promise has no teardown to invoke, so a Promise-returning
 *   check leaves every superseded request running to completion.
 * @param options Debounce, key equality, failure policy and cache size.
 * @throws RangeError if `debounceMs` is negative, `NaN` or infinite, or if `cacheSize`
 *   is not a non-negative integer.
 */
export function asyncCrossFieldValidator<TKey>(
  keyOf: (control: AbstractControl) => TKey | null,
  check: (key: TKey) => Observable<ValidationErrors | null>,
  options: AsyncCrossFieldOptions<TKey> = {}
): AsyncValidatorFn {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;
  const equal = options.equal ?? Object.is;
  const onFailure = options.onFailure ?? null;

  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new RangeError(
      'asyncCrossFieldValidator: debounceMs must be a finite, non-negative number.'
    );
  }
  if (!Number.isInteger(cacheSize) || cacheSize < 0) {
    throw new RangeError('asyncCrossFieldValidator: cacheSize must be a non-negative integer.');
  }

  // Insertion-ordered and bounded. An array rather than a `Map` because the keys are
  // compared with `equal` and not by identity, which `Map` cannot be told to do.
  const settled: { key: TKey; errors: ValidationErrors | null }[] = [];

  const remembered = (key: TKey): { errors: ValidationErrors | null } | undefined =>
    settled.find((entry) => equal(entry.key, key));

  const remember = (key: TKey, errors: ValidationErrors | null): void => {
    if (cacheSize === 0) return;
    if (remembered(key)) return;
    settled.push({ key, errors });
    if (settled.length > cacheSize) settled.shift();
  };

  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    const key = keyOf(control);
    if (key === null) return of(null);

    const hit = remembered(key);
    // Synchronous, so the control never enters `PENDING` for a settled pair. Angular
    // subscribes immediately, `of` emits and completes in that call, and the status goes
    // straight from the sync validators' verdict to this one.
    if (hit) return of(hit.errors);

    return timer(debounceMs).pipe(
      switchMap(() => check(key)),
      take(1),
      tap((errors) => remember(key, errors)),
      // After `tap`, so a transport failure is never memoised: the next keystroke that
      // produces the same pair should try again rather than inherit a verdict the server
      // never gave.
      catchError(() => of(onFailure))
    );
  };
}

export interface RevalidateWhenOptions {
  /**
   * Injector owning the subscriptions. Required when `revalidateWhen` is called outside
   * an injection context (a lifecycle hook, an event handler, an async callback).
   */
  injector?: Injector;
}

/**
 * Re-run `target`'s validators whenever any of `sources` changes value.
 *
 * ```ts
 * revalidateWhen(form.controls.inviteCode, [form.controls.email]);
 * ```
 *
 * Reactive forms revalidate a control when *that* control changes. A validator that
 * reads a sibling therefore holds a verdict about a value it can no longer see: correct
 * an invite code's email and the "not valid for this address" message stays on screen,
 * and the form stays invalid, until the code itself is touched. Declaring the dependency
 * is what closes that gap, and it is the price of putting a cross-field rule on a field
 * rather than on the group.
 *
 * Pair it with {@link asyncCrossFieldValidator} rather than with a bare async validator.
 * Every keystroke in a source revalidates the target, so without that function's key
 * projection and cache this turns one request per keystroke in one field into one per
 * keystroke in several.
 *
 * Each subscription is torn down with the owning injector.
 *
 * @param target Control whose validators re-run.
 * @param sources Controls it depends on.
 * @param options `injector` when called outside an injection context.
 * @throws Error if a source is `target` itself or one of its ancestors. Revalidating a
 *   control updates its ancestors, whose `valueChanges` would then feed straight back
 *   into this subscription — an infinite loop that presents as a frozen tab rather than
 *   as a stack overflow, because each turn is scheduled rather than recursive.
 */
export function revalidateWhen(
  target: AbstractControl,
  sources: readonly AbstractControl[],
  options: RevalidateWhenOptions = {}
): void {
  const destroyRef = options.injector?.get(DestroyRef) ?? inject(DestroyRef);

  for (const source of sources) {
    assertNotSelfOrAncestor(source, target);

    source.valueChanges
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => target.updateValueAndValidity());
  }
}

function assertNotSelfOrAncestor(source: AbstractControl, target: AbstractControl): void {
  for (let node: AbstractControl | null = target; node !== null; node = node.parent) {
    if (node === source) {
      throw new Error(
        'revalidateWhen: a source may not be the target or one of its ancestors — ' +
          'revalidating the target updates its ancestors, which would re-enter this subscription.'
      );
    }
  }
}
