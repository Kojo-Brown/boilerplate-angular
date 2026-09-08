import { ChangeDetectionStrategy, Component, input, numberAttribute } from '@angular/core';
import { RepeatDirective } from '@/app/shared/directives';

/**
 * The frame a panel occupies before it can draw itself.
 *
 * It exists as a component rather than as markup repeated in each caller because a
 * `@defer` block needs the *same* frame in two places that cannot share an
 * `<ng-template>`: the `@placeholder`, which lives in the host's template, and the
 * `loading:` template of an `*appAsync` inside the deferred component, which lives in the
 * deferred component's. A skeleton written twice drifts, and the drift is visible — the
 * user watches one grey box become a differently-shaped grey box at the moment the code
 * arrives, which reads as a layout bug rather than as progress.
 *
 * ```html
 * @defer (on viewport; prefetch on idle) {
 *   <app-insights-panel />
 * } @placeholder {
 *   <app-panel-skeleton label="Insights" rows="4" />
 * }
 * ```
 *
 * ## Why this one component is deliberately cheap
 *
 * Everything a `@placeholder` names is an **eager** dependency: the placeholder's whole
 * job is to be on screen before the deferred chunk has been asked for, so its imports
 * cannot themselves be deferred. A placeholder built from the feature's own components
 * would pull that feature back into the eager bundle and defeat the block it decorates.
 * This component imports one directive and renders divs.
 *
 * `role="status"` rather than a bare `aria-busy`: a screen reader user who cannot see the
 * shimmer gets one polite announcement naming what is loading. The bars themselves are
 * `aria-hidden` — six identical empty boxes are noise in the accessibility tree.
 */
@Component({
  selector: 'app-panel-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RepeatDirective],
  template: `
    <div
      role="status"
      class="rounded-[var(--radius)] border border-[var(--color-border)] p-4"
      data-testid="panel-skeleton"
    >
      <span class="sr-only">Loading {{ label() }}…</span>
      <div aria-hidden="true">
        <div class="h-4 w-1/3 animate-pulse rounded bg-[var(--color-muted)]"></div>
        <div class="mt-4 space-y-2">
          <div
            class="h-3 animate-pulse rounded bg-[var(--color-muted)]"
            *appRepeat="rows(); let i"
            [style.animation-delay.ms]="i * 90"
          ></div>
        </div>
      </div>
    </div>
  `,
})
export class PanelSkeletonComponent {
  /** Named in the screen-reader announcement: "Loading insights…". */
  readonly label = input('content');

  /**
   * How many bars to draw under the title.
   *
   * Transformed with `numberAttribute` so `rows="4"` in a template works, which is how
   * every caller here writes it — a `@placeholder` block is markup, and an attribute is
   * the natural spelling for a constant.
   */
  readonly rows = input(4, { transform: numberAttribute });
}
