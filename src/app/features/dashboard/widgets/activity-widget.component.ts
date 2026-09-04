import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  numberAttribute,
  output,
} from '@angular/core';

/** One row of the activity feed. */
export interface ActivityEntry {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  /** Whole minutes before now. Kept relative so the fixture needs no clock. */
  readonly minutesAgo: number;
}

/**
 * The most recent entries, newest first.
 *
 * `limit` carries a transform, which is the case that makes an input's *write* type differ
 * from its read type: the component reads a `number`, a binding may supply `string | number`,
 * and `ComponentInputs<ActivityWidgetComponent>['limit']` is the latter — the same widening a
 * template gets.
 */
@Component({
  selector: 'app-activity-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-[var(--radius)] border border-[var(--color-border)] p-4">
      <header class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-medium text-[var(--color-muted-foreground)]">Recent activity</h3>
        <button
          type="button"
          class="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          [attr.aria-expanded]="!collapsed()"
          (click)="collapsed.set(!collapsed())"
        >
          {{ collapsed() ? 'Show' : 'Hide' }}
        </button>
      </header>

      @if (!collapsed()) {
        <ul class="mt-2 space-y-2">
          @for (entry of visible(); track entry.id) {
            <li>
              <button
                type="button"
                class="w-full text-left text-sm text-[var(--color-foreground)] hover:underline"
                (click)="select.emit(entry.id)"
              >
                <span class="font-medium">{{ entry.actor }}</span>
                {{ entry.action }}
                <span class="text-[var(--color-muted-foreground)]">
                  · {{ entry.minutesAgo }}m ago
                </span>
              </button>
            </li>
          } @empty {
            <li class="text-sm text-[var(--color-muted-foreground)]">Nothing yet.</li>
          }
        </ul>
      }
    </section>
  `,
})
export class ActivityWidgetComponent {
  readonly entries = input.required<readonly ActivityEntry[]>();
  readonly limit = input(5, { transform: numberAttribute });

  readonly collapsed = model(false);
  readonly select = output<string>();

  protected readonly visible = computed(() => this.entries().slice(0, Math.max(0, this.limit())));
}
