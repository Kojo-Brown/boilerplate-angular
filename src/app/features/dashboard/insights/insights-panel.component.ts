import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { AsyncDirective, querySnapshot } from '@/app/shared/directives';
import { PanelSkeletonComponent } from '@/app/shared/ui/skeleton/panel-skeleton.component';
import type { Post } from '../../posts/posts.models';
import { injectPostsQuery } from '../../posts/posts.queries';

/** One row of the chart: an author and how many posts they have. */
export interface AuthorTally {
  readonly authorId: string;
  readonly posts: number;
  /** Share of the busiest author's count, 0–1. What the bar's width is drawn from. */
  readonly share: number;
}

/** How many authors the chart shows before it stops. */
const VISIBLE_AUTHORS = 5;

/**
 * Tally posts by author, busiest first, and keep the top {@link VISIBLE_AUTHORS}.
 *
 * Exported so the arithmetic can be tested without a fixture: the bar widths are the one
 * part of this component a rendering assertion reads awkwardly, and a divide-by-zero on an
 * empty page is exactly the kind of thing that only shows up against a brand-new account.
 *
 * `share` is relative to the busiest author rather than to the total, because the chart is
 * a comparison and not a breakdown of a whole — with a long tail, shares of the total leave
 * every bar a sliver. The busiest author's bar is always full width.
 */
export function tallyByAuthor(posts: readonly Post[]): readonly AuthorTally[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    counts.set(post.authorId, (counts.get(post.authorId) ?? 0) + 1);
  }

  const ranked = [...counts]
    .sort(([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId))
    .slice(0, VISIBLE_AUTHORS);

  // `ranked[0]` is the largest count, so this is the only division and it cannot be by
  // zero: an empty `posts` produces an empty `ranked`, and the loop below never runs.
  const busiest = ranked.length > 0 ? ranked[0][1] : 0;

  return ranked.map(([authorId, count]) => ({
    authorId,
    posts: count,
    share: count / busiest,
  }));
}

/**
 * Who is publishing, drawn from the posts the dashboard already has cached.
 *
 * ## Why this component is deferred, and what that requires of it
 *
 * It is the second screenful of the dashboard: below the widget board, past the fold on
 * every viewport this application targets, and useless to a session that never scrolls.
 * `DashboardComponent` wraps it in `@defer (on viewport; prefetch on idle)`, so its code is
 * fetched while the main thread is quiet and rendered when the user actually arrives at it.
 *
 * That only works while this file's import graph stays exclusive to the deferred block. The
 * Angular compiler defers a dependency when it is used *only* inside `@defer` blocks in the
 * template that imports it; one eager reference anywhere in that component — including a
 * `@placeholder`, which is by definition eager — quietly turns the dynamic import back into
 * a static one, with no diagnostic. `scripts/ci/assert-deferred-chunks.sh` is what notices.
 *
 * ## The two loading states, and why they look identical
 *
 * A deferred block that then reads data has two waits in a row: the chunk arriving, and the
 * query resolving. The host draws {@link PanelSkeletonComponent} for the first — as its
 * `@placeholder` — and this component draws *the same component* for the second, through
 * `*appAsync`'s `loading:` template. The user sees one skeleton that holds still until real
 * content replaces it, rather than a grey box that is swapped for a differently-shaped grey
 * box at the moment the JavaScript lands.
 *
 * The query is `injectPostsQuery()` with no parameters, which is the key `PostsListComponent`
 * uses. Arriving here from the posts list, the cache is warm and this renders on its first
 * frame — worth separating from the prefetch above, which fetches *code* and never data.
 *
 * @see [`docs/defer.md`](../../../../../docs/defer.md)
 */
@Component({
  selector: 'app-insights-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncDirective, PanelSkeletonComponent],
  template: `
    <ng-template #skeleton>
      <app-panel-skeleton label="publishing activity" rows="5" />
    </ng-template>

    <ng-template #failed>
      <div
        class="rounded-[var(--radius)] border border-[var(--color-border)] p-4 text-sm text-[var(--color-destructive)]"
        data-testid="insights-error"
      >
        Could not load publishing activity.
      </div>
    </ng-template>

    <section
      class="rounded-[var(--radius)] border border-[var(--color-border)] p-4"
      data-testid="insights-panel"
      *appAsync="posts; let page; loading: skeleton; error: failed"
    >
      <header class="flex items-baseline justify-between gap-3">
        <h3 class="text-sm font-medium text-[var(--color-foreground)]">Publishing activity</h3>
        <p class="text-xs text-[var(--color-muted-foreground)]">
          {{ page.total }} post{{ page.total === 1 ? '' : 's' }}
        </p>
      </header>

      @if (tallies().length > 0) {
        <dl class="mt-4 space-y-3">
          @for (tally of tallies(); track tally.authorId) {
            <div class="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3">
              <dt class="truncate text-xs text-[var(--color-muted-foreground)]">
                {{ tally.authorId }}
              </dt>
              <!--
                The bar is decoration: the number beside it is the same information, and a
                screen reader that read both would say it twice. So aria-hidden on the
                track, rather than a role="img" with a label.
              -->
              <div class="h-2 rounded-full bg-[var(--color-muted)]" aria-hidden="true">
                <div
                  class="h-2 rounded-full bg-[var(--color-primary)]"
                  data-testid="author-bar"
                  [style.width.%]="tally.share * 100"
                ></div>
              </div>
              <dd class="text-right text-xs tabular-nums text-[var(--color-foreground)]">
                {{ tally.posts }}
              </dd>
            </div>
          }
        </dl>
      } @else {
        <p class="mt-4 text-xs text-[var(--color-muted-foreground)]" data-testid="insights-empty">
          No posts have been published yet.
        </p>
      }
    </section>
  `,
})
export class InsightsPanelComponent {
  private readonly query = injectPostsQuery();

  protected readonly posts = querySnapshot(this.query);

  protected readonly tallies = computed(() => tallyByAuthor(this.query.data()?.data ?? []));
}
