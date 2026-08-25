import { Injectable, inject } from '@angular/core';
import { lastValueFrom, map } from 'rxjs';
import type { Observable } from 'rxjs';
import { ApiService } from '@/app/core/http/api.service';
import { abortableRequest } from '@/app/core/reactivity';
import type { PaginatedResponse } from '@/app/core/http/models/api.models';
import type { PostReader, PostSearcher, PostWriter } from './posts.contracts';
import type { CreatePostDto, Post, PostsListParams, UpdatePostDto } from './posts.models';

/**
 * The implementation behind the three post roles.
 *
 * `implements` is doing real work here: it is what makes a signature change to
 * `PostReader` a compile error in this file rather than a silent divergence between the
 * class and the interface its consumers hold.
 */
@Injectable({ providedIn: 'root' })
export class PostsService implements PostReader, PostSearcher, PostWriter {
  private readonly api = inject(ApiService);

  /**
   * The reads take an optional `AbortSignal` so a `resource()` loader can hand its own
   * signal straight through and have a superseded request actually cancelled. The
   * mutations deliberately do not: `resource` aborts whenever its params change or its
   * owner is destroyed, which for a write means tearing down a request the server may
   * already have acted on.
   */
  getAll(params?: PostsListParams, abortSignal?: AbortSignal): Promise<PaginatedResponse<Post>> {
    return this.awaitRequest(
      this.api.get<PaginatedResponse<Post>>('/posts', {
        params: params as Record<string, string | number | boolean>,
      }),
      abortSignal
    );
  }

  getById(id: string, abortSignal?: AbortSignal): Promise<Post> {
    return this.awaitRequest(this.api.get<Post>(`/posts/${id}`), abortSignal);
  }

  /**
   * The one read that stays an Observable, because its caller is a `switchMap`.
   *
   * `switchMap` cancels by unsubscribing, and `HttpClient` aborts the request when its
   * last subscriber leaves. A Promise has no teardown to invoke: had this returned one,
   * every superseded keystroke's request would still run to completion, and the
   * cancellation the typeahead is built on would be a comment rather than a behaviour.
   */
  search(query: string, limit = 10): Observable<Post[]> {
    return this.api
      .get<PaginatedResponse<Post>>('/posts', { params: { search: query, pageSize: limit } })
      .pipe(map((page) => page.data));
  }

  create(dto: CreatePostDto): Promise<Post> {
    return lastValueFrom(this.api.post<Post>('/posts', dto));
  }

  update(id: string, dto: UpdatePostDto): Promise<Post> {
    return lastValueFrom(this.api.patch<Post>(`/posts/${id}`, dto));
  }

  remove(id: string): Promise<void> {
    return lastValueFrom(this.api.delete<void>(`/posts/${id}`));
  }

  private awaitRequest<T>(source: Observable<T>, abortSignal?: AbortSignal): Promise<T> {
    return abortSignal ? abortableRequest(source, abortSignal) : lastValueFrom(source);
  }
}
