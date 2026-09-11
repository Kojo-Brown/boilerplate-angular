import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { VirtualTableComponent } from '@/app/shared/virtual-table';
import type { VirtualTableColumn, VirtualTableSort } from '@/app/shared/virtual-table';
import { generateActivityLog } from './activity-log.data';
import type { ActivityEntry, ActivitySortKey } from './activity.models';

/**
 * One formatter for the whole column, built once at module load.
 *
 * `new Intl.DateTimeFormat(...)` is one of the most expensive constructors in the platform —
 * it resolves a locale and builds a pattern — and a cell function runs once per rendered row
 * per change detection. Constructing it inside `cell` would put locale resolution on the
 * scroll path, which is exactly the kind of per-row cost virtualisation is supposed to have
 * removed.
 *
 * Fixed to UTC and a fixed locale rather than the viewer's: this is an audit trail, and two
 * people reading the same row in different time zones disagreeing about when it happened is
 * a support ticket. `occurredAt` is UTC, so it is rendered as UTC and says so.
 */
const OCCURRED_AT_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  dateStyle: 'short',
  timeStyle: 'medium',
});

/**
 * How each sortable column orders two entries, ascending.
 *
 * `occurredAt` compares its ISO-8601 strings directly rather than parsing them to `Date`s:
 * fixed-width UTC timestamps sort lexicographically exactly as they sort chronologically, and
 * 10,000 rows is enough for ~130,000 comparisons, each of which would otherwise allocate two
 * `Date` objects.
 *
 * Keyed by {@link ActivitySortKey}, so adding a sortable column without a comparator is a
 * compile error rather than a column that silently does nothing when clicked.
 */
const COMPARATORS: Readonly<
  Record<ActivitySortKey, (left: ActivityEntry, right: ActivityEntry) => number>
> = {
  sequence: (left, right) => left.sequence - right.sequence,
  occurredAt: (left, right) => left.occurredAt.localeCompare(right.occurredAt),
  actor: (left, right) => left.actor.localeCompare(right.actor),
  action: (left, right) => left.action.localeCompare(right.action),
  durationMs: (left, right) => left.durationMs - right.durationMs,
};

/**
 * Whether a column key from the table is one this page can sort by.
 *
 * `VirtualTableSort.columnKey` is a `string` — it has to be, the table is generic over rows it
 * knows nothing about — so the narrowing happens here, where the comparators are.
 */
function isSortKey(key: string): key is ActivitySortKey {
  return Object.hasOwn(COMPARATORS, key);
}

/**
 * The activity log: ten thousand rows, about sixteen of them in the DOM.
 *
 * ## Why the sorting is here and not in the table
 *
 * `sortedEntries` is a `computed`, so re-sorting happens once per change of `sort()` — not
 * once per change detection, and emphatically not once per scroll tick. A table that sorted
 * its own rows input could not make that guarantee for its callers: it would either copy and
 * sort 10,000 entries inside a render pass, or need its own memo of a data set it does not
 * own. Keeping the ordering with the data also leaves the door open to the answer a real
 * deployment reaches for, which is to let the database do it.
 *
 * The comparator composes the column's order with `sequence` as a tiebreak *before* direction
 * is applied, which makes it a total order: `actor` has seven distinct values across 10,000
 * rows, so without a tiebreak the rows inside each group are ordered by whatever the sort
 * implementation happened to do, and "descending" would not be the exact reverse of
 * "ascending".
 *
 * @see [`docs/virtual-scrolling.md`](../../../../../docs/virtual-scrolling.md)
 */
@Component({
  selector: 'app-activity-log',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VirtualTableComponent],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-[var(--color-foreground)]">Activity log</h1>
        <p class="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {{ totalLabel() }} — timestamps are UTC. Only the rows on screen exist in the DOM.
        </p>
      </div>

      <!--
        A bounded height rather than one that grows with the content: the viewport has to be
        the scrolling element for the CDK to have anything to measure, and an element with no
        height of its own measures zero and renders nothing.
      -->
      <div class="h-[32rem]">
        <app-virtual-table
          [rows]="sortedEntries()"
          [columns]="columns"
          [rowKey]="entryKey"
          [(sort)]="sort"
          label="Activity log"
          emptyMessage="No activity has been recorded yet."
        />
      </div>
    </div>
  `,
})
export class ActivityLogComponent {
  /**
   * Built once, in a field initialiser rather than a `computed`: the log is a constant for the
   * lifetime of the page, and `computed` would only add a memo around a value that never has
   * a reason to be recomputed.
   */
  private readonly entries = generateActivityLog();

  protected readonly sort: WritableSignal<VirtualTableSort | null> = signal(null);

  protected readonly sortedEntries = computed<readonly ActivityEntry[]>(() => {
    const sort = this.sort();
    if (sort === null || !isSortKey(sort.columnKey)) return this.entries;

    const compare = COMPARATORS[sort.columnKey];
    const direction = sort.direction === 'asc' ? 1 : -1;

    return [...this.entries].sort(
      (left, right) => direction * (compare(left, right) || left.sequence - right.sequence)
    );
  });

  protected readonly totalLabel = computed(
    () => `${this.entries.length.toLocaleString('en-GB')} entries`
  );

  protected readonly entryKey = (entry: ActivityEntry): string => entry.id;

  protected readonly columns: readonly VirtualTableColumn<ActivityEntry>[] = [
    {
      key: 'sequence',
      header: '#',
      cell: (entry) => String(entry.sequence),
      width: '5rem',
      numeric: true,
      sortable: true,
    },
    {
      key: 'occurredAt',
      header: 'When (UTC)',
      cell: (entry) => OCCURRED_AT_FORMAT.format(new Date(entry.occurredAt)),
      width: 'minmax(10rem, 12rem)',
      sortable: true,
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (entry) => entry.actor,
      width: 'minmax(0, 1.4fr)',
      sortable: true,
    },
    {
      key: 'action',
      header: 'Action',
      cell: (entry) => entry.action,
      width: '7rem',
      sortable: true,
    },
    { key: 'resource', header: 'Resource', cell: (entry) => entry.resource },
    {
      key: 'durationMs',
      header: 'Duration',
      cell: (entry) => `${entry.durationMs} ms`,
      width: '7rem',
      numeric: true,
      sortable: true,
    },
  ];
}
