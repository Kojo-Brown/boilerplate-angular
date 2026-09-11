# Virtual scrolling a 10,000-row table

`VirtualTableComponent` (`src/app/shared/virtual-table/`) renders a table of any size with
only a screenful of rows in the DOM, using `@angular/cdk/scrolling`.
`/dashboard/activity` is the caller: 10,000 audit-log entries, about sixteen `role="row"`
elements.

```html
<div class="h-[32rem]">
  <app-virtual-table
    [rows]="sortedEntries()"
    [columns]="columns"
    [rowKey]="entryKey"
    [(sort)]="sort"
    label="Activity log"
  />
</div>
```

## Decide whether you need it first

Virtual scrolling is a trade, not an upgrade. On `/dashboard/activity` it costs **24.39 kB**
of `@angular/cdk/scrolling` against **9.22 kB** for the table, the page and the row generator
combined — plus **5.30 kB in the initial bundle** that cannot be moved off it (see
[below](#the-530-kb-that-lands-in-main)). What it buys is not rendering 9,984 rows.

At a few hundred rows that trade is bad: `@for` with a `track` expression renders the lot in
a few milliseconds, every structural CSS selector works, `Ctrl+F` finds text, and printing
produces the whole table. All four of those stop being true here. Reach for this component
when the row count is in the thousands **and** unbounded by the data rather than by the
screen; otherwise use `@for`.

## Why it is not a `<table>`

It cannot be, and this is worth knowing before someone tries to "fix" it.
`CdkVirtualScrollViewport` renders exactly this:

```html
<cdk-virtual-scroll-viewport>
  <div class="cdk-virtual-scroll-content-wrapper"><!-- the rows --></div>
  <div class="cdk-virtual-scroll-spacer" style="height: 480000px"></div>
</cdk-virtual-scroll-viewport>
```

The wrapper is what gets `transform: translateY(…)` as the user scrolls; the spacer is what
gives the scrollbar the height of the whole data set. Neither `div` is a permitted child of
`<table>` or `<tbody>`, and `*cdkVirtualFor` has to sit on a direct child of the wrapper — so
there is no arrangement of real table elements that survives. Overriding `display` on the
table tags to make the DOM nest does not rescue it either: that discards the table layout
which was the only reason to use the tags, and leaves every implied ARIA role attached to an
element that no longer behaves like part of a table.

So the table is CSS grid plus explicit roles: `role="table"` on the container, a
`role="rowgroup"` for the header and another for the body, `role="row"`, `role="columnheader"`,
`role="cell"`. The roles are now the component's responsibility rather than the parser's,
which is what the next two sections are about.

`role="table"` and not `role="grid"`: `grid` is a composite widget, and claiming it commits
you to arrow-key cell navigation, a roving `tabindex`, and `Home`/`End`/`PageUp`/`PageDown`.
A read-only data table is a `table`, and a half-implemented `grid` is worse than either.

## What virtualisation does to assistive technology

This is the part that is easy to ship broken, because it is invisible unless you use a screen
reader.

**The DOM no longer contains the table.** It contains a sliding window of ~16 rows out of
10,000. A screen reader reads a table's size out of the accessibility tree, so without help it
announces "row 3 of 16" and the other 9,984 rows do not exist as far as the user is concerned.
`aria-rowcount` on the table and `aria-rowindex` on every row replace the tree's count with
the real one. Both are 1-based and count the header row, so the data row at index `i` carries
`aria-rowindex="i + 2"` and a 10,000-row table reports `aria-rowcount="10001"`.

That arithmetic is only possible because `*cdkVirtualFor`'s `index` is the index in the whole
data set, not in the rendered range — `CdkVirtualForOf._updateContext` sets
`context.index = renderedRange.start + i`. The index its **trackBy** receives is *not*
absolute, which is the subject of [the next section](#rowkey-takes-a-row-not-an-index).

**The header has to live outside the viewport.** Inside it, the header row would be translated
along with the rows and scroll out of view, and `position: sticky` cannot save it: the content
wrapper is `position: absolute` with `contain: content`, so there is no scrollport for the
header to stick to. Being a sibling of the viewport also makes it a sibling `rowgroup`, which
is what `<thead>` would have been.

**The viewport's two scaffolding divs have to be hidden.** They sit between the body
`rowgroup` and its `row`s, where ARIA expects nothing at all. `hideScrollScaffolding()` marks
the wrapper `role="presentation"` — which removes it from the accessibility tree and promotes
the rows onto the rowgroup — and the spacer `aria-hidden="true"`, since it is a scrollbar-
sizing device with no content. It runs from an `afterRenderEffect` (`write` phase) rather than
`afterNextRender`, because the viewport element is recreated whenever `rows` goes from empty
to non-empty, and render hooks are browser-only so the component stays server-renderable.

Those two class names are part of the CDK's published styling surface but are not a typed API,
so the function **throws** when either element is missing rather than skipping quietly. A CDK
upgrade that restructures the viewport then fails
`hide-scroll-scaffolding.spec.ts` on the upgrade commit, instead of shipping a table whose
rows belong to nothing. `virtual-table.component.spec.ts` asserts the other half — that the
installed CDK still renders what the function expects.

**The viewport has to be focusable.** A scrollable region that cannot take focus cannot be
scrolled from the keyboard (WCAG 2.1.1), and there is nothing inside these 10,000 rows to tab
towards that would bring the rest into view. `tabindex="0"` makes it reachable, and anything
focusable needs an accessible name, which is why `label` is a required input.

## `rowKey` takes a row, not an index

The component's key function is `(row: T) => string | number`, not a `TrackByFunction<T>`.
That is deliberate, and it closes a hazard rather than just being tidier.

`cdkVirtualFor` diffs `_renderedItems` — the *slice* of the data in the rendered range — so
the index its `trackBy` is called with is relative to that window. `trackBy: (index) => index`
is merely fragile in a `@for`; here it is outright wrong. Index 0 means a different row after
every scroll tick, and tracked across a sort it hands one row's DOM node to another row's data.
Taking only the row makes the index unreachable, so the mistake has nowhere to be written.

## CSS structural selectors do not work here

`:nth-child(even)` zebra striping counts positions among the ~16 elements that exist, not
among the 10,000 rows. It re-assigns itself on every scroll tick and the table appears to
strobe as it moves. `:last-child` draws a boundary in the middle of the list; `:first-child`
styles whichever row happens to be at the top of the window.

So the stripe is bound from the row's data index (`rowIndex % 2 === 1`), and
`virtual-table.component.spec.ts` scrolls to an odd index and asserts the row at the top of
the window is striped — which is exactly the assertion a `:nth-child` implementation fails.

## `itemSize` and the row height are one input

The spacer's height is `itemSize × rows.length`. A row that renders at any other height makes
the scrollbar describe a document that does not exist, and the rendered range drifts further
from the scroll offset the further down the user goes.

They are therefore the same signal: `rowHeightPx` is passed to `[itemSize]` *and* applied as
the row's inline height. As a CSS class plus a number they could disagree silently; as one
input they cannot. A spec still measures `offsetHeight` on every rendered row, because a
border or some padding escaping the border box can defeat both at once.

Fixed size, not `CdkAutoSizeVirtualScroll`: auto-sizing is still experimental, and a fixed
size is what makes the scrollbar honest without measuring 10,000 rows. A row whose content can
wrap needs a different component, not a larger number here.

## What a cell cannot be

`VirtualTableColumn.cell` is `(row: T) => string`. A template per column would be more capable
— a link, a badge, a nested component — and it is the wrong trade at this scale: every
templated cell is an `EmbeddedViewRef`, so five columns across ~16 rendered rows means 80
embedded views created and destroyed on *every* change of the rendered range, which is the
cost virtualisation exists to remove. An interpolation runs inside a row view that already
exists.

The consequence is real: a cell cannot hold a link or a control, so a row-level action belongs
on the row. Formatting lives in the caller's `cell` function, which is also the cheapest place
to test it — it is a pure function and needs no fixture.

One thing to watch in a `cell`: it runs once per rendered row per change detection of that row.
`ActivityLogComponent` builds its one `Intl.DateTimeFormat` at module load for that reason —
constructing a formatter inside `cell` puts locale resolution on the scroll path.

## Sorting belongs to the caller

The table renders the sort affordance and publishes `aria-sort`; it does not reorder anything.
`sort` is a `model()`, and `ActivityLogComponent` sorts in a `computed()`.

The reason is the same scale argument: a `computed` re-sorts once per change of `sort()`, not
once per change detection and certainly not once per scroll tick. A table sorting its own
`rows` input could not promise that — it would either copy and sort 10,000 entries inside a
render pass or keep its own memo of a data set it does not own. It also keeps the door open to
the answer a real deployment reaches for, which is `ORDER BY`.

Two details on the caller's side:

- **Compose a tiebreak before applying direction.** `action` has five distinct values across
  10,000 rows. Without `|| left.sequence - right.sequence` the order inside each group is
  whatever the sort implementation did, and "descending" is not the exact reverse of
  "ascending".
- **Compare ISO-8601 strings, don't parse them.** Fixed-width UTC timestamps sort
  lexicographically exactly as they sort chronologically, and 10,000 rows is ~130,000
  comparisons — each of which would otherwise allocate two `Date` objects.

Clicking a header scrolls the viewport back to the top. That is part of sorting rather than a
courtesy: the old scroll offset indexes an ordering that no longer exists, so keeping it leaves
the user looking at rows 9,000–9,015 of a list they just reordered, with no sign that what they
sorted for is now at the top.

## The 5.30 kB that lands in `main`

Adding this route grew the **initial** bundle by 5.30 kB, and the `initial` budget in
`angular.json` moved from 565 kB to 571 kB to absorb it. That is worth explaining, because the
previous bundle item refused a budget raise for a smaller number.

The route itself splits correctly: `@angular/cdk/scrolling`, `VirtualTableComponent`,
`ActivityLogComponent` and the generator are all in the lazy
`activity-log-component` chunk, and `pnpm check:routes` prices them there. What leaked into
`main` is the CDK's *rxjs* dependencies — `auditTime`, `audit`, the animation-frame and asap
schedulers, `ConnectableObservable`, `refCount`, `pairwise` — plus ~1.1 kB of CDK
platform/element helpers.

They are there because 13 eager files import from the `rxjs` barrel, which makes every rxjs
module statically reachable from the entry point and fixes their chunk assignment to `main`.
Tree-shaking is what had been keeping them out; a lazy consumer of `auditTime` does not move
`auditTime` into the lazy chunk, it only makes it survive in `main`. No route-level change can
shift that — the lever is the eager code's barrel imports, which is a different piece of work.

The remaining ~0.8 kB is Tailwind utilities for the table in `styles.css`.

## What this does not do

- **No paged `DataSource`.** The 10,000 rows are a real array in memory. Rendering is bounded
  by the viewport; *holding* the data is still linear in the row count. A log that grows
  without bound needs a `DataSource` driven by
  `CdkVirtualScrollViewport.renderedRangeStream`, fetching pages as the window moves, with a
  per-row placeholder for rows not yet loaded. `*cdkVirtualFor` already accepts a `DataSource`,
  so the table would not change — the page and a server contract would.
- **No horizontal virtualisation.** Every column of every rendered row is in the DOM. Six
  columns do not need it; a hundred would.
- **No row selection, no keyboard cell navigation, no column resizing.** Each of those pushes
  towards `role="grid"` and the full keyboard interaction pattern that comes with it.
- **No `Ctrl+F`, and no complete printout.** Unavoidable consequences of the rows not being in
  the document. An export is the usual answer and there is not one yet.
- **Not covered by Playwright.** The e2e suite is still not a CI gate, so the behaviour here is
  asserted by unit specs against a real headless browser — which is where the layout, the
  scroll offsets and the computed stripe colours are actually measured.
