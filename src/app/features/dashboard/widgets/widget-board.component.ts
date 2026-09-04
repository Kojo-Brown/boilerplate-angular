import type { WritableSignal } from '@angular/core';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { DynamicComponent } from '@/app/shared/dynamic';
import { DynamicOutletDirective } from '@/app/shared/dynamic';
import type { StatRange, WidgetDefinition } from './widget.contracts';
import { DASHBOARD_WIDGETS, STAT_RANGES, STAT_RANGE_LABELS } from './widget.contracts';

interface WidgetPanel {
  readonly definition: WidgetDefinition;
  readonly collapsed: WritableSignal<boolean>;
  readonly descriptor: DynamicComponent;
}

const RANGE_BUTTON =
  'rounded-[var(--radius)] px-3 py-1 text-xs font-medium transition-colors ' +
  'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]';

const RANGE_BUTTON_ACTIVE = 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]';

/**
 * Renders whatever is registered under `DASHBOARD_WIDGETS`.
 *
 * The board imports no widget. It reads the registry, builds one descriptor per definition
 * **once**, and hands each to a `[appDynamicOutlet]`. Adding a fourth widget is one entry in
 * `provideDashboardWidgets(...)` and no change here.
 *
 * The descriptors are built in a field initialiser rather than a `computed()` because they
 * are the outlet's identity: a descriptor rebuilt during change detection would destroy and
 * recreate its widget, losing the DOM state — scroll position, focus, an open disclosure —
 * that the component was keeping. Nothing needs rebuilding, because the values inside them
 * are signals: `range` changes and every binding reading it re-evaluates in place.
 */
@Component({
  selector: 'app-widget-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DynamicOutletDirective],
  template: `
    <section>
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-1" role="group" aria-label="Reporting window">
          @for (option of ranges; track option) {
            <button
              type="button"
              [class]="option === range() ? rangeButtonActive : rangeButton"
              [attr.aria-pressed]="option === range()"
              (click)="range.set(option)"
            >
              {{ rangeLabels[option] }}
            </button>
          }
        </div>

        <button
          type="button"
          class="text-xs font-medium text-[var(--color-primary)] hover:underline"
          (click)="expandAll()"
          [disabled]="!anyCollapsed()"
        >
          Expand all
        </button>
      </header>

      <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        @for (panel of panels; track panel.definition.id) {
          <ng-container [appDynamicOutlet]="panel.descriptor" />
        }
      </div>

      <p class="mt-4 text-xs text-[var(--color-muted-foreground)]" data-testid="last-selected">
        @if (lastSelected(); as selection) {
          Last opened: {{ selection }}
        } @else {
          Choose a row to open its breakdown.
        }
      </p>
    </section>
  `,
})
export class WidgetBoardComponent {
  protected readonly ranges = STAT_RANGES;
  protected readonly rangeLabels = STAT_RANGE_LABELS;
  protected readonly rangeButton = RANGE_BUTTON;
  protected readonly rangeButtonActive = RANGE_BUTTON_ACTIVE;

  protected readonly range = signal<StatRange>('30d');
  protected readonly lastSelected = signal<string | null>(null);

  protected readonly panels: readonly WidgetPanel[] = inject(DASHBOARD_WIDGETS).map(
    (definition) => {
      const collapsed = signal(false);
      return {
        definition,
        collapsed,
        descriptor: definition.render({
          range: this.range.asReadonly(),
          collapsed,
          select: (entryId) => this.lastSelected.set(`${definition.title} — ${entryId}`),
        }),
      };
    }
  );

  protected readonly anyCollapsed = computed(() => this.panels.some((p) => p.collapsed()));

  /**
   * Writes every panel's `collapsed` signal.
   *
   * The widgets are never told: each one's own header toggles the same signal through a
   * `bind.model` two-way binding, so a write from this side reaches the view the same way a
   * write from the widget's side reaches this one.
   */
  protected expandAll(): void {
    for (const panel of this.panels) panel.collapsed.set(false);
  }
}
