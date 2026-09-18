import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { expectDistinctNodes, expectSameNodes, expectUniqueKeys, trackedNodes } from './track';

interface Row {
  readonly id: string;
  readonly label: string;
}

/** Tracks by a stable field of the row — the form that survives a refetch. */
@Component({
  selector: 'app-tracked-by-id',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (row of rows(); track row.id) {
      <li data-testid="row">{{ row.label }}</li>
    }
  `,
})
class TrackedByIdComponent {
  readonly rows = signal<readonly Row[]>([]);
}

/** Tracks by object identity — the form a refetch defeats. */
@Component({
  selector: 'app-tracked-by-identity',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (row of rows(); track row) {
      <li data-testid="row">{{ row.label }}</li>
    }
  `,
})
class TrackedByIdentityComponent {
  readonly rows = signal<readonly Row[]>([]);
}

/** Tracks by position — the form a filter defeats. */
@Component({
  selector: 'app-tracked-by-index',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (row of rows(); track $index) {
      <li data-testid="row">{{ row.label }}</li>
    }
  `,
})
class TrackedByIndexComponent {
  readonly rows = signal<readonly Row[]>([]);
}

const SEED: readonly Row[] = [
  { id: 'a', label: 'Ama' },
  { id: 'b', label: 'Kofi' },
  { id: 'c', label: 'Yaa' },
];

/** A fresh array of fresh objects with identical contents: what a refetch hands back. */
function refetched(rows: readonly Row[]): readonly Row[] {
  return rows.map((row) => ({ ...row }));
}

async function render<T extends { rows: WritableSignal<readonly Row[]> }>(
  component: new () => T
): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(component);
  fixture.componentInstance.rows.set(SEED);
  await fixture.whenStable();
  return fixture;
}

describe('trackedNodes', () => {
  it('returns the rendered rows in document order', async () => {
    const fixture = await render(TrackedByIdComponent);

    expect(trackedNodes(fixture, '[data-testid="row"]').map((node) => node.textContent)).toEqual([
      'Ama',
      'Kofi',
      'Yaa',
    ]);
  });
});

describe('expectSameNodes', () => {
  it('passes when a stable key survives a refetch', async () => {
    const fixture = await render(TrackedByIdComponent);
    const before = trackedNodes(fixture, '[data-testid="row"]');

    fixture.componentInstance.rows.set(refetched(SEED));
    await fixture.whenStable();

    expect(() =>
      expectSameNodes(before, trackedNodes(fixture, '[data-testid="row"]'))
    ).not.toThrow();
  });

  it('fails when object identity is the key and the data is refetched', async () => {
    // The bug the helper exists for, provoked rather than described: identical rendered
    // text, every node replaced. An assertion on `textContent` cannot tell the difference.
    const fixture = await render(TrackedByIdentityComponent);
    const before = trackedNodes(fixture, '[data-testid="row"]');

    fixture.componentInstance.rows.set(refetched(SEED));
    await fixture.whenStable();
    const after = trackedNodes(fixture, '[data-testid="row"]');

    expect(after.map((node) => node.textContent)).toEqual(['Ama', 'Kofi', 'Yaa']);
    expect(() => expectSameNodes(before, after)).toThrowError(/3 of 3 row\(s\) were destroyed/);
  });

  it('reports a length change as a different failure from a rebuild', async () => {
    const fixture = await render(TrackedByIdComponent);
    const before = trackedNodes(fixture, '[data-testid="row"]');

    fixture.componentInstance.rows.set(SEED.slice(0, 2));
    await fixture.whenStable();

    expect(() =>
      expectSameNodes(before, trackedNodes(fixture, '[data-testid="row"]'))
    ).toThrowError(/changed length/);
  });

  it('refuses to pass on an empty "before", which would prove nothing', () => {
    expect(() => expectSameNodes([], [])).toThrowError(/cannot prove anything/);
  });

  it('shows what tracking by position costs when a row is removed from the middle', async () => {
    // Keyed by index, dropping the middle row moves 'Yaa' into the node that was 'Kofi''s
    // and destroys the last one. With three rows that is one rebuild rather than three,
    // which is exactly why the failure is easy to miss: most nodes are still reused.
    const fixture = await render(TrackedByIndexComponent);
    const before = trackedNodes(fixture, '[data-testid="row"]');

    fixture.componentInstance.rows.set([SEED[0], SEED[2]]);
    await fixture.whenStable();
    const after = trackedNodes(fixture, '[data-testid="row"]');

    expect(after.map((node) => node.textContent)).toEqual(['Ama', 'Yaa']);
    // The node that said 'Kofi' now says 'Yaa': same element, different row.
    expect(after[1]).toBe(before[1]);
  });
});

describe('expectDistinctNodes', () => {
  it('passes when every row has its own node', async () => {
    const fixture = await render(TrackedByIdComponent);

    expect(() => expectDistinctNodes(trackedNodes(fixture, '[data-testid="row"]'))).not.toThrow();
  });

  it('fails when the same node appears twice', () => {
    const node = document.createElement('li');

    expect(() => expectDistinctNodes([node, node])).toThrowError(/duplicate keys/);
  });
});

describe('expectUniqueKeys', () => {
  it('passes for a collection with unique keys', () => {
    expect(() => expectUniqueKeys(SEED, (row) => row.id)).not.toThrow();
  });

  it('names both indexes when a key repeats', () => {
    const rows = [...SEED, { id: 'a', label: 'Ama again' }];

    expect(() => expectUniqueKeys(rows, (row) => row.id)).toThrowError(
      /Duplicate track key "a" at index 3; first seen at index 0/
    );
  });

  it('catches a key that is plausible but not unique', () => {
    // `authorId` over posts is the realistic version of this: unique in a fixture with one
    // post per author, NG0955 the moment anybody publishes twice.
    expect(() => expectUniqueKeys(SEED, (row) => row.label.length)).toThrowError(/Duplicate/);
  });

  it('refuses an empty collection, which would prove nothing', () => {
    expect(() => expectUniqueKeys<string>([], (row) => row)).toThrowError(/proves nothing/);
  });
});
