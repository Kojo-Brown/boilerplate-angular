import { computed } from '@angular/core';
import { dynamicComponent } from '@/app/shared/dynamic';
import type { ActivityEntry } from './activity-widget.component';
import { ActivityWidgetComponent } from './activity-widget.component';
import { StatWidgetComponent } from './stat-widget.component';
import type { StatRange, WidgetDefinition } from './widget.contracts';

/**
 * Figures for the three windows the board offers.
 *
 * Fixed numbers rather than a request: this file is what a consumer deletes and replaces with
 * their own widgets, and a boilerplate dashboard that needs a running API to render anything
 * is a worse starting point than one that renders immediately. `revenueWidget` reads them
 * through a `computed`, so replacing the constant with a `httpResource` changes this file and
 * nothing else.
 */
const SAMPLE_TOTALS: Readonly<Record<StatRange, { revenue: number; signups: number }>> = {
  '7d': { revenue: 18_420, signups: 96 },
  '30d': { revenue: 74_310, signups: 388 },
  '90d': { revenue: 221_905, signups: 1_147 },
};

/** Change over the preceding window of the same length, as a fraction. */
const SAMPLE_DELTAS: Readonly<Record<StatRange, { revenue: number; signups: number }>> = {
  '7d': { revenue: 0.084, signups: -0.021 },
  '30d': { revenue: 0.113, signups: 0.047 },
  '90d': { revenue: 0.062, signups: 0.155 },
};

const SAMPLE_ACTIVITY: readonly ActivityEntry[] = [
  { id: 'a1', actor: 'Ama', action: 'published a post', minutesAgo: 4 },
  { id: 'a2', actor: 'Kwesi', action: 'invited two teammates', minutesAgo: 21 },
  { id: 'a3', actor: 'Yaa', action: 'closed an invoice', minutesAgo: 55 },
  { id: 'a4', actor: 'Kofi', action: 'updated billing details', minutesAgo: 130 },
  { id: 'a5', actor: 'Adjoa', action: 'archived a project', minutesAgo: 188 },
  { id: 'a6', actor: 'Nana', action: 'left a comment', minutesAgo: 240 },
];

export const revenueWidget: WidgetDefinition = {
  id: 'revenue',
  title: 'Revenue',
  render: (context) =>
    dynamicComponent(StatWidgetComponent, (bind) => [
      bind.input('label', () => 'Revenue'),
      bind.input(
        'value',
        computed(() => SAMPLE_TOTALS[context.range()].revenue)
      ),
      bind.input(
        'delta',
        computed(() => SAMPLE_DELTAS[context.range()].revenue)
      ),
      bind.input('currency', () => 'USD'),
      bind.model('collapsed', context.collapsed),
      bind.output('select', context.select),
    ]),
};

export const signupsWidget: WidgetDefinition = {
  id: 'signups',
  title: 'Signups',
  render: (context) =>
    dynamicComponent(StatWidgetComponent, (bind) => [
      bind.input('label', () => 'Signups'),
      bind.input(
        'value',
        computed(() => SAMPLE_TOTALS[context.range()].signups)
      ),
      bind.input(
        'delta',
        computed(() => SAMPLE_DELTAS[context.range()].signups)
      ),
      bind.model('collapsed', context.collapsed),
      bind.output('select', context.select),
    ]),
};

/**
 * The activity feed, showing more rows the longer the window.
 *
 * `limit` is bound with a string on purpose: the input's transform is `numberAttribute`, so
 * this is what a template's `limit="10"` does, and it is the one binding here whose accepted
 * type is wider than what the component reads.
 */
export const activityWidget: WidgetDefinition = {
  id: 'activity',
  title: 'Recent activity',
  render: (context) =>
    dynamicComponent(ActivityWidgetComponent, (bind) => [
      bind.input('entries', () => SAMPLE_ACTIVITY),
      bind.input('limit', () => (context.range() === '7d' ? '3' : 6)),
      bind.model('collapsed', context.collapsed),
      bind.output('select', context.select),
    ]),
};

/** The three sample widgets, in board order. */
export const SAMPLE_WIDGETS: readonly WidgetDefinition[] = [
  revenueWidget,
  signupsWidget,
  activityWidget,
];
