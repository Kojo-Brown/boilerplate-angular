import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

/**
 * A single headline number with its change over the selected window.
 *
 * Nothing here knows it is rendered dynamically: it declares `input()`, `model()` and
 * `output()` exactly as it would if a template named it, and `ComponentBinder` reads those
 * declarations to type the bindings. A component that had to be written specially for a
 * dynamic host would be a worse component.
 */
@Component({
  selector: 'app-stat-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-[var(--radius)] border border-[var(--color-border)] p-4">
      <header class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-medium text-[var(--color-muted-foreground)]">{{ label() }}</h3>
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
        <p class="mt-2 text-2xl font-semibold text-[var(--color-foreground)]">
          {{ formattedValue() }}
        </p>
        <p class="mt-1 text-xs" [class]="deltaClass()">{{ formattedDelta() }}</p>
        <button
          type="button"
          class="mt-3 text-xs font-medium text-[var(--color-primary)] hover:underline"
          (click)="select.emit(label())"
        >
          Breakdown
        </button>
      }
    </section>
  `,
})
export class StatWidgetComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  /** Change over the window, as a fraction: `0.12` is +12%. */
  readonly delta = input(0);
  /** Rendered as a currency amount rather than a count. */
  readonly currency = input<string | null>(null);

  readonly collapsed = model(false);
  readonly select = output<string>();

  protected readonly formattedValue = computed(() => {
    const currency = this.currency();
    return currency === null
      ? new Intl.NumberFormat('en-US').format(this.value())
      : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(this.value());
  });

  protected readonly formattedDelta = computed(() => {
    const delta = this.delta();
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(Math.abs(delta));
    if (delta === 0) return `No change`;
    return delta > 0 ? `Up ${formatted}` : `Down ${formatted}`;
  });

  protected readonly deltaClass = computed(() => {
    const delta = this.delta();
    if (delta === 0) return 'text-[var(--color-muted-foreground)]';
    return delta > 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-destructive)]';
  });
}
