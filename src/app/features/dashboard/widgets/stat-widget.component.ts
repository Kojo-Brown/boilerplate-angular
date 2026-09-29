import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  LOCALE_ID,
  model,
  output,
} from '@angular/core';

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
          @if (collapsed()) {
            <ng-container i18n="Expands a collapsed widget@@widgets.show">Show</ng-container>
          } @else {
            <ng-container i18n="Collapses an expanded widget@@widgets.hide">Hide</ng-container>
          }
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
          i18n="@@widgets.stat.breakdown"
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

  /**
   * The locale these numbers are formatted in.
   *
   * It was `'en-US'`, hard-coded in three `Intl.NumberFormat` calls, which is the failure
   * mode a localised build does *not* announce: every string on the page arrives in
   * Arabic and the numbers beside them stay in Latin digits with an English grouping
   * separator. `LOCALE_ID` is what the build set, so it is what these follow.
   */
  private readonly locale = inject(LOCALE_ID);

  protected readonly formattedValue = computed(() => {
    const currency = this.currency();
    return currency === null
      ? new Intl.NumberFormat(this.locale).format(this.value())
      : new Intl.NumberFormat(this.locale, { style: 'currency', currency }).format(this.value());
  });

  protected readonly formattedDelta = computed(() => {
    const delta = this.delta();
    const formatted = new Intl.NumberFormat(this.locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(Math.abs(delta));
    if (delta === 0)
      return $localize`:A statistic that has not moved since the previous window@@widgets.stat.noChange:No change`;
    return delta > 0
      ? $localize`:A statistic that rose, followed by a percentage@@widgets.stat.up:Up ${formatted}:percent:`
      : $localize`:A statistic that fell, followed by a percentage@@widgets.stat.down:Down ${formatted}:percent:`;
  });

  protected readonly deltaClass = computed(() => {
    const delta = this.delta();
    if (delta === 0) return 'text-[var(--color-muted-foreground)]';
    return delta > 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-destructive)]';
  });
}
