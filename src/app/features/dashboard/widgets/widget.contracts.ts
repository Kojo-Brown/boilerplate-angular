import type { EnvironmentProviders, Signal, WritableSignal } from '@angular/core';
import { InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { DynamicComponent } from '@/app/shared/dynamic';

/** The window a dashboard statistic is reported over. */
export type StatRange = '7d' | '30d' | '90d';

/** The ranges the board offers, in the order they are shown. */
export const STAT_RANGES: readonly StatRange[] = ['7d', '30d', '90d'];

/** How a range is labelled in the board's control. */
export const STAT_RANGE_LABELS: Readonly<Record<StatRange, string>> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

/**
 * What the board lends a widget.
 *
 * `range` is read-only because the control that changes it belongs to the board; `collapsed`
 * is writable because the widget's own header toggles it and the board reads it back. Both
 * are signals rather than values: a widget binds them straight through
 * `bind.input`/`bind.model` and Angular re-evaluates the binding when they change, so the
 * board never re-renders a widget to update it.
 */
export interface WidgetContext {
  readonly range: Signal<StatRange>;
  readonly collapsed: WritableSignal<boolean>;
  /** Called when the widget reports that one of its rows was chosen. */
  readonly select: (entryId: string) => void;
}

/**
 * One entry on the board.
 *
 * `render` returns a descriptor rather than a component type, which is what lets the board
 * stay closed over the widgets: a widget with three required inputs and one with none are the
 * same shape here, because each definition binds its own component and the compiler checks
 * that binding against that component. A registry of `Type<unknown>` could not — the board
 * would have to know every widget's inputs to supply them.
 */
export interface WidgetDefinition {
  /** Stable across renders; identifies the widget in `@for` and in `select` callbacks. */
  readonly id: string;
  readonly title: string;
  readonly render: (context: WidgetContext) => DynamicComponent;
}

/**
 * The widgets the board renders, in order.
 *
 * Declared without a `providedIn` factory for the same reason as `API_ERROR_MAPPERS`: the
 * list is the composition root's decision, and a tree-shakable default would be a second,
 * silently-overridden answer to the same question. Register it with
 * {@link provideDashboardWidgets}.
 */
export const DASHBOARD_WIDGETS = new InjectionToken<readonly WidgetDefinition[]>(
  'DASHBOARD_WIDGETS'
);

/** Bind {@link DASHBOARD_WIDGETS} to `widgets`, in the order given. */
export function provideDashboardWidgets(
  ...widgets: readonly WidgetDefinition[]
): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: DASHBOARD_WIDGETS, useValue: widgets }]);
}
