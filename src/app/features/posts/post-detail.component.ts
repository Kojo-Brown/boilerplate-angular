import { SlicePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AsyncDirective, RepeatDirective, resourceSnapshot } from '@/app/shared/directives';
import { injectPostResource } from './posts.resource';

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [RouterLink, SlicePipe, AsyncDirective, RepeatDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6">
      <a
        routerLink="/dashboard/posts"
        class="mb-6 inline-flex items-center text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
      >
        &larr; Back to Posts
      </a>

      <ng-template #skeleton>
        <div class="mt-4 space-y-4">
          <div class="h-8 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
          <div class="h-4 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
          <div class="mt-6 space-y-2">
            <div
              class="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
              *appRepeat="6"
            ></div>
          </div>
        </div>
      </ng-template>

      <ng-template #failed>
        <div
          class="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          Post not found or failed to load.
        </div>
      </ng-template>

      <!--
        The branch order that used to be a comment here is now the adapter's: an errored
        resource never reaches this template, so nothing can read the value that throws.
        An unset route input leaves the resource idle, which \`resourceSnapshot\` reports as
        loading — so a missing id shows the skeleton rather than flashing an empty article.
      -->
      <article class="mt-4" *appAsync="post; let data; loading: skeleton; error: failed">
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
    </div>
  `,
})
export class PostDetailComponent {
  readonly id = input<string>('');
  readonly post = resourceSnapshot(injectPostResource(this.id));
}
