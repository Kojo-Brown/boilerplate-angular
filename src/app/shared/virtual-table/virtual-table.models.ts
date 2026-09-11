/** Which way a sorted column is ordered. */
export type VirtualTableSortDirection = 'asc' | 'desc';

/**
 * Which column a table is sorted by, and how.
 *
 * The table emits this and renders `aria-sort` from it; it does **not** sort anything. A
 * virtual table's whole premise is that the row set is too large to treat casually, and
 * at that size sorting is the owner's decision: a server-side `ORDER BY`, a `computed()`
 * over an in-memory array, or an index that already exists. A table that sorted its own
 * `rows` input would force the in-memory answer on every caller and would re-sort on
 * every scroll tick unless it memoised a copy of the whole data set.
 */
export interface VirtualTableSort {
  readonly columnKey: string;
  readonly direction: VirtualTableSortDirection;
}

/**
 * One column of a {@link VirtualTableComponent}.
 *
 * ## Why `cell` is a function and not an `<ng-template>`
 *
 * A template per column is the more capable API — it would allow a link, a badge, a
 * nested component in a cell — and it is the wrong trade here. Every templated cell is an
 * `EmbeddedViewRef`: with five columns and ~16 rendered rows that is 80 embedded views
 * created and destroyed on *every* change of the rendered range, which is the cost
 * virtualisation exists to remove. `{{ column.cell(row) }}` inside a `@for` is an
 * interpolation in the row's own view, so a scroll tick updates text in views that
 * already exist.
 *
 * Formatting therefore belongs to the caller, in the `cell` function, which is also where
 * it is cheapest to test: `cell` is a pure function of a row and needs no fixture.
 *
 * The constraint this accepts is real — a cell cannot contain a link or a control — and it
 * is the reason a row-level action belongs on the row, not in a cell. See
 * [`docs/virtual-scrolling.md`](../../../../docs/virtual-scrolling.md#what-a-cell-cannot-be).
 */
export interface VirtualTableColumn<T> {
  /** Stable identity for the column: the `@for` track key, and what a sort reports. */
  readonly key: string;

  /** Shown in the `columnheader`, and announced before every cell in the column. */
  readonly header: string;

  /**
   * The cell's text. Called once per rendered row per change detection of that row, so it
   * must be cheap and must not allocate anything it does not have to — at a 10k-row scale
   * the row set is large but the number of *calls* is bounded by the rendered range, not
   * by `rows.length`.
   */
  readonly cell: (row: T) => string;

  /**
   * The column's CSS grid track, e.g. `'6rem'`, `'minmax(8rem, 1fr)'`. Defaults to
   * `minmax(0, 1fr)` — see {@link VirtualTableComponent.gridTemplate} for why the `0`
   * matters.
   */
  readonly width?: string;

  /** Right-aligns the column and renders it with tabular figures. */
  readonly numeric?: boolean;

  /** Whether the header offers a sort control. The caller still does the sorting. */
  readonly sortable?: boolean;
}
