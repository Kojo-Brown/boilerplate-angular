import { SlicePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectPostQuery } from './posts.queries';

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [RouterLink, SlicePipe],
  template: `
    <div class="p-6">
      <a
        routerLink="/dashboard/posts"
        class="mb-6 inline-flex items-center text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
      >
        &larr; Back to Posts
      </a>

      @if (post.isPending()) {
        <div class="mt-4 space-y-4">
          <div class="h-8 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
          <div class="h-4 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
          <div class="mt-6 space-y-2">
            @for (_ of bodySkeletons; track $index) {
              <div class="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
            }
          </div>
        </div>
      } @else if (post.isError()) {
        <div
          class="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          Post not found or failed to load.
        </div>
      } @else {
        @let data = post.data();
        @if (data) {
          <article class="mt-4">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white">{{ data.title }}</h1>
            <div class="mt-2 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span>Author: {{ data.authorId }}</span>
              <span>&bull;</span>
              <time>{{ data.createdAt | slice: 0 : 10 }}</time>
            </div>
            <div class="prose prose-gray dark:prose-invert mt-6 max-w-none">
              <p class="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                {{ data.body }}
              </p>
            </div>
          </article>
        }
      }
    </div>
  `,
})
export class PostDetailComponent {
  readonly id = input<string>('');
  readonly post = injectPostQuery(this.id);
  readonly bodySkeletons = Array.from({ length: 6 });
}
