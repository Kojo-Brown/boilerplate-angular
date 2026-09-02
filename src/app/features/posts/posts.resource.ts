import { inject, resource } from '@angular/core';
import type { ResourceRef, Signal } from '@angular/core';
import { PostReader } from './posts.contracts';
import type { Post } from './posts.models';

/**
 * A single post, loaded from a reactive id and re-loaded whenever that id changes.
 *
 * ```ts
 * readonly id = input<string>('');
 * readonly post = injectPostResource(this.id);
 * ```
 *
 * Two properties of `resource()` are what make it the right tool for a route-driven
 * read like this one:
 *
 * - **Cancellation is automatic.** Changing the id aborts the load already in flight
 *   before starting the next one, and so does destroying the component. The abort
 *   reaches `HttpClient` because `HttpPostsService` awaits through `abortableRequest`,
 *   and `InMemoryPostsService` rejects on an already-aborted signal for the same
 *   reason; the
 *   practical effect is that clicking through a list quickly leaves one open request
 *   rather than one per click, and a slow first response can no longer land after a
 *   faster second one and overwrite it.
 * - **Nothing loads until there is something to load.** `params` returning `undefined`
 *   keeps the resource `idle` and never calls the loader, which is how an unset route
 *   input is expressed — the resource equivalent of a query's `enabled` flag.
 *
 * `value()` throws while the resource is in its error state, so read `error()` first
 * (or `hasValue()`) before touching it — the template in `PostDetailComponent` shows
 * the ordering.
 *
 * Like every `inject`-prefixed helper here, this must be called from an injection
 * context; the resource is then owned by that context and torn down with it. It takes
 * no `{ injector }` escape hatch on purpose: the option would only reach `resource()`
 * and not the `inject(PostReader)` above it, so it could not do what its name
 * promised. Wrap the call in `runInInjectionContext` instead.
 *
 * @param id Post id to load. An empty string leaves the resource idle.
 */
export function injectPostResource(id: Signal<string>): ResourceRef<Post | undefined> {
  // The narrow role is the token, not just the annotation: this loader reads one post,
  // and nothing about it should have to change when the writing side of the backend
  // does — or when the backend stops being the HTTP one.
  const posts = inject(PostReader);

  return resource({
    params: () => id() || undefined,
    loader: ({ params, abortSignal }) => posts.getById(params, abortSignal),
    debugName: 'postResource',
  });
}
