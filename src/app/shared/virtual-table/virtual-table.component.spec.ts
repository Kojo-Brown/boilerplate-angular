import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { host, requireEl, settleUntil } from '@/testing';
import { VirtualTableComponent } from './virtual-table.component';
import type { VirtualTableColumn, VirtualTableSort } from './virtual-table.models';

interface TestRow {
  readonly id: string;
  readonly name: string;
  readonly amount: number;
}

const ROW_HEIGHT_PX = 48;

/** Ten rows' worth, so the rendered count is a number this spec can reason about. */
const VIEWPORT_HEIGHT_PX = ROW_HEIGHT_PX * 10;

/** The size the item is about. */
const LARGE_ROW_COUNT = 10_000;

const COLUMNS: readonly VirtualTableColumn<TestRow>[] = [
  { key: 'name', header: 'Name', cell: (row) => row.name, sortable: true },
  {
    key: 'amount',
    header: 'Amount',
    cell: (row) => String(row.amount),
    width: '8rem',
    numeric: true,
  },
];

function makeRows(count: number): readonly TestRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    name: `Row ${index}`,
    amount: index * 10,
  }));
}

@Component({
  selector: 'test-virtual-table-host',
  standalone: true,
  imports: [VirtualTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The wrapper's height is inline rather than a utility class: the viewport's rendered
  // range is a function of its measured height, so the one number every assertion here
  // depends on should not be reachable only through a stylesheet.
  template: `
    <div [style.height.px]="viewportHeightPx()">
      <app-virtual-table
        [rows]="rows()"
        [columns]="columns()"
        [rowKey]="rowKey"
        [label]="label()"
        [rowHeightPx]="rowHeightPx()"
        [emptyMessage]="emptyMessage()"
        [(sort)]="sort"
      />
    </div>
  `,
})
class VirtualTableHostComponent {
  readonly rows: WritableSignal<readonly TestRow[]> = signal(makeRows(3));
  readonly columns: WritableSignal<readonly VirtualTableColumn<TestRow>[]> = signal(COLUMNS);
  readonly label = signal('Test rows');
  readonly emptyMessage = signal('Nothing here.');
  readonly rowHeightPx = signal(ROW_HEIGHT_PX);
  readonly viewportHeightPx = signal(VIEWPORT_HEIGHT_PX);
  readonly sort: WritableSignal<VirtualTableSort | null> = signal(null);

  readonly rowKey = (row: TestRow): string => row.id;
}

describe('VirtualTableComponent', () => {
  /**
   * `CdkVirtualScrollViewport` measures itself in a microtask scheduled from `ngOnInit`, so
   * after the first render it has a size of zero and renders nothing at all. `settleUntil`
   * is the repo's tool for exactly this — a wait on an outcome rather than on a turn count —
   * and the outcome here is "the viewport has measured itself and drawn rows".
   */
  async function createHost(
    rows: readonly TestRow[] = makeRows(3)
  ): Promise<ComponentFixture<VirtualTableHostComponent>> {
    TestBed.configureTestingModule({ imports: [VirtualTableHostComponent] });
    const fixture = TestBed.createComponent(VirtualTableHostComponent);
    fixture.componentInstance.rows.set(rows);
    fixture.detectChanges();

    if (rows.length > 0) {
      await settleUntil(fixture, () => renderedRows(fixture).length > 0);
    }

    return fixture;
  }

  function renderedRows(fixture: ComponentFixture<unknown>): HTMLElement[] {
    return Array.from(
      host(fixture).querySelectorAll<HTMLElement>('[data-testid="virtual-table-row"]')
    );
  }

  function viewport(fixture: ComponentFixture<unknown>): HTMLElement {
    return requireEl(host(fixture), '[data-testid="virtual-table-viewport"]');
  }

  function table(fixture: ComponentFixture<unknown>): HTMLElement {
    return requireEl(host(fixture), '[data-testid="virtual-table"]');
  }

  function rowIndices(fixture: ComponentFixture<unknown>): number[] {
    return renderedRows(fixture).map((row) => Number(row.getAttribute('aria-rowindex')));
  }

  function cellTexts(row: HTMLElement): string[] {
    return Array.from(row.querySelectorAll<HTMLElement>('[role="cell"]')).map((cell) =>
      (cell.textContent ?? '').trim()
    );
  }

  function headerCells(fixture: ComponentFixture<unknown>): HTMLElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>('[role="columnheader"]'));
  }

  /** Whether a row carries the zebra stripe, read from the computed background. */
  function striped(row: HTMLElement): boolean {
    return getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)';
  }

  /**
   * Scroll so the row at `index` is at the top of the viewport, and return it once the CDK
   * has rendered it.
   *
   * The predicate asks whether that row is *somewhere* in the rendered range rather than
   * first in it, because `FixedSizeVirtualScrollStrategy` buffers in both directions: at a
   * scroll offset of `index × itemSize` the range it renders starts a few rows above
   * `index`. Pinning the expectation to "first" would be asserting the CDK's buffer size.
   */
  async function scrollToRow(
    fixture: ComponentFixture<unknown>,
    index: number
  ): Promise<HTMLElement> {
    viewport(fixture).scrollTop = index * ROW_HEIGHT_PX;
    await settleUntil(fixture, () => rowIndices(fixture).includes(index + 2));

    return renderedRows(fixture)[rowIndices(fixture).indexOf(index + 2)];
  }

  describe('at 10,000 rows', () => {
    it('keeps only a screenful of rows in the DOM', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));

      // The claim the feature exists to make. Ten rows fit; the CDK renders those plus its
      // default buffer, which is a few more — never a number that scales with the data set.
      const rendered = renderedRows(fixture).length;
      expect(rendered).toBeGreaterThanOrEqual(10);
      expect(rendered).toBeLessThan(40);
    });

    it('still tells assistive technology how many rows there are', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));

      // The header row counts towards aria-rowcount, so this is 10,001 and not 10,000. It is
      // the whole point: the accessibility tree holds ~16 rows and this is what stops a
      // screen reader announcing that as the size of the table.
      expect(table(fixture).getAttribute('aria-rowcount')).toBe(String(LARGE_ROW_COUNT + 1));
    });

    it('gives the scrollbar the height of the entire data set', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));

      // The spacer's height, which is `itemSize × rows.length`. If this drifts from the
      // rows' real height the scroll offset and the rendered range disagree, and the further
      // down the user scrolls the worse it gets.
      expect(viewport(fixture).scrollHeight).toBe(LARGE_ROW_COUNT * ROW_HEIGHT_PX);
    });

    it('numbers each rendered row by its place in the data set, not in the DOM', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));

      // `aria-rowindex` is 1-based and counts the header, so data index 5,000 is 5,002.
      // `*cdkVirtualFor`'s `index` is absolute, which is what makes this possible; the index
      // its *trackBy* receives is not, which is why `rowKey` takes no index.
      const row = await scrollToRow(fixture, 5_000);

      expect(cellTexts(row)[0]).toBe('Row 5000');
      // There are about sixteen rows in the DOM, numbered from five thousand — so the numbers
      // describe the data set and not the handful of elements holding it.
      const indices = rowIndices(fixture);
      expect(indices[0]).toBeGreaterThan(4_900);
      expect(indices).toEqual(indices.map((_unused, offset) => indices[0] + offset));
    });

    it('renders a bounded number of rows no matter how far down the user is', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));

      await scrollToRow(fixture, LARGE_ROW_COUNT - 20);

      expect(renderedRows(fixture).length).toBeLessThan(40);
    });
  });

  describe('row geometry', () => {
    it('renders every row at exactly the height the viewport was told to expect', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));

      // `itemSize` and this height come from one input, so they cannot disagree — but they
      // can still both be defeated by a border or padding escaping the border box, and that
      // is what this measures.
      for (const row of renderedRows(fixture)) {
        expect(row.offsetHeight).toBe(ROW_HEIGHT_PX);
      }
    });

    it('honours a row height other than the default', async () => {
      const fixture = await createHost(makeRows(200));
      fixture.componentInstance.rowHeightPx.set(64);
      await settleUntil(fixture, () => renderedRows(fixture)[0].offsetHeight === 64);

      expect(viewport(fixture).scrollHeight).toBe(200 * 64);
    });

    it('stripes rows by their data index, not by their position in the window', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));

      // Scrolled to an *odd* data index, so the row at the top of the window is striped.
      // `:nth-child(even)` would stripe the window instead: it counts the ~16 elements that
      // exist, re-assigns on every scroll tick, and the table strobes as it moves.
      const row = await scrollToRow(fixture, 1_001);

      expect(striped(row)).toBeTrue();
      expect(striped(await scrollToRow(fixture, 1_002))).toBeFalse();
    });

    it('alternates the stripe down the rendered window', async () => {
      const fixture = await createHost(makeRows(100));

      const stripes = renderedRows(fixture).map(striped);
      expect(stripes.slice(0, 4)).toEqual([false, true, false, true]);
    });

    it('lets a cell shrink below its content width so it can truncate', async () => {
      const fixture = await createHost();

      // `minmax(0, 1fr)` and not `1fr`: an `auto` minimum would refuse to shrink the track
      // below the widest cell, push the row past the viewport, and leave `truncate` with
      // nothing to truncate against.
      // `0px` rather than the `0` that was written: reading the property back gets the
      // browser's serialisation of the value, not the source text.
      const row = renderedRows(fixture)[0];
      expect(row.style.gridTemplateColumns).toBe('minmax(0px, 1fr) 8rem');
    });
  });

  describe('ARIA structure', () => {
    it('is a table, not a grid', async () => {
      const fixture = await createHost();

      // `grid` would promise arrow-key cell navigation this component does not implement.
      expect(table(fixture).getAttribute('role')).toBe('table');
      expect(table(fixture).getAttribute('aria-label')).toBe('Test rows');
      expect(table(fixture).getAttribute('aria-colcount')).toBe('2');
    });

    it('keeps the header row outside the scrolling viewport', async () => {
      const fixture = await createHost();
      const header = requireEl<HTMLElement>(
        host(fixture),
        '[data-testid="virtual-table-header-row"]'
      );

      // Inside, it would be translated with the rows and scroll away — and `position: sticky`
      // cannot rescue it, because the content wrapper is absolutely positioned and
      // `contain: content`.
      expect(viewport(fixture).contains(header)).toBeFalse();
      expect(header.getAttribute('aria-rowindex')).toBe('1');
    });

    it('puts the header and the body in sibling rowgroups', async () => {
      const fixture = await createHost();
      const rowgroups = Array.from(
        table(fixture).querySelectorAll<HTMLElement>(':scope > [role="rowgroup"]')
      );

      expect(rowgroups.length).toBe(2);
      expect(rowgroups[1]).toBe(viewport(fixture));
    });

    it('hides the viewport scaffolding the CDK renders between the rowgroup and its rows', async () => {
      const fixture = await createHost();

      // The other half of `hide-scroll-scaffolding.spec.ts`: that spec asserts the function
      // against a hand-built viewport, this one asserts the function still recognises what
      // the installed CDK actually renders.
      const wrapper = requireEl<HTMLElement>(
        viewport(fixture),
        ':scope > .cdk-virtual-scroll-content-wrapper'
      );
      const spacer = requireEl<HTMLElement>(
        viewport(fixture),
        ':scope > .cdk-virtual-scroll-spacer'
      );

      expect(wrapper.getAttribute('role')).toBe('presentation');
      expect(spacer.getAttribute('aria-hidden')).toBe('true');
    });

    it('re-hides the scaffolding when the viewport is recreated', async () => {
      const fixture = await createHost([]);
      fixture.componentInstance.rows.set(makeRows(5));
      await settleUntil(fixture, () => renderedRows(fixture).length > 0);

      // Going from empty to non-empty destroys and rebuilds the whole `@else` branch, so the
      // attributes are applied to an element that did not exist at first render. An
      // `afterNextRender` would have fired once, against nothing, and stayed silent.
      expect(
        requireEl<HTMLElement>(
          viewport(fixture),
          ':scope > .cdk-virtual-scroll-content-wrapper'
        ).getAttribute('role')
      ).toBe('presentation');
    });

    it('exposes the viewport as a focusable, named scroll region', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));

      // Without a tabindex a keyboard user cannot scroll it, and there are 10,000 rows with
      // nothing focusable inside to tab towards. Focusable means it needs a name of its own.
      expect(viewport(fixture).getAttribute('tabindex')).toBe('0');
      expect(viewport(fixture).getAttribute('aria-label')).toBe('Test rows rows');
    });

    it('numbers the columns in both the header and the body', async () => {
      const fixture = await createHost();

      expect(headerCells(fixture).map((cell) => cell.getAttribute('aria-colindex'))).toEqual([
        '1',
        '2',
      ]);
      expect(
        Array.from(renderedRows(fixture)[0].querySelectorAll<HTMLElement>('[role="cell"]')).map(
          (cell) => cell.getAttribute('aria-colindex')
        )
      ).toEqual(['1', '2']);
    });
  });

  describe('cells', () => {
    it('renders each column through its own cell function', async () => {
      const fixture = await createHost(makeRows(3));

      expect(renderedRows(fixture).map(cellTexts)).toEqual([
        ['Row 0', '0'],
        ['Row 1', '10'],
        ['Row 2', '20'],
      ]);
    });

    it('renders the column headers', async () => {
      const fixture = await createHost();

      expect(headerCells(fixture).map((cell) => (cell.textContent ?? '').trim())).toEqual([
        'Name ↕',
        'Amount',
      ]);
    });
  });

  describe('sorting', () => {
    it('reports a sort outwards rather than reordering the rows itself', async () => {
      const fixture = await createHost(makeRows(20));

      requireEl<HTMLButtonElement>(headerCells(fixture)[0], 'button').click();
      fixture.detectChanges();

      expect(fixture.componentInstance.sort()).toEqual({ columnKey: 'name', direction: 'asc' });
      // Unchanged: the rows are the caller's, in the caller's order.
      expect(cellTexts(renderedRows(fixture)[0])[0]).toBe('Row 0');
    });

    it('flips to descending on a second click of the same column', async () => {
      const fixture = await createHost(makeRows(20));
      const button = requireEl<HTMLButtonElement>(headerCells(fixture)[0], 'button');

      button.click();
      fixture.detectChanges();
      button.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.sort()).toEqual({ columnKey: 'name', direction: 'desc' });
    });

    it('publishes the sort state as aria-sort, and only on sortable columns', async () => {
      const fixture = await createHost(makeRows(20));

      expect(headerCells(fixture)[0].getAttribute('aria-sort')).toBe('none');
      // Absent, not 'none': 'none' on a column with no control advertises an affordance that
      // is not there.
      expect(headerCells(fixture)[1].hasAttribute('aria-sort')).toBeFalse();

      requireEl<HTMLButtonElement>(headerCells(fixture)[0], 'button').click();
      fixture.detectChanges();

      expect(headerCells(fixture)[0].getAttribute('aria-sort')).toBe('ascending');
    });

    it('reflects a sort the caller sets without a click', async () => {
      const fixture = await createHost(makeRows(20));
      fixture.componentInstance.sort.set({ columnKey: 'name', direction: 'desc' });
      fixture.detectChanges();

      expect(headerCells(fixture)[0].getAttribute('aria-sort')).toBe('descending');
    });

    it('scrolls back to the top, because the old offset indexed the old order', async () => {
      const fixture = await createHost(makeRows(LARGE_ROW_COUNT));
      await scrollToRow(fixture, 4_000);

      requireEl<HTMLButtonElement>(headerCells(fixture)[0], 'button').click();
      // Both, and in that order: `scrollToIndex` moves `scrollTop` synchronously, so waiting
      // on the offset alone passes one turn before the CDK has rendered the range that goes
      // with it — and the rows, not the offset, are what the user is looking at.
      await settleUntil(
        fixture,
        () => viewport(fixture).scrollTop === 0 && rowIndices(fixture)[0] === 2
      );

      expect(viewport(fixture).scrollTop).toBe(0);
      expect(cellTexts(renderedRows(fixture)[0])[0]).toBe('Row 0');
    });
  });

  describe('tracking rows across a change to the data', () => {
    it('reuses an existing view when a new array carries the same keys', async () => {
      const fixture = await createHost(makeRows(20));
      const before = renderedRows(fixture)[0];

      // A fresh array of fresh objects — what a `computed()` over a re-sorted or re-fetched
      // list produces. Only `rowKey` can tell Angular these are the same rows.
      fixture.componentInstance.rows.set(makeRows(20));
      fixture.detectChanges();

      expect(renderedRows(fixture)[0]).toBe(before);
    });

    it('rebuilds a row whose key changed', async () => {
      const fixture = await createHost(makeRows(20));
      const before = renderedRows(fixture)[0];

      const replaced = [{ id: 'replacement', name: 'Replaced', amount: 0 }, ...makeRows(19)];
      fixture.componentInstance.rows.set(replaced);
      await settleUntil(fixture, () => cellTexts(renderedRows(fixture)[0])[0] === 'Replaced');

      expect(renderedRows(fixture)[0]).not.toBe(before);
    });
  });

  describe('with no rows', () => {
    it('renders the empty message and no table at all', async () => {
      const fixture = await createHost([]);

      // "table, 1 row" is a worse answer than a sentence, so the roles are left out entirely
      // rather than producing a header with nothing under it.
      expect(
        requireEl<HTMLElement>(host(fixture), '[data-testid="virtual-table-empty"]').textContent
      ).toContain('Nothing here.');
      expect(host(fixture).querySelector('[role="table"]')).toBeNull();
    });

    it('builds the table once rows arrive', async () => {
      const fixture = await createHost([]);
      fixture.componentInstance.rows.set(makeRows(4));
      await settleUntil(fixture, () => renderedRows(fixture).length === 4);

      expect(host(fixture).querySelector('[data-testid="virtual-table-empty"]')).toBeNull();
      expect(table(fixture).getAttribute('aria-rowcount')).toBe('5');
    });
  });
});
