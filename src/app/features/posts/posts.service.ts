import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { ApiService } from '@/app/core/http/api.service';
import type { PaginatedResponse } from '@/app/core/http/models/api.models';
import type { CreatePostDto, Post, PostsListParams, UpdatePostDto } from './posts.models';

@Injectable({ providedIn: 'root' })
export class PostsService {
  private readonly api = inject(ApiService);

  getAll(params?: PostsListParams): Promise<PaginatedResponse<Post>> {
    return lastValueFrom(
      this.api.get<PaginatedResponse<Post>>('/posts', {
        params: params as Record<string, string | number | boolean>,
      })
    );
  }

  getById(id: string): Promise<Post> {
    return lastValueFrom(this.api.get<Post>(`/posts/${id}`));
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
}
