#!/usr/bin/env node
// Fail when a `@for` block's track expression does not identify its row, unless the
// template says why.
//
// ## What a track expression is for, and what goes wrong without this
//
// `@for` diffs the collection on every change and reconciles the DOM against the result.
// The track expression is the key it diffs by: two items with the same key are the same
// row, so the existing DOM node is *kept* and its bindings updated; a key it has not seen
// is a new row, so a node is created; a key that has gone means a node is destroyed.
// Everything a track expression is worth follows from that one sentence.
//
// Get it wrong and nothing fails. There is no compiler diagnostic — `track` is mandatory
// in the block's grammar but its *value* is an arbitrary expression the compiler cannot
// reason about — no lint rule, and no failing spec, because the rendered output is
// correct either way. What changes is which DOM nodes the browser keeps, and that is
// invisible to an assertion on text content. Three ways it bites, all of them present in
// this application's own `@for` blocks if the keys were chosen carelessly:
//
//   - **`track $index` over a list that can reorder or be filtered.** The key is the
//     position, so filtering a list of ten down to three tells Angular that rows 0–2 were
//     updated and 3–9 removed. The first three nodes stay put and have different data
//     poured into them — along with everything the DOM, not the framework, was holding:
//     focus, a half-typed input, scroll position, a running animation, and an
//     `<img loading="lazy">` that now shows the previous row's picture until the new one
//     decodes. Correct only where the collection is append-only and never reordered.
//   - **`track item` where the item is an object.** The key is object identity, and this
//     application's lists come from TanStack Query: a refetch deserialises a fresh array
//     of fresh objects that are `===` to nothing. Every key is new, so every row is
//     destroyed and rebuilt on data that did not change — a full re-render, no visible
//     bug, and the avatars in `posts-list.component.ts` re-requested each time. Correct
//     where the items *are* the identity: a list of strings or numbers.
//   - **A key that is not unique** — `track post.authorId` over posts, say. Angular
//     throws NG0955 in development, which is the one case in this list that announces
//     itself, and only from a render that actually hits the duplicate.
//
// ## The rule
//
// A track expression that is a property path rooted at the loop item — `post.id`,
// `entry.audit.id` — passes without comment. It is the form that is right by default: a
// field of the row, stable across refetches, and as unique as the field is.
//
// Anything else — the item itself, `$index`, a call, arithmetic, a path rooted somewhere
// other than the item — is *allowed but must be justified*, with a `track:` comment
// immediately above the block:
//
//     <!-- track: `ranges` is a readonly tuple of string literals, so the value is the
//          is the identity and there is nothing else to key on. -->
//     @for (option of ranges; track option) { … }
//
// This is the same shape as the DEP0205 allow-list in
// `assert-no-unexpected-deprecations.sh`: the gate does not claim the risky form is wrong,
// it claims that choosing it is a decision and that the decision belongs next to the code.
// A reviewer then reads one sentence instead of reconstructing the argument from the type
// of the collection.
//
// ## What this gate cannot do
//
// It cannot tell you the key is unique. Uniqueness is a property of the data, not of the
// expression, and `post.id` is unique exactly as far as the API says it is — NG0955 and
// the runtime check in `src/testing/track.ts` are what cover that half. Nor can it tell
// an object collection from a primitive one: the template says `ranges`, and what `ranges`
// holds is in the component class. That is precisely why `track option` needs a sentence
// from a human rather than an inference from this script.
//
// Usage:  node scripts/ci/assert-for-track.mjs
// See:    docs/track-expressions.md

import { appendFileSync } from 'node:fs';
import { collectTemplates, fileLineOf, parseFile, walk } from './lib/templates.mjs';

/** How a track expression relates to the row, and whether that is self-evidently right. */
const TRACK_KINDS = {
  /** `post.id` — a property path rooted at the loop item. Right by default. */
  itemProperty: { justify: false, label: 'item property' },
  /** `option` — the item itself, i.e. object or value identity. */
  itemIdentity: { justify: true, label: 'item identity' },
  /** `$index`, alone or inside a larger expression: the position, not the row. */
  index: { justify: true, label: 'index' },
  /** A call, arithmetic, or a path rooted outside the loop item. */
  other: { justify: true, label: 'other' },
};

/** Marks a deliberate use of a track expression that is not an item property. */
const JUSTIFICATION = /(^|\s)track:/i;

/**
 * Classify a parsed track expression against its loop item.
 *
 * Works on the expression AST rather than its text so that `post.id` and `post . id`
 * classify the same, and so that `$index` inside a larger expression is still found —
 * `track $index + '-' + row.id` keys partly on position, which carries every hazard of
 * keying on position alone.
 *
 * @param {object} ast The `ASTWithSource`'s inner AST.
 * @param {string} item The loop variable's name.
 * @returns {keyof TRACK_KINDS}
 */
export function classifyTrack(ast, item) {
  if (mentionsIndex(ast)) return 'index';

  const kind = ast.constructor.name;

  if (kind === 'PropertyRead') {
    const root = rootOf(ast);
    if (root === null) return 'other';
    // `track post` — the receiver chain bottoms out at the item with no field read.
    if (ast.receiver?.constructor?.name === 'ImplicitReceiver') {
      return ast.name === item ? 'itemIdentity' : 'other';
    }
    // `track post.id`, `track row.audit.id` — a field of the item.
    return root === item ? 'itemProperty' : 'other';
  }

  return 'other';
}

/** The identifier a property-read chain bottoms out at, or `null` if it is not one. */
function rootOf(ast) {
  let node = ast;
  while (node?.constructor?.name === 'PropertyRead') {
    if (node.receiver?.constructor?.name === 'ImplicitReceiver') return node.name;
    node = node.receiver;
  }
  return null;
}

/** Whether `$index` — or its alias, via `let i = $index` — appears anywhere in the AST. */
function mentionsIndex(ast) {
  let found = false;
  const visit = (node) => {
    if (!node || typeof node !== 'object' || found) return;
    if (node.constructor?.name === 'PropertyRead' && node.name === '$index') {
      found = true;
      return;
    }
    for (const key of ['receiver', 'left', 'right', 'exp', 'condition', 'trueExp', 'falseExp']) {
      visit(node[key]);
    }
    for (const key of ['args', 'expressions', 'keys', 'values']) {
      if (Array.isArray(node[key])) node[key].forEach(visit);
    }
  };
  visit(ast);
  return found;
}

/**
 * Whether a `track:` comment sits immediately above the block.
 *
 * "Immediately above" means the nearest non-blank line before the `@for`, which is where a
 * comment about the block is written and is short enough that it cannot drift onto an
 * unrelated block. Multi-line comments are handled by looking at the whole comment the
 * line belongs to, so the sentence may wrap.
 */
function hasJustification(template, blockLine) {
  const lines = template.text.split('\n');
  // `blockLine` is a file line; the template's own line 0 is at `template.startLine`.
  let cursor = blockLine - template.startLine - 1;

  while (cursor >= 0 && lines[cursor].trim() === '') cursor -= 1;
  if (cursor < 0) return false;

  // Walk back to the start of the HTML comment this line closes, so that a justification
  // wrapped over several lines is read as one comment rather than as its last line.
  let start = cursor;
  if (lines[cursor].includes('-->')) {
    while (start >= 0 && !lines[start].includes('<!--')) start -= 1;
    if (start < 0) return false;
  } else if (!lines[cursor].includes('<!--')) {
    return false;
  }

  return JUSTIFICATION.test(lines.slice(start, cursor + 1).join(' '));
}

/**
 * Every `@for` block in the repository, classified.
 *
 * @param {import('./lib/templates.mjs').InlineTemplate[]} templates
 */
export function auditTracks(templates) {
  const blocks = [];

  for (const template of templates) {
    walk(template.nodes, (node) => {
      if (node.constructor.name !== 'ForLoopBlock') return;

      const line = fileLineOf(template, node.startSourceSpan);
      const kind = classifyTrack(node.trackBy.ast, node.item.name);

      blocks.push({
        file: template.file,
        line,
        item: node.item.name,
        collection: node.expression.source ?? '',
        track: node.trackBy.source ?? '',
        kind,
        justified: TRACK_KINDS[kind].justify ? hasJustification(template, line) : true,
      });
    });
  }

  return blocks.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Sources written to provoke each rule, and the classification each must produce.
 *
 * The gates in this directory are the only code here that no unit spec can reach: Karma
 * builds `src/`, and a Node script that reads the repository is not in that graph. So each
 * rule is proved against a fixture *by the gate itself*, on every run, before it certifies
 * anything — a rule that has stopped firing fails the build in its own right rather than
 * quietly passing the repository. The fixtures are source strings and not files on disk
 * because a directory of deliberately-bad components would have to be excluded from the
 * compiler, the linter, and this gate's own sweep.
 */
const SELF_TEST_CASES = [
  { track: 'post.id', item: 'post', expect: 'itemProperty' },
  { track: 'row.audit.id', item: 'row', expect: 'itemProperty' },
  { track: 'option', item: 'option', expect: 'itemIdentity' },
  { track: '$index', item: 'row', expect: 'index' },
  // Composite keys that include the position carry every hazard of the position alone:
  // filtering the list still renumbers every row below the removal.
  { track: "$index + '-' + row.id", item: 'row', expect: 'index' },
  { track: 'keyOf(row)', item: 'row', expect: 'other' },
  // A key rooted outside the loop item is the same value for every row, which is NG0955
  // on the second row rather than a subtle reuse bug.
  { track: 'selection.id', item: 'row', expect: 'other' },
  { track: 'row.id ?? row.slug', item: 'row', expect: 'other' },
];

/** A component source carrying one `@for`, for driving the parser end to end. */
function fixtureSource(body) {
  return [
    "import { Component } from '@angular/core';",
    '@Component({',
    "  selector: 'app-fixture',",
    '  template: `',
    body,
    '  `,',
    '})',
    'export class FixtureComponent {}',
  ].join('\n');
}

/**
 * Prove every rule still fires. Throws on the first rule that does not.
 *
 * Both halves are checked, because they fail independently: the classifier (does
 * `$index` inside a larger expression still read as `index`?) and the justification
 * reader (does a `track:` comment above the block still clear it, and does its absence
 * still fail?).
 */
export function selfTest() {
  for (const { track, item, expect } of SELF_TEST_CASES) {
    const source = fixtureSource(`    @for (${item} of items; track ${track}) { <b>x</b> }`);
    const [template] = parseFile('self-test.ts', source);
    const [block] = auditTracks([template]);

    if (block.kind !== expect) {
      throw new Error(
        `assert-for-track self-test: \`track ${track}\` classified as ${block.kind}, expected ${expect}`
      );
    }
    if (block.justified !== !TRACK_KINDS[expect].justify) {
      throw new Error(
        `assert-for-track self-test: \`track ${track}\` should be ${
          TRACK_KINDS[expect].justify ? 'unjustified' : 'justified'
        } with no comment above it`
      );
    }
  }

  const justified = [
    '    <!-- track: the collection holds string literals, so the value is the identity. -->',
    '    @for (option of ranges; track option) { <b>x</b> }',
  ].join('\n');
  const [wrapped] = parseFile('self-test.ts', fixtureSource(justified));
  if (!auditTracks([wrapped])[0].justified) {
    throw new Error('assert-for-track self-test: a `track:` comment above the block did not clear it');
  }

  const spanning = [
    '    <!--',
    '      track: the ranges collection is a readonly tuple of string literals, so the value',
    '      is the identity and there is nothing else to key on.',
    '    -->',
    '    @for (option of ranges; track option) { <b>x</b> }',
  ].join('\n');
  const [multiline] = parseFile('self-test.ts', fixtureSource(spanning));
  if (!auditTracks([multiline])[0].justified) {
    throw new Error('assert-for-track self-test: a multi-line `track:` comment did not clear the block');
  }

  const unrelated = [
    '    <!-- The list is sorted newest first. -->',
    '    @for (option of ranges; track option) { <b>x</b> }',
  ].join('\n');
  const [other] = parseFile('self-test.ts', fixtureSource(unrelated));
  if (auditTracks([other])[0].justified) {
    throw new Error('assert-for-track self-test: a comment without `track:` cleared the block');
  }

  // The line a block is reported on has to be the line in the `.ts` file, or a reviewer
  // follows the annotation into the wrong place. The fixture puts the `@for` on the fifth
  // line of a template that opens on line four.
  const [positioned] = parseFile('self-test.ts', fixtureSource('\n\n\n    @for (r of rs; track r.id) { <b>x</b> }'));
  const reportedLine = auditTracks([positioned])[0].line;
  if (reportedLine !== 8) {
    throw new Error(
      `assert-for-track self-test: block reported on line ${reportedLine}, expected 8 — the ` +
        `template-to-file line mapping has drifted`
    );
  }
}

async function main() {
  selfTest();

  const blocks = auditTracks(await collectTemplates());

  if (blocks.length === 0) {
    console.error('assert-for-track: no @for blocks found — has the layout changed?');
    process.exit(2);
  }

  const table = [
    '| Template | Line | Collection | Track | Keyed by |',
    '| --- | ---: | --- | --- | --- |',
    ...blocks.map(
      (block) =>
        `| \`${block.file}\` | ${block.line} | \`${block.item} of ${block.collection}\` | ` +
        `\`${block.track}\` | ${TRACK_KINDS[block.kind].label}` +
        `${TRACK_KINDS[block.kind].justify ? ' (justified)' : ''} |`
    ),
  ].join('\n');
  writeSummary(`### \`@for\` track expressions\n\n${table}\n`);

  const unjustified = blocks.filter((block) => !block.justified);
  if (unjustified.length > 0) {
    for (const block of unjustified) {
      console.error(
        `::error file=${block.file},line=${block.line}::\`track ${block.track}\` keys this ` +
          `@for by ${TRACK_KINDS[block.kind].label} rather than by a property of ` +
          `\`${block.item}\`. Either track a stable field of the row, or write a ` +
          `\`<!-- track: … -->\` comment above the block saying why this key identifies it.`
      );
    }
    console.error('See docs/track-expressions.md for what each key costs when it is wrong.');
    process.exit(1);
  }

  const byProperty = blocks.filter((block) => block.kind === 'itemProperty').length;
  console.log(
    `assert-for-track: clean (${blocks.length} @for block(s); ${byProperty} keyed by an item ` +
      `property, ${blocks.length - byProperty} justified; ${SELF_TEST_CASES.length + 4} rule ` +
      `self-tests passed)`
  );
}

/** Append to the GitHub Actions job summary when there is one, so the audit lands on the PR. */
function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${markdown}\n`);
}

await main();
