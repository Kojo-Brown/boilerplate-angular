import { inject, resource } from '@angular/core';
import type { ResourceRef, Signal } from '@angular/core';
import { PostsService } from './posts.service';
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
 *   reaches `HttpClient` because `PostsService` awaits through `abortableRequest`; the
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
 * and not the `inject(PostsService)` above it, so it could not do what its name
 * promised. Wrap the call in `runInInjectionContext` instead.
 *
 * @param id Post id to load. An empty string leaves the resource idle.
 */
export function injectPostResource(id: Signal<string>): ResourceRef<Post | undefined> {
  const postsService = inject(PostsService);

  return resource({
    params: () => id() || undefined,
    loader: ({ params, abortSignal }) => postsService.getById(params, abortSignal),
    debugName: 'postResource',
  });
}
