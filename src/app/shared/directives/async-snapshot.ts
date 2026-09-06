import { computed } from '@angular/core';
import type { ResourceRef, Signal } from '@angular/core';

/**
 * One asynchronous read, collapsed to the three states a template can render.
 *
 * A discriminated union rather than four independent booleans, because the states are
 * mutually exclusive and a template that reads them separately has to be *told* that —
 * usually as a comment about branch order, which is what
 * [`PostDetailComponent`](../../features/posts/post-detail.component.ts) carried before
 * this type existed. Here the compiler carries it: `value` is reachable only after `kind`
 * has been checked, and `error` only in the branch that has one.
 *
 * `loading` covers "not started" as well. An idle `resource()` — one whose `params`
 * returned `undefined`, which is how an unset route input is spelled — and a query that
 * has not been enabled yet are the same thing to a view: nothing to show and no failure
 * to report. Distinguishing them would add a fourth state whose only rendering is the
 * third one's.
 */
export type AsyncSnapshot<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'value'; readonly value: T };

/**
 * The part of a TanStack Query result this adapter reads.
 *
 * Declared structurally so `shared/directives` does not depend on
 * `@tanstack/angular-query-experimental` — a UI primitive that names one server-state
 * library in its imports is a primitive the next library cannot use, and this repo
 * deliberately ships two (see [`docs/signals.md`](../../../../docs/signals.md)).
 */
export interface QueryLike<T> {
  readonly status: Signal<'pending' | 'error' | 'success'>;
  readonly error: Signal<unknown>;
  readonly data: Signal<T | undefined>;
}

/**
 * A `resource()` as an `AsyncSnapshot`.
 *
 * The order of the reads is the whole point. `value()` **throws** in the error state, so
 * `status()` is checked first and the error branch returns before anything touches the
 * value; `hasValue()` then decides between a value and a skeleton, and it is a type guard,
 * so `value()` below it is `T` rather than `T | undefined`. Getting this wrong does not
 * fail a build or a happy-path spec — it throws in a browser, on the one path a user
 * reaches when the network does not cooperate.
 *
 * A `reloading` resource keeps the value it already had, so this reports `value` and the
 * view holds still instead of flashing a skeleton over data that is still on screen.
 * Nothing in this application calls `reload()` today; when something does, that is the
 * behaviour it gets. A *parameter* change is different — `resource` drops the old value
 * and this reports `loading`, which is what a route moving from one post to another
 * should look like.
 */
export function resourceSnapshot<T>(ref: ResourceRef<T | undefined>): Signal<AsyncSnapshot<T>> {
  return computed<AsyncSnapshot<T>>(() => {
    if (ref.status() === 'error') {
      return { kind: 'error', error: ref.error() };
    }

    return ref.hasValue() ? { kind: 'value', value: ref.value() } : { kind: 'loading' };
  });
}

/**
 * A TanStack Query result as an `AsyncSnapshot`.
 *
 * `status()` is read first for the same reason the resource adapter reads it first: a failed
 * query keeps `data()` at whatever it last held — `undefined` on a first load, but the
 * *previous* result on a refetch — so a view that asked "is there data?" first would go on
 * rendering stale rows while the refresh behind them was failing.
 *
 * `status` rather than the `isError` beside it, even though both are live and both read the
 * same field. TanStack types its `isPending`/`isError`/`isSuccess` as narrowing predicates
 * (`(this: CreateBaseQueryResult<…>) => this is …`) whose `this` is the concrete query
 * result — a shape only that library can produce — so a structural interface that asked for
 * one would be asking for the very dependency this indirection exists to avoid. `status` is
 * an ordinary `Signal`.
 *
 * `isPending` would be redundant besides. Once the error branch has returned, the absence of
 * data *is* the loading state, and it is also the disabled state (`enabled: false`, which
 * `injectPostQuery` uses for an unset id).
 */
export function querySnapshot<T>(query: QueryLike<T>): Signal<AsyncSnapshot<T>> {
  return computed<AsyncSnapshot<T>>(() => {
    if (query.status() === 'error') {
      return { kind: 'error', error: query.error() };
    }

    const data = query.data();
    return data === undefined ? { kind: 'loading' } : { kind: 'value', value: data };
  });
}
