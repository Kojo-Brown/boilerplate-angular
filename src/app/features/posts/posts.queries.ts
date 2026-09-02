import { inject } from '@angular/core';
import {
  injectMutation,
  injectQuery,
  injectQueryClient,
} from '@tanstack/angular-query-experimental';
import { queryKeys } from '@/app/core/query/query-keys';
import { PostReader, PostWriter } from './posts.contracts';
import type { CreatePostDto, PostsListParams, UpdatePostDto } from './posts.models';

export function injectPostsQuery(params?: PostsListParams) {
  const posts = inject(PostReader);
  return injectQuery(() => ({
    queryKey: queryKeys.posts.list(params ?? {}),
    queryFn: () => posts.getAll(params),
  }));
}

export function injectPostQuery(id: () => string) {
  const posts = inject(PostReader);
  return injectQuery(() => ({
    queryKey: queryKeys.posts.detail(id()),
    queryFn: () => posts.getById(id()),
    enabled: !!id(),
  }));
}

export function injectCreatePostMutation() {
  const posts = inject(PostWriter);
  const queryClient = injectQueryClient();
  return injectMutation(() => ({
    mutationFn: (dto: CreatePostDto) => posts.create(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.lists() });
    },
  }));
}

export function injectUpdatePostMutation() {
  const posts = inject(PostWriter);
  const queryClient = injectQueryClient();
  return injectMutation(() => ({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePostDto }) => posts.update(id, dto),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.lists() });
    },
  }));
}

export function injectDeletePostMutation() {
  const posts = inject(PostWriter);
  const queryClient = injectQueryClient();
  return injectMutation(() => ({
    mutationFn: (id: string) => posts.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.posts.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.lists() });
    },
  }));
}
