import { SlicePipe } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectPostsQuery } from './posts.queries';

@Component({
  selector: 'app-posts-list',
  standalone: true,
  imports: [RouterLink, SlicePipe],
  template: `
    <div class="p-6">
      <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-white">Posts</h1>

      @if (posts.isPending()) {
        <div class="space-y-3">
          @for (_ of skeletons; track $index) {
            <div class="h-16 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
          }
        </div>
      } @else if (posts.isError()) {
        <div
          class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          Failed to load posts. Please try again.
        </div>
      } @else {
        @let data = posts.data();
        @if (data && data.data.length > 0) {
          <ul
            class="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900"
          >
            @for (post of data.data; track post.id) {
              <li>
                <a
                  [routerLink]="['/dashboard/posts', post.id]"
                  class="flex items-start gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div class="flex-1 min-w-0">
                    <p class="truncate font-medium text-gray-900 dark:text-white">
                      {{ post.title }}
                    </p>
                    <p class="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
                      {{ post.body }}
                    </p>
                  </div>
                  <span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                    {{ post.createdAt | slice: 0 : 10 }}
                  </span>
                </a>
              </li>
            }
          </ul>
          <p class="mt-4 text-sm text-gray-500 dark:text-gray-400">
            Showing {{ data.data.length }} of {{ data.total }} posts
          </p>
        } @else {
          <div
            class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-600"
          >
            <p class="text-sm text-gray-500 dark:text-gray-400">No posts yet.</p>
          </div>
        }
      }
    </div>
  `,
})
export class PostsListComponent {
  readonly posts = injectPostsQuery();
  readonly skeletons = Array.from({ length: 5 });
}
