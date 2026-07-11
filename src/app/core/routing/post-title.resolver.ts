import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { PostsService } from '@/app/features/posts/posts.service';

export const postTitleResolver: ResolveFn<string> = async (route) => {
  const postsService = inject(PostsService);
  const id = route.paramMap.get('id') ?? '';
  if (!id) return 'Post Detail';
  try {
    const post = await postsService.getById(id);
    return post.title;
  } catch {
    return 'Post Detail';
  }
};
