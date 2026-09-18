#!/usr/bin/env node
// Fail when an `<img>` in a component template is not under `NgOptimizedImage`, or is
// under it incorrectly.
//
// ## Why an `<img>` needs a gate at all
//
// `NgOptimizedImage` is a directive you have to remember: it matches on `ngSrc`, so an
// `<img src="…">` simply is not optimised, and nothing anywhere says so. What that costs is
// not theoretical — it is the two loading metrics this repository already measures in the
// field (`docs/web-vitals.md`):
//
//   - **CLS.** An `<img>` with no `width`/`height` has no intrinsic aspect ratio until its
//     bytes arrive, so the browser lays the page out around a zero-height box and reflows
//     everything below it when the image decodes. The directive makes the two attributes
//     mandatory and sets them on the element, which is what lets the browser reserve the
//     space; `fill` is the opt-out, for an image sized entirely by CSS.
//   - **LCP.** The largest image on the page must be requested in the first wave, and
//     every other image must not be. `priority` is what says which: it flips the element to
//     `loading="eager"`, `fetchpriority="high"` and `decoding="sync"`, and — on the server —
//     emits a `<link rel="preload">` into the prerendered `<head>`, so the request starts
//     from the HTML rather than from the parser reaching the tag. Everything without it
//     gets `loading="lazy"`.
//
// Angular checks some of this itself, at runtime, in development, in the component that
// happens to render. That is a weaker guarantee than it sounds: a missing `width` throws
// only from the render that reaches the element, so an `<img>` on a route no spec exercises
// ships. These rules are the same policy asserted against every template, once, in CI.
//
// ## The rules, and what each one is really about
//
//   1. **`ngSrc`, never `src`.** An `<img src>` opts out of everything above, silently.
//   2. **`NgOptimizedImage` in the component's `imports`.** This is the rule with the
//      sharpest teeth, because `ngSrc` is an *attribute*: with the directive missing
//      nothing matches it, Angular emits a literal `ngsrc` on the element, no `src` is
//      ever set, and the image is simply broken — with no compiler error, no lint error
//      and no runtime warning. A bound `[ngSrc]` would at least fail to compile; the
//      static form is the trap.
//   3. **`width` and `height`, or `fill`.** The CLS rule above.
//   4. **`alt`.** Not a performance rule. `alt=""` is accepted and is the correct answer
//      for decoration — what is rejected is not having decided.
//   5. **`priority` is not inside `@for` or `@defer`.** A structural claim rather than an
//      attribute one, and it is where this gate earns the template AST. The LCP element is
//      one specific element painted in the first frame. An image repeated over a
//      collection is not it — `priority` on a row preloads every row, which is the
//      opposite of prioritising — and an image inside a `@defer` block cannot be it, since
//      the block's chunk is fetched after the first paint by definition. Both read as
//      careful optimisation and are strictly worse than doing nothing.
//   6. **At most one `priority` image per template.** There is one largest element. Angular
//      itself warns past ten, which catches wholesale misuse and not the second one.
//
// Usage:  node scripts/ci/assert-image-hygiene.mjs
// See:    docs/images.md

import { appendFileSync } from 'node:fs';
import { collectTemplates, fileLineOf, parseFile, walk } from './lib/templates.mjs';

/** The directive that has to be imported for `ngSrc` to mean anything. */
const DIRECTIVE = 'NgOptimizedImage';

/** Block types an LCP candidate cannot be inside. */
const NOT_FIRST_PAINT = {
  ForLoopBlock: 'a @for block, so it is one of many rows rather than the largest element',
  DeferredBlock: 'a @defer block, whose chunk is fetched after the first paint',
};

/**
 * Describe one `<img>` element: which of the attributes below it carries, statically or
 * bound, and which blocks it sits inside.
 *
 * Static attributes and bound inputs are deliberately not distinguished. `width="96"` and
 * `[width]="size"` both satisfy the directive, and a rule that accepted only the literal
 * form would reject correct code.
 */
function describeImage(template, node, ancestors) {
  const names = new Set([
    ...node.attributes.map((attribute) => attribute.name),
    ...node.inputs.map((input) => input.name),
  ]);

  return {
    file: template.file,
    line: fileLineOf(template, node.startSourceSpan),
    has: (name) => names.has(name),
    enclosing: ancestors
      .map((ancestor) => ancestor.constructor.name)
      .filter((kind) => kind in NOT_FIRST_PAINT),
  };
}

/**
 * Check every `<img>` in every template.
 *
 * @param {import('./lib/templates.mjs').InlineTemplate[]} templates
 * @returns {{ images: object[], failures: { file: string, line: number, message: string }[] }}
 */
export function auditImages(templates) {
  const images = [];
  const failures = [];
  const fail = (image, message) => failures.push({ file: image.file, line: image.line, message });

  for (const template of templates) {
    const priority = [];

    walk(template.nodes, (node, ancestors) => {
      if (node.constructor.name !== 'Element' || node.name !== 'img') return;

      const image = describeImage(template, node, ancestors);
      images.push(image);

      if (image.has('src') || image.has('srcset')) {
        fail(
          image,
          'uses `src`/`srcset`, which opts out of NgOptimizedImage entirely. Use `ngSrc` ' +
            '(and `ngSrcset` where a loader is configured).'
        );
        return;
      }

      if (!image.has('ngSrc')) {
        fail(image, 'has neither `src` nor `ngSrc`. Every <img> needs a source.');
        return;
      }

      if (!template.imports.includes(DIRECTIVE)) {
        fail(
          image,
          `uses \`ngSrc\` but the component does not import ${DIRECTIVE}, so nothing matches ` +
            'the attribute: it is emitted as a literal `ngsrc`, no `src` is set, and the image ' +
            'never loads. Nothing else in the pipeline reports this.'
        );
      }

      if (image.has('fill')) {
        if (image.has('width') || image.has('height')) {
          fail(image, 'sets `fill` together with `width`/`height`; the two are alternatives.');
        }
      } else if (!image.has('width') || !image.has('height')) {
        fail(
          image,
          'is missing `width` and/or `height`. Without both the browser cannot reserve the ' +
            "image's space and the page reflows when it decodes (CLS). Use `fill` for an " +
            'image sized entirely by CSS.'
        );
      }

      if (!image.has('alt')) {
        fail(image, 'has no `alt`. Use `alt=""` if the image is decorative.');
      }

      if (image.has('priority')) {
        priority.push(image);
        for (const kind of image.enclosing) {
          fail(image, `is marked \`priority\` but sits inside ${NOT_FIRST_PAINT[kind]}.`);
        }
      }
    });

    if (priority.length > 1) {
      for (const image of priority.slice(1)) {
        fail(
          image,
          `is the ${priority.length > 2 ? 'nth' : 'second'} \`priority\` image in this ` +
            `template (the first is on line ${priority[0].line}). Only the largest element ` +
            'painted in the first frame should be prioritised; prioritising several ' +
            'prioritises none.'
        );
      }
    }
  }

  return { images, failures };
}

/**
 * A component source carrying one `<img>`, for driving the parser end to end.
 *
 * @param {string} body Template body.
 * @param {string[]} imports Names for the decorator's `imports` array.
 */
function fixtureSource(body, imports = [DIRECTIVE]) {
  return [
    "import { Component } from '@angular/core';",
    '@Component({',
    "  selector: 'app-fixture',",
    `  imports: [${imports.join(', ')}],`,
    '  template: `',
    body,
    '  `,',
    '})',
    'export class FixtureComponent {}',
  ].join('\n');
}

/**
 * Sources written to provoke each rule.
 *
 * `expect` is a fragment of the message the rule must produce, or `null` for a template
 * that must pass. Both directions are covered on purpose: a rule that fires on everything
 * is as useless as one that fires on nothing, and the clean cases are what keep the
 * correct spelling of each pattern — `fill`, a bound width, a decorative `alt` — from
 * being broken by a later tightening.
 *
 * Same reasoning as `assert-for-track.mjs`: nothing under `scripts/` is in Karma's build
 * graph, so the gate proves its own rules on every run rather than being trusted.
 */
const SELF_TEST_CASES = [
  { body: '<img ngSrc="/a.png" width="8" height="8" alt="" />', expect: null },
  { body: '<img ngSrc="/a.png" [width]="w" [height]="h" [alt]="label" />', expect: null },
  { body: '<img ngSrc="/a.png" fill alt="" />', expect: null },
  { body: '<img ngSrc="/a.png" width="8" height="8" alt="" priority />', expect: null },
  { body: '<img src="/a.png" width="8" height="8" alt="" />', expect: 'opts out' },
  { body: '<img ngSrc="/a.png" srcset="/a.png 2x" width="8" height="8" alt="" />', expect: 'opts out' },
  { body: '<img width="8" height="8" alt="" />', expect: 'needs a source' },
  {
    body: '<img ngSrc="/a.png" width="8" height="8" alt="" />',
    imports: [],
    expect: 'does not import',
  },
  { body: '<img ngSrc="/a.png" height="8" alt="" />', expect: 'missing `width`' },
  { body: '<img ngSrc="/a.png" width="8" alt="" />', expect: 'missing `width`' },
  { body: '<img ngSrc="/a.png" fill width="8" alt="" />', expect: 'are alternatives' },
  { body: '<img ngSrc="/a.png" width="8" height="8" />', expect: 'no `alt`' },
  {
    body: '@for (r of rs; track r.id) { <img ngSrc="/a.png" width="8" height="8" alt="" priority /> }',
    expect: 'inside a @for',
  },
  {
    body: '@defer { <img ngSrc="/a.png" width="8" height="8" alt="" priority /> }',
    expect: 'inside a @defer',
  },
  // A placeholder view is eager, but it is still not the first-paint image: the block it
  // belongs to replaces it. This also proves `walk` descends into block branches at all,
  // without which every rule here would silently skip them.
  {
    body: '@defer { <b>x</b> } @placeholder { <img ngSrc="/a.png" width="8" height="8" alt="" priority /> }',
    expect: 'inside a @defer',
  },
  {
    body: [
      '<img ngSrc="/a.png" width="8" height="8" alt="" priority />',
      '<img ngSrc="/b.png" width="8" height="8" alt="" priority />',
    ].join('\n'),
    expect: 'image in this template',
  },
];

/** Prove every rule still fires, and that the clean spellings still pass. */
export function selfTest() {
  for (const { body, imports, expect } of SELF_TEST_CASES) {
    const templates = parseFile('self-test.ts', fixtureSource(`    ${body}`, imports));
    const { failures } = auditImages(templates);

    if (expect === null) {
      if (failures.length > 0) {
        throw new Error(
          `assert-image-hygiene self-test: \`${body}\` should pass but failed — ${failures[0].message}`
        );
      }
      continue;
    }

    if (!failures.some((failure) => failure.message.includes(expect))) {
      throw new Error(
        `assert-image-hygiene self-test: \`${body}\` should have failed with a message ` +
          `containing "${expect}", got ${failures.length === 0 ? 'no failures' : `"${failures[0].message}"`}`
      );
    }
  }
}

async function main() {
  selfTest();

  const templates = await collectTemplates();
  const { images, failures } = auditImages(templates);

  const table =
    images.length === 0
      ? '_No `<img>` elements in any component template._'
      : [
          '| Template | Line | Loading | Sizing |',
          '| --- | ---: | --- | --- |',
          ...images.map(
            (image) =>
              `| \`${image.file}\` | ${image.line} | ` +
              `${image.has('priority') ? 'eager (priority)' : 'lazy'} | ` +
              `${image.has('fill') ? 'fill' : 'intrinsic'} |`
          ),
        ].join('\n');
  writeSummary(`### Images under NgOptimizedImage\n\n${table}\n`);

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`::error file=${failure.file},line=${failure.line}::<img> ${failure.message}`);
    }
    console.error('See docs/images.md for what each of these costs.');
    process.exit(1);
  }

  const prioritised = images.filter((image) => image.has('priority')).length;
  console.log(
    `assert-image-hygiene: clean (${images.length} <img> element(s) across ` +
      `${templates.length} template(s); ${prioritised} prioritised; ` +
      `${SELF_TEST_CASES.length} rule self-tests passed)`
  );
}

/** Append to the GitHub Actions job summary when there is one, so the audit lands on the PR. */
function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${markdown}\n`);
}

await main();
