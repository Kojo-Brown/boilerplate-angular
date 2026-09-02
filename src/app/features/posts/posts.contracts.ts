import type { Observable } from 'rxjs';
import type { PaginatedResponse } from '@/app/core/http/models/api.models';
import type { CreatePostDto, Post, PostsListParams, UpdatePostDto } from './posts.models';

/**
 * The three roles a posts backend plays, as **abstract classes used as injection
 * tokens** — the Angular expression of the dependency-inversion principle.
 *
 * ## Why these are not interfaces any more
 *
 * They were, and the split by role (below) is unchanged. What changed is that an
 * interface is erased at compile time and therefore cannot be a DI token, so every
 * consumer had to write:
 *
 * ```ts
 * const posts: PostReader = inject(PostsService); // ← the concrete HTTP class
 * ```
 *
 * The annotation narrowed the *type* the caller held, which is worth something — it is
 * what {@link https://en.wikipedia.org/wiki/Interface_segregation_principle ISP} bought
 * — but the *token* was still the implementation. The source-code arrow ran from the
 * policy (`injectPostResource`, `postTitleResolver`, `posts.queries`) straight to the
 * detail (an `HttpClient` wrapper), which is the dependency DIP exists to reverse:
 * nothing could be substituted without naming `PostsService`, and `core/routing` had to
 * import a `features/` implementation to resolve a route title.
 *
 * An abstract class is one symbol that is *both* the type and the token. `inject(
 * PostReader)` type-checks, and the consumer's import graph now stops at this file.
 * Angular never constructs these classes — they are only ever a key — so they must be
 * provided; see {@link file://./posts.providers.ts | providePostsBackend}.
 *
 * ## Why not `InjectionToken<PostReader>`
 *
 * It would work, and it is the right tool one layer down: `TOAST_SCHEDULER`,
 * `HTTP_CLOCK` and `THEME_PREFERENCE_STORE` all stand in front of an *ambient browser
 * capability* where there is one real implementation and a `factory` default costs four
 * lines. The rule this codebase follows is written up in
 * [`docs/solid.md`](../../../../docs/solid.md#why-these-are-injectiontokens-and-not-abstract-classes),
 * and a posts backend is the other case: two implementations that are both real.
 *
 * Concretely, the token form costs two symbols to keep in sync instead of one, and the
 * `factory` that makes a token convenient is exactly what cannot be used here — a
 * default of `() => inject(HttpPostsService)` would put the implementation back in this
 * file's import graph and undo the inversion. A token with no factory avoids that but is
 * then strictly more moving parts than the class, for the same behaviour.
 *
 * ## Why the roles stay split
 *
 * One backend class implements all three (splitting it into three services would only
 * move the coupling into the route's `providers`), but a consumer names only the role it
 * uses:
 * `injectPostResource` asks for a `PostReader`, so the fact that posts can also be
 * deleted is not part of its contract and a spec can stand in a two-method object
 * instead of a six-method one.
 *
 * @see [`docs/dependency-inversion.md`](../../../../docs/dependency-inversion.md)
 */
export abstract class PostReader {
  /**
   * @param abortSignal Aborts the read. Reads take one so a `resource()` loader can hand
   *   its own signal straight through and have a superseded request actually cancelled.
   */
  abstract getAll(
    params?: PostsListParams,
    abortSignal?: AbortSignal
  ): Promise<PaginatedResponse<Post>>;

  abstract getById(id: string, abortSignal?: AbortSignal): Promise<Post>;
}

/**
 * Search is its own role rather than a third method on {@link PostReader}: it is the one
 * read that stays an `Observable`, because its caller needs the cancellation that
 * unsubscribing gives and a `Promise` cannot.
 */
export abstract class PostSearcher {
  abstract search(query: string, limit?: number): Observable<Post[]>;
}

/**
 * The mutations deliberately take no `AbortSignal`: a `resource` aborts whenever its
 * params change or its owner is destroyed, which for a write means tearing down a
 * request the server may already have acted on.
 */
export abstract class PostWriter {
  abstract create(dto: CreatePostDto): Promise<Post>;
  abstract update(id: string, dto: UpdatePostDto): Promise<Post>;
  abstract remove(id: string): Promise<void>;
}

/**
 * What a class has to satisfy to be wired up by
 * {@link file://./posts.providers.ts | providePostsBackend} — all three roles at once,
 * because they are three views of one store of posts and a `create` through
 * {@link PostWriter} has to be visible through {@link PostReader}.
 *
 * An intersection rather than a fourth abstract class: TypeScript has single
 * inheritance, so a class cannot `extends` all three, and a `PostsBackend` token would
 * be a fourth key for the same instance that no consumer should be reaching for.
 */
export type PostsBackend = PostReader & PostSearcher & PostWriter;
