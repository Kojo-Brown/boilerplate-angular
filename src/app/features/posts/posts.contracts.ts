import type { Observable } from 'rxjs';
import type { PaginatedResponse } from '@/app/core/http/models/api.models';
import type { CreatePostDto, Post, PostsListParams, UpdatePostDto } from './posts.models';

/**
 * The three roles `PostsService` plays, split so a consumer can depend on the one it
 * uses.
 *
 * `PostsService` is still a single class and a single injection token — splitting it
 * into three services would only move the coupling into `app.config.ts`. What changes is
 * the *type* each caller holds: `injectPostResource` declares a `PostReader`, so the
 * fact that posts can also be deleted is not part of its contract, and a spec can stand
 * in a two-method object instead of a six-method one. See
 * [`docs/solid.md`](../../../../docs/solid.md).
 */
export interface PostReader {
  getAll(params?: PostsListParams, abortSignal?: AbortSignal): Promise<PaginatedResponse<Post>>;
  getById(id: string, abortSignal?: AbortSignal): Promise<Post>;
}

/**
 * Search is its own role rather than a third method on {@link PostReader}: it is the one
 * read that stays an `Observable`, because its caller needs the cancellation that
 * unsubscribing gives and a `Promise` cannot.
 */
export interface PostSearcher {
  search(query: string, limit?: number): Observable<Post[]>;
}

export interface PostWriter {
  create(dto: CreatePostDto): Promise<Post>;
  update(id: string, dto: UpdatePostDto): Promise<Post>;
  remove(id: string): Promise<void>;
}
