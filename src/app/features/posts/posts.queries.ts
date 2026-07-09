import { inject } from '@angular/core';
import {
  injectMutation,
  injectQuery,
  injectQueryClient,
} from '@tanstack/angular-query-experimental';
import { queryKeys } from '@/app/core/query/query-keys';
import { PostsService } from './posts.service';
import type { CreatePostDto, PostsListParams, UpdatePostDto } from './posts.models';

export function injectPostsQuery(params?: PostsListParams) {
  const postsService = inject(PostsService);
  return injectQuery(() => ({
    queryKey: queryKeys.posts.list(params ?? {}),
    queryFn: () => postsService.getAll(params),
  }));
}

export function injectPostQuery(id: () => string) {
  const postsService = inject(PostsService);
  return injectQuery(() => ({
    queryKey: queryKeys.posts.detail(id()),
    queryFn: () => postsService.getById(id()),
    enabled: !!id(),
  }));
}

export function injectCreatePostMutation() {
  const postsService = inject(PostsService);
  const queryClient = injectQueryClient();
  return injectMutation(() => ({
    mutationFn: (dto: CreatePostDto) => postsService.create(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.lists() });
    },
  }));
}

export function injectUpdatePostMutation() {
  const postsService = inject(PostsService);
  const queryClient = injectQueryClient();
  return injectMutation(() => ({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePostDto }) =>
      postsService.update(id, dto),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.lists() });
    },
  }));
}

export function injectDeletePostMutation() {
  const postsService = inject(PostsService);
  const queryClient = injectQueryClient();
  return injectMutation(() => ({
    mutationFn: (id: string) => postsService.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.posts.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.lists() });
    },
  }));
}
