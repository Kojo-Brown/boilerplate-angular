import { EmptyError } from 'rxjs';
import type { Observable } from 'rxjs';

/**
 * Await an Observable request, cancelling it if `abortSignal` aborts.
 *
 * This is the bridge between Angular's two cancellation vocabularies. `resource()` hands
 * its loader an `AbortSignal` and expects the loader to honour it; `HttpClient` cancels
 * through unsubscription, and `lastValueFrom` — the usual way to await it — throws the
 * subscription away, so the request it started runs to completion even after the
 * resource has moved on. Unsubscribing is what actually aborts the underlying `XHR` or
 * `fetch`, so this function keeps the subscription and drops it when the signal fires.
 *
 * ```ts
 * resource({
 *   params: () => this.query(),
 *   loader: ({ params, abortSignal }) =>
 *     abortableRequest(this.api.get<Result>('/search', { params }), abortSignal),
 * });
 * ```
 *
 * Resolution mirrors `lastValueFrom`, so it is a drop-in replacement: the promise settles
 * with the last value the source emitted before completing, rejects with the source's
 * error, and rejects with `EmptyError` if the source completes without emitting.
 *
 * On abort the promise rejects with `abortSignal.reason` — a `DOMException` named
 * `AbortError` when the abort came from `resource()`, which calls `abort()` without a
 * reason. `resource()` discards both the value and the error of a load it has already
 * aborted, so that rejection never reaches the resource's `error()`; it is observable
 * only by a caller awaiting this promise directly.
 *
 * @param source Cold Observable to subscribe to. Subscription happens here, so the
 *   request is not sent at all when `abortSignal` has already been aborted.
 * @param abortSignal Signal whose abort cancels the request.
 */
export function abortableRequest<T>(source: Observable<T>, abortSignal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (abortSignal.aborted) {
      reject(abortReason(abortSignal));
      return;
    }

    let settled = false;
    let hasValue = false;
    let lastValue: T | undefined;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      subscription.unsubscribe();
      reject(abortReason(abortSignal));
    };

    /** Stop listening for an abort that can no longer cancel anything. */
    const finish = (): void => {
      settled = true;
      abortSignal.removeEventListener('abort', onAbort);
    };

    const subscription = source.subscribe({
      next: (value) => {
        hasValue = true;
        lastValue = value;
      },
      error: (error: unknown) => {
        finish();
        reject(error);
      },
      complete: () => {
        finish();
        if (hasValue) {
          resolve(lastValue as T);
        } else {
          reject(new EmptyError());
        }
      },
    });

    // A source that completed synchronously during `subscribe` has already settled the
    // promise; registering a listener now would only leak it, since nothing would ever
    // remove it from a long-lived signal.
    if (settled) return;

    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The value an aborted request rejects with. `AbortSignal.reason` is typed `any` by
 * `lib.dom`, and is absent on runtimes predating its addition, so it is narrowed to
 * `unknown` and defaulted here rather than at each call site.
 */
function abortReason(abortSignal: AbortSignal): unknown {
  const reason: unknown = abortSignal.reason;
  return reason ?? new DOMException('The request was aborted.', 'AbortError');
}
