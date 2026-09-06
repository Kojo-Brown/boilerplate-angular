import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import type { EmbeddedViewRef } from '@angular/core';

/**
 * What `*appRepeat` puts in scope: the zero-based index, and nothing else.
 *
 * `let i` reads it the way `@for`'s `$index` does. There is deliberately no second
 * `$index` key holding the same number — one value under two names is how a template
 * starts using both and a later change updates one of them — and no `$count` either: it
 * would have to be written into every context on a resize, and no caller here has needed
 * it. A one-member context is also a context that never changes after a view is created,
 * which is what makes `render` below pure addition and removal.
 */
export interface RepeatContext {
  readonly $implicit: number;
}

/**
 * Renders its template a fixed number of times.
 *
 * ```html
 * <div class="h-4 animate-pulse rounded bg-gray-200" *appRepeat="6"></div>
 * ```
 *
 * `@for` needs something to iterate, so repeating markup a fixed number of times means
 * `Array.from({ length: 6 })` — and because a template cannot call it, that array becomes a
 * component field: view scaffolding parked in the class, named after what it is made of
 * rather than what it is for. Both components that draw a loading skeleton here carried one.
 *
 * The index is in scope for the case that recurs, staggering an animation across the run:
 *
 * ```html
 * <div *appRepeat="3; let i" [style.animation-delay.ms]="i * 120"></div>
 * ```
 *
 * A non-integer, negative or `NaN` count renders nothing rather than throwing. The values
 * that produce one arrive from arithmetic on a signal — `total() - loaded()` going briefly
 * negative — and a skeleton that renders zero rows for a frame is a smaller failure than a
 * view that stops rendering at all.
 *
 * See [`docs/structural-directives.md`](../../../../docs/structural-directives.md) for how
 * `ngTemplateContextGuard` types `let i` here, and what it cannot reach.
 */
@Directive({
  selector: '[appRepeat]',
})
export class RepeatDirective {
  /** How many times to render the template. Clamped to a non-negative integer. */
  readonly count = input.required<number>({ alias: 'appRepeat' });

  private readonly container = inject(ViewContainerRef);
  private readonly template: TemplateRef<RepeatContext> = inject(TemplateRef);
  private readonly views: EmbeddedViewRef<RepeatContext>[] = [];

  static ngTemplateContextGuard(
    _directive: RepeatDirective,
    _context: unknown
  ): _context is RepeatContext {
    return true;
  }

  constructor() {
    effect(() => {
      this.render(this.count());
    });
  }

  private render(rawCount: number): void {
    const count = Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0;

    // Views are added and removed at the end rather than rebuilt, so growing a run from 3
    // to 4 leaves the first three views — and any DOM state or running animation in them —
    // exactly where they were. Their `$implicit` is still their index either way, which is
    // why nothing here has to write into a context after creating it.
    while (this.views.length > count) {
      // `remove` rather than `EmbeddedViewRef.destroy`: the container owns these views, and
      // this keeps its index in step with the array. Indexes match because views are only
      // ever appended.
      this.container.remove(this.views.length - 1);
      this.views.pop();
    }

    while (this.views.length < count) {
      const context: RepeatContext = { $implicit: this.views.length };
      this.views.push(this.container.createEmbeddedView(this.template, context));
    }
  }
}
