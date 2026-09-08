import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PanelSkeletonComponent } from '@/app/shared/ui/skeleton/panel-skeleton.component';
import { InsightsBreakdownComponent } from './insights/insights-breakdown.component';
import { InsightsPanelComponent } from './insights/insights-panel.component';
import { ReleaseNotesComponent } from './release-notes/release-notes.component';
import { WidgetBoardComponent } from './widgets/widget-board.component';

/**
 * The dashboard, and this application's worked example of `@defer`.
 *
 * The widget board is eager because it is what the route is for. Everything under it is
 * deferred, each with the trigger that matches how it is actually reached:
 *
 * | Block                        | Trigger                        | Prefetch                  |
 * | ---------------------------- | ------------------------------ | ------------------------- |
 * | `app-insights-panel`         | `on viewport`                  | `on idle`                 |
 * | `app-insights-breakdown`     | `on interaction(ref)`          | `on hover(ref)`           |
 * | `app-release-notes`          | `on timer(4s)`                 | `on idle`                 |
 *
 * Each component's own file argues for its trigger. What belongs here is what the *host*
 * has to get right, because these are the mistakes that produce no diagnostic:
 *
 * **A deferred import must be used nowhere else in this template.** The compiler emits a
 * dynamic import for a dependency whose only uses are inside `@defer` blocks, and a static
 * one otherwise. Referencing `<app-insights-panel>` in a `@placeholder`, in an `@error`, or
 * anywhere outside the block silently makes the whole thing eager — the page still works,
 * the chunk is just gone. `scripts/ci/assert-deferred-chunks.sh` fails the build when that
 * happens; `docs/defer.md` explains what it checks and why a lint rule cannot.
 *
 * **`PanelSkeletonComponent` is eager, and has to be.** A placeholder that could only be
 * drawn after a download would not be a placeholder. It is imported here rather than
 * re-declared in each panel precisely so that the frame the placeholder draws and the frame
 * `*appAsync` draws while its query resolves are the same element, and the transition from
 * one to the other is invisible.
 *
 * **A viewport or interaction trigger needs something to observe.** Without an explicit
 * reference, Angular watches the `@placeholder`'s single root element — so such a block
 * must have a placeholder, and that placeholder must have exactly one root element node.
 * The breakdown below has no placeholder at all; it names `breakdownTrigger` instead,
 * because the button that opens it is outside the block.
 *
 * **`@error` cannot retry.** There is no built-in way to re-run a failed defer block: the
 * state is terminal for the life of that block, and the only recovery is to recreate it —
 * which is what the `@if` around the breakdown's `@error` content would have to do. Reload
 * is honest here; a "Try again" button that did nothing would not be.
 *
 * @see [`docs/defer.md`](../../../../docs/defer.md)
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    WidgetBoardComponent,
    PanelSkeletonComponent,
    InsightsPanelComponent,
    InsightsBreakdownComponent,
    ReleaseNotesComponent,
  ],
  template: `
    <h2 class="text-lg font-semibold text-[var(--color-foreground)]">Overview</h2>
    <div class="mt-4">
      <app-widget-board />
    </div>

    <!--
      Below the fold on every viewport this application targets, so the chunk is fetched
      while the main thread is idle and rendered when the placeholder scrolls into view.

      \`minimum 400ms\` on the placeholder and \`after 100ms\` on the loading block are a pair,
      and they solve opposite problems. Without the minimum, a cached chunk swaps the
      skeleton for content within a frame or two and the section flickers. Without the
      \`after\`, a download that finishes in 40ms still puts a second element on screen for
      those 40ms. Together: nothing is shown for less than the eye can follow.
    -->
    <div class="mt-6">
      @defer (on viewport; prefetch on idle) {
        <app-insights-panel />
      } @placeholder (minimum 400ms) {
        <app-panel-skeleton label="publishing activity" rows="5" />
      } @loading (after 100ms; minimum 400ms) {
        <app-panel-skeleton label="publishing activity" rows="5" />
      } @error {
        <p
          class="rounded-[var(--radius)] border border-[var(--color-border)] p-4 text-sm text-[var(--color-destructive)]"
          data-testid="insights-panel-error"
        >
          Publishing activity could not be loaded. Reload the page to try again.
        </p>
      }
    </div>

    <!--
      Triggered from a button outside the block, which is what the template reference is
      for: with no \`@placeholder\` there is nothing for an implicit trigger to observe, and
      the button has to keep working — and keep its focus — while the chunk arrives.
    -->
    <div class="mt-6">
      <button
        #breakdownTrigger
        type="button"
        class="text-sm font-medium text-[var(--color-primary)] hover:underline"
        data-testid="show-breakdown"
      >
        Show post-length breakdown
      </button>

      <div class="mt-3">
        @defer (on interaction(breakdownTrigger); prefetch on hover(breakdownTrigger)) {
          <app-insights-breakdown />
        } @loading (after 100ms; minimum 400ms) {
          <app-panel-skeleton label="the length breakdown" rows="4" />
        } @error {
          <p class="text-sm text-[var(--color-destructive)]" data-testid="breakdown-block-error">
            The breakdown could not be loaded. Reload the page to try again.
          </p>
        }
      </div>
    </div>

    <!--
      No placeholder: see \`ReleaseNotesComponent\` for why reserving the space would be worse
      than the shift. The timer starts when this view is created, so the four seconds are
      counted from the dashboard rendering and not from the application booting.
    -->
    <div class="mt-6">
      @defer (on timer(4s); prefetch on idle) {
        <app-release-notes />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {}
