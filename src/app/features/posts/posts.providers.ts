import type { Provider, Type } from '@angular/core';
import { PostReader, PostSearcher, PostWriter, type PostsBackend } from './posts.contracts';

/**
 * Bind the three posts roles to one backend class.
 *
 * ```ts
 * // dashboard.routes.ts — the lazy route that owns the posts pages
 * providers: [...providePostsBackend(HttpPostsService)]
 *
 * // a spec, or a demo build with no API behind it
 * providers: [...providePostsBackend(InMemoryPostsService)]
 * ```
 *
 * ## `useExisting`, not `useClass`
 *
 * The three tokens are three *views of one backend*, so they have to resolve to one
 * instance. `useClass: backend` three times constructs the class three times, and
 * Angular says nothing: the application boots, the reads work, and only a state change
 * shows the seam — a `create()` through {@link PostWriter} lands in one instance while
 * {@link PostReader} still answers from another. That is invisible while the backend is
 * a stateless HTTP wrapper and immediate with `InMemoryPostsService`, which is the more
 * useful way round for catching it: `posts.providers.spec.ts` asserts both the instance
 * identity and the write-then-read that depends on it.
 *
 * `backend` is listed first so the class has a provider of its own for `useExisting` to
 * point at; neither implementation is `providedIn: 'root'`, which is what keeps the
 * concrete class unreachable to anything that did not go through this function.
 *
 * ## What the signature checks
 *
 * `Type<PostsBackend>` is the one part of this wiring the compiler can enforce: a class
 * missing `remove()`, or one whose `search` returns a `Promise`, fails to compile at the
 * call site. Angular's own provider literals cannot do that — `ClassProvider.useClass`,
 * `ExistingProvider.useExisting` and `ValueProvider.useValue` are all typed `any`, which
 * is why `{ provide: PostReader, useValue: {} }` is accepted everywhere. Passing the
 * class through a typed parameter is what converts that into a compile error.
 *
 * @param backend Class implementing all three roles. It is instantiated once, by Angular,
 *   in whichever injector these providers are registered in.
 */
export function providePostsBackend(backend: Type<PostsBackend>): Provider[] {
  return [
    backend,
    { provide: PostReader, useExisting: backend },
    { provide: PostSearcher, useExisting: backend },
    { provide: PostWriter, useExisting: backend },
  ];
}
