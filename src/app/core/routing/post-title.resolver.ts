import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { PostReader } from '@/app/features/posts/posts.contracts';

/**
 * Resolves a post's title for the browser tab.
 *
 * It injects `PostReader`, not a posts service: `core/` naming a `features/`
 * *implementation* was the layering inversion worth removing here — this file now
 * imports an abstraction and knows nothing about how a post is fetched.
 */
export const postTitleResolver: ResolveFn<string> = async (route) => {
  const posts = inject(PostReader);
  const id = route.paramMap.get('id') ?? '';
  if (!id) return 'Post Detail';
  try {
    const post = await posts.getById(id);
    return post.title;
  } catch {
    return 'Post Detail';
  }
};
