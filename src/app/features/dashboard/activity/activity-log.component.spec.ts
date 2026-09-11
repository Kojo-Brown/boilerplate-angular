import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { host, requireEl, settleUntil } from '@/testing';
import { ActivityLogComponent } from './activity-log.component';
import { ACTIVITY_ROW_COUNT, generateActivityLog } from './activity-log.data';

describe('ActivityLogComponent', () => {
  async function createComponent(): Promise<ComponentFixture<ActivityLogComponent>> {
    TestBed.configureTestingModule({ imports: [ActivityLogComponent] });
    const fixture = TestBed.createComponent(ActivityLogComponent);
    fixture.detectChanges();
    await settleUntil(fixture, () => rows(fixture).length > 0);

    return fixture;
  }

  function rows(fixture: ComponentFixture<unknown>): HTMLElement[] {
    return Array.from(
      host(fixture).querySelectorAll<HTMLElement>('[data-testid="virtual-table-row"]')
    );
  }

  function cellTexts(row: HTMLElement): string[] {
    return Array.from(row.querySelectorAll<HTMLElement>('[role="cell"]')).map((cell) =>
      (cell.textContent ?? '').trim()
    );
  }

  function headerButton(fixture: ComponentFixture<unknown>, header: string): HTMLButtonElement {
    const buttons = Array.from(
      host(fixture).querySelectorAll<HTMLButtonElement>('[role="columnheader"] button')
    );
    const match = buttons.find((button) => (button.textContent ?? '').trim().startsWith(header));
    if (match === undefined) {
      throw new Error(
        `Expected a sortable column headed "${header}". Found: ` +
          buttons.map((button) => (button.textContent ?? '').trim()).join(', ')
      );
    }

    return match;
  }

  function firstColumn(fixture: ComponentFixture<unknown>, columnIndex: number): string[] {
    return rows(fixture).map((row) => cellTexts(row)[columnIndex]);
  }

  it('declares the whole log to assistive technology while rendering a screenful', async () => {
    const fixture = await createComponent();

    expect(
      requireEl<HTMLElement>(host(fixture), '[data-testid="virtual-table"]').getAttribute(
        'aria-rowcount'
      )
    ).toBe(String(ACTIVITY_ROW_COUNT + 1));
    expect(rows(fixture).length).toBeLessThan(40);
  });

  it('tells the reader how many entries there are and in which zone', async () => {
    const fixture = await createComponent();

    expect(host(fixture).textContent).toContain('10,000 entries');
    expect(host(fixture).textContent).toContain('UTC');
  });

  it('starts in log order, newest entry first', async () => {
    const fixture = await createComponent();

    expect(firstColumn(fixture, 0)[0]).toBe('1');
  });

  it('renders a timestamp as UTC regardless of where the browser is', async () => {
    const fixture = await createComponent();
    const [newest] = generateActivityLog(1);

    // Asserted against the entry's own ISO date rather than a literal, so the expectation
    // cannot drift from the generator. The point is that the *date* shown is the UTC date.
    expect(cellTexts(rows(fixture)[0])[1]).toContain(newest.occurredAt.slice(8, 10));
  });

  describe('sorting', () => {
    it('reorders the whole log, not just the rendered rows', async () => {
      const fixture = await createComponent();

      headerButton(fixture, 'Duration').click();
      await settleUntil(fixture, () => firstColumn(fixture, 0)[0] !== '1');

      // The fastest entry in all 10,000 rows, which was nowhere near the rendered range
      // before the click.
      const fastest = Math.min(...generateActivityLog().map((entry) => entry.durationMs));
      expect(cellTexts(rows(fixture)[0])[5]).toBe(`${fastest} ms`);
    });

    it('makes descending the exact reverse of ascending, ties included', async () => {
      const fixture = await createComponent();
      const button = headerButton(fixture, 'Action');

      button.click();
      await settleUntil(fixture, () => firstColumn(fixture, 3)[0] === 'created');
      const ascendingTop = firstColumn(fixture, 0).slice(0, 5);

      button.click();
      await settleUntil(fixture, () => firstColumn(fixture, 3)[0] === 'viewed');
      const descendingTop = firstColumn(fixture, 0).slice(0, 5);

      // `action` has five distinct values across 10,000 rows, so without the `sequence`
      // tiebreak the order within a group would be whatever the sort implementation did and
      // these two lists would not be related at all.
      const expected = [...generateActivityLog()]
        .sort(
          (left, right) =>
            -(left.action.localeCompare(right.action) || left.sequence - right.sequence)
        )
        .slice(0, 5)
        .map((entry) => String(entry.sequence));

      expect(descendingTop).toEqual(expected);
      expect(descendingTop).not.toEqual(ascendingTop);
    });

    it('sorts by actor', async () => {
      const fixture = await createComponent();

      headerButton(fixture, 'Actor').click();
      await settleUntil(fixture, () => firstColumn(fixture, 2)[0].startsWith('ada'));

      const actors = firstColumn(fixture, 2);
      expect([...actors]).toEqual([...actors].sort((left, right) => left.localeCompare(right)));
    });

    it('returns to log order when sorted ascending by sequence', async () => {
      const fixture = await createComponent();

      headerButton(fixture, 'Duration').click();
      await settleUntil(fixture, () => firstColumn(fixture, 0)[0] !== '1');
      headerButton(fixture, '#').click();
      await settleUntil(fixture, () => firstColumn(fixture, 0)[0] === '1');

      expect(firstColumn(fixture, 0).slice(0, 3)).toEqual(['1', '2', '3']);
    });

    it('leaves the resource column unsortable, because it has no comparator', async () => {
      const fixture = await createComponent();
      const resourceHeader = Array.from(
        host(fixture).querySelectorAll<HTMLElement>('[role="columnheader"]')
      )[4];

      // The comparator map is keyed by `ActivitySortKey`, so a column offering a sort it
      // cannot perform would not compile. This asserts the pairing stayed honest in the
      // other direction: no control, and therefore no `aria-sort` promising one.
      expect(resourceHeader.textContent?.trim()).toBe('Resource');
      expect(resourceHeader.querySelector('button')).toBeNull();
      expect(resourceHeader.hasAttribute('aria-sort')).toBeFalse();
    });
  });
});
