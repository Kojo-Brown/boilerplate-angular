import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  afterRenderEffect,
  computed,
  input,
  model,
  viewChild,
} from '@angular/core';
import type { TrackByFunction } from '@angular/core';
import { hideScrollScaffolding } from './hide-scroll-scaffolding';
import type { VirtualTableColumn, VirtualTableSort } from './virtual-table.models';

/**
 * Row height, in pixels, when a caller does not name one. Tall enough for a single line of
 * `text-sm` with comfortable padding.
 */
const DEFAULT_ROW_HEIGHT_PX = 48;

/**
 * A table of arbitrarily many rows that only ever has a screenful of them in the DOM.
 *
 * ```html
 * <app-virtual-table
 *   [rows]="sortedEntries()"
 *   [columns]="columns"
 *   [rowKey]="entryKey"
 *   [(sort)]="sort"
 *   label="Activity log"
 * />
 * ```
 *
 * ## Why this is not a `<table>`
 *
 * It cannot be. `CdkVirtualScrollViewport` renders the projected rows inside a
 * `div.cdk-virtual-scroll-content-wrapper` that it positions with
 * `transform: translateY(…)`, and puts a second `div.cdk-virtual-scroll-spacer` beside it
 * whose height is `itemSize × rows.length` — that spacer is what gives the scrollbar the
 * size of the whole data set. Neither div is a permitted child of `<table>` or `<tbody>`,
 * and `*cdkVirtualFor` must sit on a direct child of the content wrapper, so there is no
 * arrangement of real table elements that survives. (Overriding `display` on the table
 * elements to get the DOM to nest does not help: it discards exactly the table layout that
 * was the reason to use them, and leaves the ARIA roles implied by the tag names pointing
 * at elements that no longer behave like a table.)
 *
 * So the table is CSS grid with explicit ARIA roles. The cost is that every role is now
 * this component's responsibility rather than the parser's, which is what the rest of this
 * comment is about.
 *
 * ## What virtualisation does to assistive technology
 *
 * A screen reader reads a table's size out of the accessibility tree. With ~16 of 10,000
 * rows in the DOM it would announce "row 3 of 16" and a user would have no way to know
 * where they are or that the other 9,984 rows exist. `aria-rowcount` on the table and
 * `aria-rowindex` on each row replace the tree's count with the real one, and they are not
 * a nicety here — they are the only thing standing between a virtualised table and a table
 * that lies about its contents. Both are 1-based and count the header row, so the data row
 * at index `i` is `aria-rowindex="i + 2"`.
 *
 * `*cdkVirtualFor`'s `index` is the index in the whole data set rather than in the rendered
 * range (`CdkVirtualForOf._updateContext` sets `context.index = renderedRange.start + i`),
 * which is what makes that arithmetic possible at all.
 *
 * Three more things follow from the DOM above:
 *
 * - **The header is outside the viewport.** Inside it, the header would be translated
 *   along with the rows and scroll away — `position: sticky` cannot save it, because the
 *   content wrapper is `position: absolute` and `contain: content`, so there is no
 *   scrollport for it to stick to. Being a sibling of the viewport also makes it a sibling
 *   `rowgroup`, which is exactly what `<thead>` is.
 * - **The viewport's two scaffolding divs are hidden from the accessibility tree.** They
 *   sit between the body `rowgroup` and its `row`s, where ARIA requires no intervening
 *   element. The wrapper becomes `role="presentation"`, which reparents the rows onto the
 *   rowgroup; the spacer becomes `aria-hidden` — it is a scrollbar-sizing device with no
 *   content. {@link hideScrollScaffolding} is where that happens and why.
 * - **The viewport is focusable.** A scrollable region that cannot be focused cannot be
 *   scrolled by keyboard (WCAG 2.1.1), and with 10,000 rows there is nothing inside it to
 *   tab to that would bring the rest into view.
 *
 * `role="table"` rather than `role="grid"`: `grid` is a composite widget, and claiming it
 * obliges arrow-key cell navigation, a roving `tabindex`, and `Home`/`End`/`PageUp`/
 * `PageDown` — a commitment this component does not keep, and a half-kept one is worse
 * than a `table` that never claimed it. A read-only data table is a `table`.
 *
 * @see [`docs/virtual-scrolling.md`](../../../../docs/virtual-scrolling.md)
 */
@Component({
  selector: 'app-virtual-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkVirtualScrollViewport, CdkFixedSizeVirtualScroll, CdkVirtualForOf],
  host: { class: 'block h-full min-h-0' },
  template: `
    @if (rows().length === 0) {
      <p
        data-testid="virtual-table-empty"
        class="flex h-full items-center justify-center rounded-[var(--radius)] border border-dashed
               border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]"
      >
        {{ emptyMessage() }}
      </p>
    } @else {
      <!--
        No \`role="table"\` in the empty case at all, rather than a table whose only row is
        the header: "table, 1 row" is a worse answer to "what is here" than the sentence
        above, and leaving the roles out keeps the structure strictly valid in both states
        instead of adding an empty-state row that is not a row.
      -->
      <div
        role="table"
        [attr.aria-label]="label()"
        [attr.aria-rowcount]="ariaRowCount()"
        [attr.aria-colcount]="columns().length"
        data-testid="virtual-table"
        class="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius)] border
               border-[var(--color-border)] bg-[var(--color-background)]"
      >
        <div role="rowgroup" class="shrink-0 border-b border-[var(--color-border)]">
          <div
            role="row"
            aria-rowindex="1"
            data-testid="virtual-table-header-row"
            class="grid items-center bg-[var(--color-muted)]"
            [style.grid-template-columns]="gridTemplate()"
            [style.height.px]="rowHeightPx()"
          >
            @for (column of columns(); track column.key; let columnIndex = $index) {
              <div
                role="columnheader"
                [attr.aria-colindex]="columnIndex + 1"
                [attr.aria-sort]="ariaSortFor(column)"
                [class]="column.numeric ? headerCellNumeric : headerCell"
              >
                @if (column.sortable) {
                  <button
                    type="button"
                    (click)="toggleSort(column)"
                    class="inline-flex max-w-full items-center gap-1 rounded-[var(--radius)] px-1
                           hover:text-[var(--color-foreground)] focus-visible:outline-2
                           focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                  >
                    <span class="truncate">{{ column.header }}</span>
                    <!--
                      aria-hidden: the arrow is a second rendering of aria-sort on the
                      columnheader, and a screen reader that announced both would say the
                      sort state twice.
                    -->
                    <span aria-hidden="true" class="text-[var(--color-muted-foreground)]">
                      {{ sortIndicatorFor(column) }}
                    </span>
                  </button>
                } @else {
                  <span class="truncate px-1">{{ column.header }}</span>
                }
              </div>
            }
          </div>
        </div>

        <!--
          \`itemSize\` and the row's height are the same signal, deliberately. They are two
          statements of one fact — the spacer's height is \`itemSize × rows.length\`, so a
          row that renders any other height makes the scrollbar describe a document that
          does not exist and the rendered range drift further from the scroll offset the
          further down you go. Expressed as a CSS class and a number they can disagree
          silently; expressed as one input they cannot.
        -->
        <cdk-virtual-scroll-viewport
          role="rowgroup"
          tabindex="0"
          [attr.aria-label]="label() + ' rows'"
          [itemSize]="rowHeightPx()"
          data-testid="virtual-table-viewport"
          class="min-h-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2
                 focus-visible:outline-[var(--color-primary)]"
        >
          <!--
            The stripe comes from the row's index in the *data*, bound as a class, and not
            from \`:nth-child(even)\`. Under virtualisation a structural pseudo-class counts
            positions in the sliding window of ~16 elements, not in the 10,000 rows — so
            \`:nth-child\` striping re-assigns itself on every scroll tick and the whole table
            appears to strobe as it moves. Every structural selector has the same problem
            here: \`:last-child\` draws a boundary in the middle of the list, and
            \`:first-child\` styles whichever row happens to be at the top of the window.
          -->
          <div
            role="row"
            *cdkVirtualFor="let row of rows(); let rowIndex = index; trackBy: trackRow"
            [attr.aria-rowindex]="rowIndex + 2"
            data-testid="virtual-table-row"
            [class]="rowIndex % 2 === 1 ? stripedRow : plainRow"
            [style.grid-template-columns]="gridTemplate()"
            [style.height.px]="rowHeightPx()"
          >
            @for (column of columns(); track column.key; let columnIndex = $index) {
              <div
                role="cell"
                [attr.aria-colindex]="columnIndex + 1"
                [class]="column.numeric ? bodyCellNumeric : bodyCell"
              >
                {{ column.cell(row) }}
              </div>
            }
          </div>
        </cdk-virtual-scroll-viewport>
      </div>
    }
  `,
})
export class VirtualTableComponent<T> {
  /** The whole row set. Only the rendered range is ever in the DOM. */
  readonly rows = input.required<readonly T[]>();

  readonly columns = input.required<readonly VirtualTableColumn<T>[]>();

  /**
   * A row's stable identity, used to track views across a change to `rows`.
   *
   * This is a key function and not a `TrackByFunction` on purpose. `cdkVirtualFor` passes
   * its differ an index that is relative to the *rendered range*, not to the data set
   * (`CdkVirtualForOf._onRenderedDataChange` diffs `_renderedItems`), so the
   * `trackBy: (index) => index` that is merely fragile in a `@for` is outright wrong here:
   * index 0 means a different row after every scroll, and the same index tracked across a
   * sort hands one row's DOM node to another row's data. Taking `(row) => row.id` instead
   * of a two-argument function makes the index unreachable, so that mistake has nowhere to
   * be written.
   */
  readonly rowKey = input.required<(row: T) => string | number>();

  /** The table's accessible name. Required: a focusable scroll region has to have one. */
  readonly label = input.required<string>();

  /** Shown in place of the table when `rows` is empty. */
  readonly emptyMessage = input('No rows to show.');

  /**
   * The height of every row, in pixels, and the viewport's `itemSize`.
   *
   * Fixed, not measured. `CdkAutoSizeVirtualScroll` exists for rows of unknown height and
   * is still experimental; more to the point a fixed size is what makes the scrollbar
   * honest without measuring 10,000 rows, and a data table whose rows are one line of text
   * has no reason to vary. A row whose content could wrap needs a different component, not
   * a taller number here.
   */
  readonly rowHeightPx = input(DEFAULT_ROW_HEIGHT_PX);

  /**
   * Which column the caller has sorted by. Two-way, so a header click reports outwards and
   * a caller can also set it — restoring a sort from the URL, say.
   */
  readonly sort = model<VirtualTableSort | null>(null);

  /** Absent while `rows` is empty, because the viewport is inside the `@else`. */
  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  /**
   * The grid's columns.
   *
   * `minmax(0, 1fr)` rather than `1fr` for the default: `1fr` is shorthand for
   * `minmax(auto, 1fr)`, and an `auto` minimum refuses to shrink a track below its
   * content's intrinsic width — so a long unbroken cell value widens its column, pushes
   * the row past the viewport, and `truncate` never engages because there is nothing to
   * truncate to. A `0` minimum is what lets the cells' `overflow: hidden` do its job.
   */
  protected readonly gridTemplate = computed(() =>
    this.columns()
      .map((column) => column.width ?? 'minmax(0, 1fr)')
      .join(' ')
  );

  /** The header row counts, so a 10,000-row table has 10,001 rows. */
  protected readonly ariaRowCount = computed(() => this.rows().length + 1);

  protected readonly headerCell =
    'min-w-0 px-3 text-left text-xs font-semibold uppercase tracking-wide ' +
    'text-[var(--color-muted-foreground)]';
  protected readonly headerCellNumeric = `${this.headerCell} text-right`;
  protected readonly bodyCell =
    'min-w-0 truncate px-3 text-sm text-left text-[var(--color-foreground)]';
  protected readonly bodyCellNumeric = `${this.bodyCell} text-right tabular-nums`;
  protected readonly plainRow = 'grid items-center border-b border-[var(--color-border)]';
  protected readonly stripedRow = `${this.plainRow} bg-[var(--color-muted)]`;

  /**
   * Adapts {@link rowKey} to the shape `cdkVirtualFor` wants.
   *
   * A bound property rather than a method so the template binds one stable function
   * reference: `cdkVirtualForTrackBy` is an input, and a new arrow on every check would
   * look like a changed input and rebuild the differ.
   */
  protected readonly trackRow: TrackByFunction<T> = (_index, row) => this.rowKey()(row);

  constructor() {
    // `write`, and an `afterRenderEffect` rather than `afterNextRender`: these attributes
    // have to be re-applied whenever the viewport element itself changes, which it does
    // every time `rows` goes from empty to non-empty and the `@else` branch is recreated.
    // Reading `this.viewport()` here is what schedules that.
    //
    // Render hooks run in the browser only, so this is also what keeps the component
    // server-renderable: there is no DOM to patch during SSR, and the rows that matter are
    // re-rendered on the client anyway.
    afterRenderEffect({ write: () => this.patchViewportScaffolding() });
  }

  /**
   * Hand the viewport's own element to {@link hideScrollScaffolding}, which is where the
   * reasoning about the accessibility tree lives. Absent while `rows` is empty, because
   * then there is no viewport — and nothing claiming to be a table either.
   */
  private patchViewportScaffolding(): void {
    const viewport = this.viewport();
    if (viewport === undefined) return;

    hideScrollScaffolding(viewport.elementRef.nativeElement);
  }

  /**
   * `'ascending'` / `'descending'` on the sorted column, `'none'` on the others that offer
   * sorting, and absent on those that do not — an `aria-sort="none"` on a column with no
   * sort control tells a user an affordance is there that is not.
   */
  protected ariaSortFor(column: VirtualTableColumn<T>): string | null {
    if (column.sortable !== true) return null;

    const sort = this.sort();
    if (sort === null || sort.columnKey !== column.key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  /** The arrow beside a sortable header. Hidden from AT; `aria-sort` carries the meaning. */
  protected sortIndicatorFor(column: VirtualTableColumn<T>): string {
    const sort = this.sort();
    if (sort === null || sort.columnKey !== column.key) return '↕';
    return sort.direction === 'asc' ? '↑' : '↓';
  }

  /**
   * Sort by `column`, descending on the second click of the same column.
   *
   * Scrolling back to the top is part of sorting, not a separate courtesy: the scroll
   * offset is an offset into an ordering that no longer exists, so keeping it leaves the
   * user looking at rows 9,000–9,015 of a list they just reordered, with no indication that
   * the top is where the answer they sorted for now is. The viewport is only reachable from
   * here while rows exist, which is also the only time this can be called.
   */
  protected toggleSort(column: VirtualTableColumn<T>): void {
    const current = this.sort();
    const direction =
      current !== null && current.columnKey === column.key && current.direction === 'asc'
        ? 'desc'
        : 'asc';

    this.sort.set({ columnKey: column.key, direction });
    this.viewport()?.scrollToIndex(0);
  }
}
