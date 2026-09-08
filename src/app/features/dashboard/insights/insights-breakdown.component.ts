import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { AsyncDirective, querySnapshot } from '@/app/shared/directives';
import { PanelSkeletonComponent } from '@/app/shared/ui/skeleton/panel-skeleton.component';
import type { Post } from '../../posts/posts.models';
import { injectPostsQuery } from '../../posts/posts.queries';

/** One length band and how many posts fall in it. */
export interface LengthBand {
  readonly label: string;
  readonly posts: number;
  /** Share of all posts counted, 0–1. */
  readonly share: number;
}

/**
 * The bands, as an upper bound (exclusive) in characters and a label.
 *
 * The last band's bound is `Infinity` rather than a large number so that
 * {@link bandPosts} needs no special case for the tail — a real value that behaves like a
 * bound beats a comment saying the last entry is different.
 */
const BANDS: readonly { readonly label: string; readonly under: number }[] = [
  { label: 'Under 200 characters', under: 200 },
  { label: '200–599', under: 600 },
  { label: '600–1,199', under: 1200 },
  { label: '1,200 or more', under: Infinity },
];

/**
 * Group posts into {@link BANDS} by body length.
 *
 * Every band is returned, including empty ones: a distribution with rows that appear and
 * disappear as the data changes is a distribution that cannot be read at a glance, and a
 * zero is information — it says nobody writes long posts, which is what the reader came for.
 *
 * Exported for the same reason as `tallyByAuthor`: the boundaries are arithmetic, and
 * arithmetic is cheaper to pin down in a unit test than through rendered DOM.
 */
export function bandPosts(posts: readonly Post[]): readonly LengthBand[] {
  const counts = BANDS.map(() => 0);
  for (const post of posts) {
    const index = BANDS.findIndex((band) => post.body.length < band.under);
    // `Infinity` on the last band makes this total: `findIndex` cannot return -1, and a
    // body of any length lands somewhere.
    counts[index] += 1;
  }

  const total = posts.length;
  return BANDS.map((band, index) => ({
    label: band.label,
    posts: counts[index],
    share: total === 0 ? 0 : counts[index] / total,
  }));
}

/**
 * How long the posts are, as a distribution over four length bands.
 *
 * ## Why this one is deferred on interaction rather than on viewport
 *
 * It sits behind a disclosure button and is invisible until someone asks for it, so
 * "scrolled into view" is the wrong question — the block would load for every session that
 * reached the bottom of the dashboard and for most of them nothing would ever be shown.
 * `DashboardComponent` triggers it with `on interaction(breakdownTrigger)` against an
 * explicit template reference: the button lives outside the block, so there is no
 * `@placeholder` for the trigger to observe and the reference is the only way to name it.
 *
 * `prefetch on hover(breakdownTrigger)` is the pairing that makes it feel instant. A
 * pointer reaching a button precedes the click by a few hundred milliseconds, which is
 * usually the whole download; a keyboard user gets the same head start, because Angular's
 * hover trigger also listens for `focusin`. Prefetching is idempotent and cheap here, and
 * — unlike a `when` trigger — a hover that never becomes a click costs one chunk and no
 * rendering work at all.
 *
 * The query is the one {@link file://./insights-panel.component.ts | InsightsPanelComponent}
 * already resolved, so by the time this block renders its data is normally in the TanStack
 * cache and the skeleton below never appears. It is still written, because "normally" is
 * not "always": a user who clicks the button before scrolling to the panel gets the cold path.
 *
 * @see [`docs/defer.md`](../../../../../docs/defer.md)
 */
@Component({
  selector: 'app-insights-breakdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncDirective, PanelSkeletonComponent],
  template: `
    <ng-template #skeleton>
      <app-panel-skeleton label="the length breakdown" rows="4" />
    </ng-template>

    <ng-template #failed>
      <div
        class="rounded-[var(--radius)] border border-[var(--color-border)] p-4 text-sm text-[var(--color-destructive)]"
        data-testid="breakdown-error"
      >
        Could not load the length breakdown.
      </div>
    </ng-template>

    <section
      class="rounded-[var(--radius)] border border-[var(--color-border)] p-4"
      data-testid="insights-breakdown"
      *appAsync="posts; let page; loading: skeleton; error: failed"
    >
      <h3 class="text-sm font-medium text-[var(--color-foreground)]">Post length</h3>

      <table class="mt-4 w-full text-left text-xs">
        <caption class="sr-only">
          Posts grouped by body length, over
          {{
            page.total
          }}
          posts
        </caption>
        <thead class="text-[var(--color-muted-foreground)]">
          <tr>
            <th scope="col" class="pb-2 font-medium">Length</th>
            <th scope="col" class="pb-2 text-right font-medium">Posts</th>
            <th scope="col" class="pb-2 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody class="text-[var(--color-foreground)]">
          @for (band of bands(); track band.label) {
            <tr data-testid="band-row" class="border-t border-[var(--color-border)]">
              <th scope="row" class="py-2 font-normal">{{ band.label }}</th>
              <td class="py-2 text-right tabular-nums">{{ band.posts }}</td>
              <td class="py-2 text-right tabular-nums">{{ formatShare(band.share) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class InsightsBreakdownComponent {
  private readonly query = injectPostsQuery();

  protected readonly posts = querySnapshot(this.query);

  protected readonly bands = computed(() => bandPosts(this.query.data()?.data ?? []));

  protected formatShare(share: number): string {
    return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 }).format(
      share
    );
  }
}
