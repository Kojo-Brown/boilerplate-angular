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
/** Shown while a post has no id, or when the read fails. */
const FALLBACK_TITLE = $localize`:Browser tab title for a post that could not be read@@route.title.postDetail:Post Detail`;

export const postTitleResolver: ResolveFn<string> = async (route) => {
  const posts = inject(PostReader);
  const id = route.paramMap.get('id') ?? '';
  if (!id) return FALLBACK_TITLE;
  try {
    const post = await posts.getById(id);
    // Not localised, and this is the line that says why the rest of the file is: a
    // post's title is *content*, which arrives in whatever language it was written in
    // and is not ours to translate. The fallback below is chrome, which is.
    return post.title;
  } catch {
    return FALLBACK_TITLE;
  }
};
