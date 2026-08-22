import { DestroyRef, inject, Injector, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, concat, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import type { Observable } from 'rxjs';
import type { Signal } from '@angular/core';

/** What the typeahead is doing right now. */
export type TypeaheadStatus = 'idle' | 'searching' | 'ready' | 'error';

export interface TypeaheadOptions {
  /** Quiet period before a term is searched, in milliseconds. Defaults to 300. */
  debounceMs?: number;
  /** Shortest term worth a request. Anything shorter resets to `idle`. Defaults to 2. */
  minLength?: number;
  /**
   * Injector that owns the subscription. Required when `typeahead` is called outside an
   * injection context (a lifecycle hook, an event handler, an async callback).
   */
  injector?: Injector;
}

export interface Typeahead<T> {
  /** Results for the term in `term()`. Empty in every state but a `ready` one with hits. */
  readonly results: Signal<readonly T[]>;
  readonly status: Signal<TypeaheadStatus>;
  /** Whatever `search` failed with, or `null`. Left unnarrowed — the caller knows its API. */
  readonly error: Signal<unknown>;
  /**
   * The term `results`, `status` and `error` describe — trimmed, and behind the raw query
   * by the debounce. A view that renders "No results for X" has to read this one: the raw
   * query has usually moved on by the time the answer lands.
   */
  readonly term: Signal<string>;
}

/** One settled step of the pipeline. Modelled as a value so the projection stays pure. */
type TypeaheadEvent<T> =
  | { readonly kind: 'idle'; readonly term: string }
  | { readonly kind: 'searching'; readonly term: string }
  | { readonly kind: 'ready'; readonly term: string; readonly results: readonly T[] }
  | { readonly kind: 'error'; readonly term: string; readonly error: unknown };

/**
 * A search-as-you-type pipeline: debounce the query, drop repeats, and keep only the
 * newest request's answer.
 *
 * ```ts
 * readonly query = signal('');
 * readonly search = typeahead(this.query, (term) => this.postsService.search(term));
 * ```
 *
 * `switchMap` is the operator this is built on, and the choice is the whole point — see
 * [`docs/rxjs-flattening.md`](../../../../docs/rxjs-flattening.md). Each new term
 * unsubscribes from the request in flight, which for `HttpClient` aborts it, so a slow
 * response for `"ang"` can never overwrite a fast one for `"angular"`. `mergeMap` here
 * renders whichever response happens to land last; `concatMap` queues them, so the answer
 * lags the box by the sum of every keystroke's latency; `exhaustMap` drops keystrokes
 * while a request is open, which for a search box means showing results for a prefix the
 * user has already typed past.
 *
 * Order inside the pipe matters as much as the operator:
 *
 * - `debounceTime` before `switchMap`, so a fast typist costs one request rather than one
 *   per keystroke that `switchMap` then has to cancel.
 * - `distinctUntilChanged` after the trim, so `"ng "` → `"ng"` is not a new search — and
 *   after the debounce, where it compares the terms that were actually going to be sent.
 * - `catchError` on the **inner** Observable. On the outer one it would end the pipeline:
 *   the first failed search would leave the box permanently dead. Failures are modelled
 *   as an `error` event instead, and the next keystroke searches normally.
 *
 * The subscription is torn down with the owning injector, so an in-flight request is
 * aborted when the component is destroyed.
 *
 * @param query Raw query signal — usually bound straight to the input.
 * @param search Runs one search. Must return an **Observable**: `switchMap` cancels by
 *   unsubscribing, and a Promise has no teardown to invoke, so a Promise-returning search
 *   leaves every superseded request running to completion.
 * @param options Debounce, minimum length, and the owning injector.
 * @throws RangeError if `debounceMs` is negative, `NaN` or infinite, or if `minLength` is
 *   not a positive integer.
 */
export function typeahead<T>(
  query: Signal<string>,
  search: (term: string) => Observable<readonly T[]>,
  options: TypeaheadOptions = {}
): Typeahead<T> {
  const debounceMs = options.debounceMs ?? 300;
  const minLength = options.minLength ?? 2;

  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new RangeError('typeahead: debounceMs must be a finite, non-negative number.');
  }
  if (!Number.isInteger(minLength) || minLength < 1) {
    throw new RangeError('typeahead: minLength must be a positive integer.');
  }

  const injector = options.injector ?? inject(Injector);
  const results = signal<readonly T[]>([]);
  const status = signal<TypeaheadStatus>('idle');
  const error = signal<unknown>(null);
  const term = signal('');

  toObservable(query, { injector })
    .pipe(
      map((raw) => raw.trim()),
      debounceTime(debounceMs),
      distinctUntilChanged(),
      switchMap((searchTerm): Observable<TypeaheadEvent<T>> => {
        if (searchTerm.length < minLength) {
          return of<TypeaheadEvent<T>>({ kind: 'idle', term: searchTerm });
        }

        // `concat` rather than a `tap` that writes `status`: the projection stays a pure
        // function of the term, and "went searching, then settled" becomes two emissions
        // a spec can assert on in order.
        return concat(
          of<TypeaheadEvent<T>>({ kind: 'searching', term: searchTerm }),
          search(searchTerm).pipe(
            map((found): TypeaheadEvent<T> => ({
              kind: 'ready',
              term: searchTerm,
              results: found,
            })),
            // Inner, not outer: see the note above.
            catchError((err: unknown) =>
              of<TypeaheadEvent<T>>({ kind: 'error', term: searchTerm, error: err })
            )
          )
        );
      }),
      takeUntilDestroyed(injector.get(DestroyRef))
    )
    .subscribe((event) => {
      term.set(event.term);
      status.set(event.kind);
      results.set(event.kind === 'ready' ? event.results : []);
      error.set(event.kind === 'error' ? event.error : null);
    });

  return {
    results: results.asReadonly(),
    status: status.asReadonly(),
    error: error.asReadonly(),
    term: term.asReadonly(),
  };
}
