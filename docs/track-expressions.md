# `@for` track expressions

`@for` requires a `track` clause — the compiler will not accept the block without one —
and that requirement is where most codebases stop thinking about it. The clause is
mandatory; being *right* is not checked by anything.

This document is about what the expression does, the three ways it goes wrong, and why
neither the compiler, ESLint, nor a passing spec notices any of them.

## What the expression actually controls

`@for` diffs the collection every time it changes and reconciles the DOM against the
result. The track expression is the key it diffs by:

| The key… | `@for` concludes | What happens to the DOM |
| --- | --- | --- |
| was there before, same position | the row is unchanged | node kept, bindings re-evaluated |
| was there before, new position | the row moved | node **moved**, not rebuilt |
| is new | a row was added | node created |
| has gone | a row was removed | node destroyed |

Everything below follows from that table. Note what is *not* in it: the item's contents.
`@for` never compares two items field by field, so two objects with identical data and
different keys are two different rows as far as reconciliation is concerned — and two
objects with different data and the same key are one row that changed.

## Why a wrong key is invisible

The rendered output is correct either way. A block keyed by a good expression and a block
keyed by a bad one produce the same text, the same attributes and the same element
structure; what differs is *which element objects* the browser is holding. So:

- **The compiler** cannot help. `track` takes an arbitrary Angular expression, and whether
  a given one identifies a row is a fact about the data.
- **ESLint** cannot help, for the same reason, and this repository does not run
  `@angular-eslint` anyway.
- **A spec** does not notice, because the assertions people write — `textContent`, a count
  of rendered rows, an attribute — pass in both worlds. That is the important one: a suite
  can be thorough and still be blind here.

What *does* differ is observable, just not through the usual assertions: DOM node identity,
and everything attached to a node rather than to the framework. Focus. Selection. A
half-typed value in an uncontrolled input. Scroll position inside a row. A running CSS
animation. A `<video>`'s playback position. An `<img>`'s decoded bitmap.

## The three failures

### Tracking by position

```html
@for (row of rows(); track $index) { … }
```

The key is where the row sits, so the identity of row 3 is "third". Filter a list of ten
down to three and `@for` is told that rows 0–2 changed and rows 3–9 were removed: the first
three nodes stay exactly where they are and have different data poured into them.

`src/testing/track.spec.ts` provokes this with three rows and removes the middle one. The
node that said `Kofi` now says `Yaa` — same element object, different row — and the
rendered text is still correct, which is why nobody finds it by reading the page.

Correct where the collection is append-only and never reordered or filtered. That is a
real case, and it is the only one.

### Tracking by object identity

```html
@for (post of page.data; track post) { … }
```

The key is the object reference. This repository's lists come from TanStack Query, and a
refetch deserialises a fresh array of fresh objects: every key is new, so every row is
destroyed and rebuilt even though nothing in the data changed. A full re-render, on an
interval, with no visible symptom — except that every `<img>` inside those rows is
requested again, because the new element has never had a `src`.

Correct where the items *are* their identity: a list of strings, numbers, or enum members.
`widget-board.component.ts` iterates `STAT_RANGES`, a readonly tuple of string literals,
and tracks the value. There is nothing else to track.

### A key that is not unique

```html
@for (post of posts(); track post.authorId) { … }
```

The only one of the three that announces itself: Angular raises **NG0955** on a duplicate
key. But it raises it in development, from a render that actually reaches the duplicate —
so a fixture with one post per author is green, and the error waits for a real account
where somebody has published twice.

## The rule this repository enforces

`scripts/ci/assert-for-track.mjs` parses every component template with the Angular
compiler's own parser, finds every `@for`, and classifies its track expression against the
loop variable:

- **A property path rooted at the item** — `post.id`, `panel.definition.id` — passes
  silently. It is the form that is right by default: a field of the row, stable across
  refetches, as unique as the field is.
- **Anything else** — the item itself, `$index` (alone or inside a larger expression), a
  call, a path rooted somewhere other than the item — is allowed, and must carry a
  justification immediately above the block:

  ```html
  <!--
    track: the ranges collection is a readonly tuple of string literals, so the value is
    the identity and there is nothing else to key on.
  -->
  @for (option of ranges; track option) { … }
  ```

The gate is not claiming the risky forms are wrong. It is claiming that choosing one is a
decision, and that the decision belongs next to the code where a reviewer reads one
sentence instead of reconstructing the argument from the collection's type. Same shape as
the DEP0205 allow-list in `assert-no-unexpected-deprecations.sh`.

The audit table lands in the job summary, so the full set of track expressions and how each
one keys its rows is on the pull request rather than in a log.

### What the gate cannot do

**Uniqueness.** `post.id` is unique exactly as far as the API says it is, and the template
says nothing about that. Covered by NG0955 and by `expectUniqueKeys` below.

**Whether a collection holds objects or primitives.** The template says `ranges`; what
`ranges` holds is in the component class. This is precisely why `track option` needs a
sentence from a human rather than an inference from a script.

**Inputs of a component used inside a `@for`.** The gate sees `@for` blocks in the template
it is reading. A component rendered inside one, with its own `@for` inside it, is two
templates and two independent checks.

## Asserting it in a spec

`src/testing/track.ts` makes DOM node identity the assertion, which is the only thing that
observes a track expression:

```ts
const before = trackedNodes(fixture, 'dt img');
expectDistinctNodes(before);

await TestBed.inject(QueryClient).refetchQueries();
await fixture.whenStable();

expectSameNodes(before, trackedNodes(fixture, 'dt img'));
```

`insights-panel.component.spec.ts` runs exactly that against a real refetch. Keyed by
object identity the same spec fails with *3 of 3 row(s) were destroyed and rebuilt* while
every text assertion in the file still passes — which is the whole argument for having the
helper.

- `trackedNodes(fixture, selector)` — the live elements, in document order.
- `expectSameNodes(before, after)` — the nodes that should have been reused were reused.
  Distinguishes a length change from a length-preserving rebuild, because they are
  different bugs.
- `expectDistinctNodes(nodes)` — every row has its own node. Catches a non-unique key,
  which does not look like a rebuild.
- `expectUniqueKeys(items, key)` — the data-side half, and the one worth pointing at a
  generator: 10,000 rows from `activity-log.data.ts` are where a key that is unique in a
  five-row fixture stops being unique, and no rendering assertion will ever visit row
  7,214.

## `trackBy`, and where it still exists

`NgForOf`'s `trackBy` is the same idea with a worse signature — `(index, item) => key` —
and `@for` replaces it. Two places in this repository still take a tracking function, and
both are worth knowing about because their index arguments do not mean what they look like:

- **`*cdkVirtualFor`** diffs the *rendered slice*, not the collection, so the index its
  `trackBy` receives is a position in a ~16-element window over 10,000 rows. Tracking by it
  hands one row's DOM node to another row's data as the viewport scrolls.
  `virtual-table.component.ts` takes a `rowKey: (row: T) => unknown` instead of a
  `TrackByFunction` so that mistake is not expressible; see `docs/virtual-scrolling.md`.
- **`*appRepeat`** renders a template a fixed number of times and has no collection to
  track. It adds and removes views at the end rather than rebuilding, which is the same
  guarantee a correct track expression gives, arrived at by having nothing to key on; see
  `docs/structural-directives.md`.

## See also

- [`docs/images.md`](./images.md) — why a wrong track expression re-downloads every avatar.
- [`docs/virtual-scrolling.md`](./virtual-scrolling.md) — `rowKey` and the sliding window.
- [`docs/structural-directives.md`](./structural-directives.md) — `*appRepeat`.
