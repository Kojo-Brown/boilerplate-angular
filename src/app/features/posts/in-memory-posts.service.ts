import { Injectable, InjectionToken, inject } from '@angular/core';
import { defer, of } from 'rxjs';
import type { Observable } from 'rxjs';
import type { ApiError, PaginatedResponse } from '@/app/core/http/models/api.models';
// `import type`: an implementation needs the roles' *shape* to satisfy `implements`,
// never their identity as tokens. Only `posts.providers.ts`, which builds the
// providers, imports them as values — the import graph DIP asks for.
import type { PostReader, PostSearcher, PostWriter } from './posts.contracts';
import type { CreatePostDto, Post, PostsListParams, UpdatePostDto } from './posts.models';

/** `PostsListParams.pageSize` when the caller does not ask for one. */
const DEFAULT_PAGE_SIZE = 10;

/** `PostSearcher.search`'s default `limit`, matching `HttpPostsService`. */
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Author of every post this backend creates. It has no session to ask — there is no
 * `AuthStore` behind an in-memory store of posts — so authorship is a stand-in rather
 * than a guess at the signed-in user's id.
 */
export const IN_MEMORY_AUTHOR_ID = 'in-memory-author';

const SEED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

function seedPost(id: string, title: string, body: string): Post {
  return {
    id,
    title,
    body,
    authorId: IN_MEMORY_AUTHOR_ID,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  };
}

/**
 * The posts {@link InMemoryPostsService} starts with.
 *
 * Fixed ids and a fixed timestamp, so a spec or a screenshot that names `post-1` keeps
 * naming the same post. Override it to seed a scenario:
 *
 * ```ts
 * providers: [
 *   ...providePostsBackend(InMemoryPostsService),
 *   { provide: IN_MEMORY_POSTS_SEED, useValue: [createMockPost({ id: 'p1' })] },
 * ]
 * ```
 */
export const IN_MEMORY_POSTS_SEED = new InjectionToken<readonly Post[]>('IN_MEMORY_POSTS_SEED', {
  providedIn: 'root',
  factory: () => [
    seedPost('post-1', 'Signals in practice', 'How the reactivity primitives compose.'),
    seedPost('post-2', 'Zoneless change detection', 'What schedules a refresh without ZoneJS.'),
    seedPost('post-3', 'Interceptors as decorators', 'Retry, cache and telemetry, folded.'),
    seedPost('post-4', 'Typed reactive forms', 'FormGroup<T> without the escape hatches.'),
    seedPost('post-5', 'Dependency inversion', 'Abstract classes as provider tokens.'),
  ],
});

/**
 * Where `createdAt` and `updatedAt` come from.
 *
 * A clock is an ambient capability with one real implementation, so it is an
 * `InjectionToken` with a `factory` default and not an abstract class — the distinction
 * this codebase draws in [`docs/solid.md`](../../../../docs/solid.md). Overriding it
 * lets a spec assert an exact timestamp instead of asserting that a string is a string.
 */
export const IN_MEMORY_POSTS_CLOCK = new InjectionToken<() => string>('IN_MEMORY_POSTS_CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date().toISOString(),
});

function postNotFound(id: string): ApiError {
  return { status: 404, message: `Post ${id} not found.` };
}

function matches(post: Post, query: string): boolean {
  const needle = query.toLowerCase();
  return post.title.toLowerCase().includes(needle) || post.body.toLowerCase().includes(needle);
}

/**
 * A posts backend that keeps its posts in memory.
 *
 * The second real implementation behind {@link PostReader}, {@link PostSearcher} and
 * {@link PostWriter} — the one that makes the abstraction worth having. It is what lets
 * a component spec exercise the real read-write cycle with no `HttpTestingController`
 * and no `expectOne` choreography, and it lets `ng serve` and a Playwright run come up
 * against a working catalogue with no API process running.
 *
 * ## Fidelity, and where it stops
 *
 * A substitute that violates the original's contract makes a green spec mean nothing, so
 * the parts a caller can observe are real: pagination arithmetic, case-insensitive
 * search over title and body, `AbortSignal` honoured on both reads, mutations that a
 * subsequent read actually sees, and a miss that rejects with the same
 * {@link ApiError}-shaped `{ status: 404, message }` that `errorInterceptor` normalises
 * a real 404 into — not a bare `Error`, which would let a spec pass against error
 * handling that the HTTP path would break.
 *
 * Three differences are deliberate and cannot be papered over:
 *
 * - **Everything settles on the microtask queue.** There is no latency to observe, so a
 *   spec that wants to assert a pending state has to control timing itself.
 * - **`search()` therefore cannot demonstrate cancellation.** The Observable it returns
 *   emits and completes on subscription, so `switchMap` has nothing left to unsubscribe
 *   from. The typeahead's debounce and switching are still exercised; the abort of an
 *   in-flight request is only observable against `HttpPostsService`.
 * - **State lives for the lifetime of the injector.** Each `TestBed` gets a fresh
 *   backend seeded from {@link IN_MEMORY_POSTS_SEED}; there is no `reset()` because
 *   there is nothing a spec would use it for that a new fixture does not already do.
 *
 * Posts are replaced rather than mutated, so a `Post` handed out by one call is never
 * changed underneath a caller holding it.
 */
@Injectable()
export class InMemoryPostsService implements PostReader, PostSearcher, PostWriter {
  private readonly clock = inject(IN_MEMORY_POSTS_CLOCK);

  /** Copied, so overriding the seed with a shared array cannot be corrupted by a write. */
  private posts: readonly Post[] = [...inject(IN_MEMORY_POSTS_SEED)];

  /** Monotonic, and `nextId` skips anything the seed already used. */
  private sequence = 0;

  async getAll(
    params?: PostsListParams,
    abortSignal?: AbortSignal
  ): Promise<PaginatedResponse<Post>> {
    throwIfAborted(abortSignal);

    const found = this.matching(params?.search);
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, params?.pageSize ?? DEFAULT_PAGE_SIZE);
    const start = (page - 1) * pageSize;

    return {
      data: found.slice(start, start + pageSize),
      total: found.length,
      page,
      pageSize,
      // An empty catalogue is one empty page rather than zero pages, so a pager reading
      // `page of totalPages` never renders "1 of 0".
      totalPages: Math.max(1, Math.ceil(found.length / pageSize)),
    };
  }

  async getById(id: string, abortSignal?: AbortSignal): Promise<Post> {
    throwIfAborted(abortSignal);

    const post = this.posts.find((candidate) => candidate.id === id);
    if (post === undefined) throw postNotFound(id);
    return post;
  }

  /**
   * `defer` rather than a bare `of`: the result is computed when someone subscribes, so
   * an Observable held across a write emits the posts as they are then, which is what
   * subscribing to a request would have done.
   */
  search(query: string, limit = DEFAULT_SEARCH_LIMIT): Observable<Post[]> {
    return defer(() => of(this.matching(query).slice(0, limit)));
  }

  async create(dto: CreatePostDto): Promise<Post> {
    const now = this.clock();
    const post: Post = {
      id: this.nextId(),
      title: dto.title,
      body: dto.body,
      authorId: IN_MEMORY_AUTHOR_ID,
      createdAt: now,
      updatedAt: now,
    };

    this.posts = [...this.posts, post];
    return post;
  }

  async update(id: string, dto: UpdatePostDto): Promise<Post> {
    const index = this.posts.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw postNotFound(id);

    const existing = this.posts[index];
    const updated: Post = {
      ...existing,
      title: dto.title ?? existing.title,
      body: dto.body ?? existing.body,
      updatedAt: this.clock(),
    };

    // `Array.prototype.with` would say this in one call, but it is ES2023 and `lib` is
    // ES2022; splicing a copy keeps the file inside the configured language level.
    const next = [...this.posts];
    next[index] = updated;
    this.posts = next;
    return updated;
  }

  async remove(id: string): Promise<void> {
    const remaining = this.posts.filter((candidate) => candidate.id !== id);
    if (remaining.length === this.posts.length) throw postNotFound(id);
    this.posts = remaining;
  }

  /** Posts matching `query`, in seed order. An absent or blank query matches all. */
  private matching(query?: string): readonly Post[] {
    const needle = query?.trim() ?? '';
    return needle === '' ? this.posts : this.posts.filter((post) => matches(post, needle));
  }

  /**
   * Unique among the posts currently held. A removed post's id can be handed out again
   * only if the sequence has not already passed it, which for a demo backend is a
   * property worth stating rather than machinery worth building.
   */
  private nextId(): string {
    let id: string;
    do {
      id = `post-${++this.sequence}`;
    } while (this.posts.some((post) => post.id === id));
    return id;
  }
}

/**
 * Reject exactly as `abortableRequest` does, so a `resource()` loader cannot tell the two
 * backends apart by the reason it was aborted with.
 */
function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted !== true) return;
  const reason: unknown = abortSignal.reason;
  throw reason ?? new DOMException('The request was aborted.', 'AbortError');
}
