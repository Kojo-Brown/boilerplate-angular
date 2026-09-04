import type { ComponentRef } from '@angular/core';
import { DestroyRef, Directive, ViewContainerRef, effect, inject, input } from '@angular/core';
import type { DynamicComponent } from './component-bindings';

/**
 * Renders a `DynamicComponent` descriptor into the DOM where the directive sits.
 *
 * ```html
 * <ng-container [appDynamicOutlet]="panel.descriptor" />
 * ```
 *
 * `NgComponentOutlet` covers the same ground with an `inputs` record, but that record is
 * `Record<string, unknown>` — the names and values are unchecked, and every change re-applies
 * the whole record through `setInput`. This takes a descriptor built by `dynamicComponent()`,
 * whose bindings the compiler has already checked and which Angular re-evaluates on its own
 * when a signal they read changes. Nothing here diffs inputs, because nothing needs to.
 *
 * **The descriptor's reference is the identity of the rendering.** A new reference destroys the
 * component and creates a fresh one; an unchanged reference leaves it alone, keeping its state
 * while its bound signals keep flowing in. That is not a tuning choice: `createComponent`
 * fixes bindings at creation, so new bindings can only reach the view through a new view.
 * Build descriptors in a field or a `computed()`, never inline in a template.
 */
@Directive({
  selector: '[appDynamicOutlet]',
})
export class DynamicOutletDirective {
  /** The component to render, or `null` to render nothing. */
  readonly descriptor = input.required<DynamicComponent | null>({ alias: 'appDynamicOutlet' });

  private readonly container = inject(ViewContainerRef);
  private current: ComponentRef<unknown> | null = null;

  /**
   * The live `ComponentRef`, or `null` when nothing is rendered.
   *
   * Exposed for the cases a binding cannot reach — reading the instance from a `viewChild`,
   * asserting on it in a spec. Prefer bindings: a caller that mutates the instance directly
   * is writing state Angular's change detection was not told about.
   */
  get componentRef(): ComponentRef<unknown> | null {
    return this.current;
  }

  constructor() {
    effect(() => {
      this.render(this.descriptor());
    });

    // `ViewContainerRef.clear()` destroys the views it holds. Angular already destroys the
    // container along with the view that declares it, so this matters only for the directive
    // being destroyed on its own — a host directive removed by a structural change above it.
    inject(DestroyRef).onDestroy(() => {
      this.container.clear();
      this.current = null;
    });
  }

  private render(descriptor: DynamicComponent | null): void {
    this.container.clear();
    this.current = null;

    if (descriptor === null) {
      return;
    }

    this.current = this.container.createComponent(descriptor.type, {
      bindings: [...descriptor.bindings],
    });
  }
}
