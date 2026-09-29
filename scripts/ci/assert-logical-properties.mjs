#!/usr/bin/env node
// Fail when a component template positions something with a left/right utility instead of
// a start/end one.
//
// ## Why `dir="rtl"` is not the fix, and this is
//
// The localised build sets `dir="rtl"` on `<html>` for Arabic — Angular does it, from the
// locale, with nothing in this application involved. What that attribute changes is the
// *inline* axis: text runs right to left, `margin-inline-start` resolves to the right
// edge, `flex-direction: row` lays children out right to left, `start-0` pins to the
// right. What it does not change is anything written in physical terms. `ml-4` is
// `margin-left` in both directions; `left-0` is the left edge in both; `border-r` is the
// right border in both.
//
// So an interface built on physical utilities does not break loudly under `dir="rtl"` —
// it reflows into a version of itself that is subtly and consistently wrong: the sidebar
// stays on the left with its border on the outside, the gap between an icon and its label
// opens on the wrong side, and the drawer that should slide off the right edge slides
// across the page instead. Every one of those still renders, still passes its unit spec
// (which asserts behaviour, not geometry), and still passes the axe audit (which reports
// on the accessibility tree, where "left" is not a concept). The one thing that catches
// them is not writing them.
//
// ## What is flagged, and what is not
//
// The utilities below all have a logical counterpart in Tailwind 4, and the suggestion is
// part of the failure. What is deliberately *not* flagged:
//
//   - `translate-x`, `rotate` and the rest of the transform utilities, which have no
//     logical form at all: a transform is geometry and does not read `dir`. Those are
//     handled by pairing them with Tailwind's `rtl:` variant, which is why the variant is
//     accepted here rather than banned — see `SIDEBAR_CLOSED` in `layout-shell.component.ts`.
//   - `mt`/`mb`/`pt`/`pb`/`top`/`bottom` and the block axis generally, which `dir` does
//     not touch.
//   - `text-center`, `justify-center`, `items-*` — symmetric, or already logical.
//
// Usage:  node scripts/ci/assert-logical-properties.mjs
// See:    docs/i18n.md

import { appendFileSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { collectTemplates, fileLineOf, parseFile, repoRoot, walk } from './lib/templates.mjs';

/**
 * Physical utility prefixes, and the logical utility that replaces each.
 *
 * Keyed by the part before the value, so `ml-4`, `ml-auto` and `ml-[3px]` are one entry.
 */
const PHYSICAL_UTILITIES = new Map([
  ['ml', 'ms'],
  ['mr', 'me'],
  ['pl', 'ps'],
  ['pr', 'pe'],
  ['left', 'start'],
  ['right', 'end'],
  ['border-l', 'border-s'],
  ['border-r', 'border-e'],
  ['rounded-l', 'rounded-s'],
  ['rounded-r', 'rounded-e'],
  ['rounded-tl', 'rounded-ss'],
  ['rounded-tr', 'rounded-se'],
  ['rounded-br', 'rounded-ee'],
  ['rounded-bl', 'rounded-es'],
  ['scroll-ml', 'scroll-ms'],
  ['scroll-mr', 'scroll-me'],
  ['scroll-pl', 'scroll-ps'],
  ['scroll-pr', 'scroll-pe'],
  ['text-left', 'text-start'],
  ['text-right', 'text-end'],
  ['float-left', 'float-start'],
  ['float-right', 'float-end'],
  ['clear-left', 'clear-start'],
  ['clear-right', 'clear-end'],
]);

/**
 * The prefixes above whose whole name is the utility, with no value after it.
 *
 * `text-left` is the utility; `ml` is a prefix and needs `-4` after it. Keeping the two
 * apart is what stops `text-left` being reported as `text` + `left`, and stops a class
 * called `mlkit-badge` matching `ml`.
 */
const VALUELESS = new Set([
  'text-left',
  'text-right',
  'float-left',
  'float-right',
  'clear-left',
  'clear-right',
]);

/**
 * Class names that look physical and are not, with the reason.
 *
 * `inset-x` is both edges at once, so it is symmetric under a direction flip; the variants
 * `rtl:` and `ltr:` are the documented escape hatch for the transform case and are stripped
 * before matching rather than flagged.
 */
const NOT_DIRECTIONAL = new Set(['inset-x', 'inset-y']);

/** How one finding reads, with or without the value part a utility takes. */
function describeUtility(physical, logical) {
  return VALUELESS.has(physical)
    ? `class "${physical}" is a physical direction and does not follow dir="rtl" — use "${logical}"`
    : `class "${physical}-…" is a physical direction and does not follow dir="rtl" — use "${logical}-…"`;
}

/** One class name, with its variants (`md:`, `hover:`, `rtl:`) taken off. */
function baseOf(className) {
  const parts = className.split(':');
  return parts[parts.length - 1].replace(/^-/, '');
}

/**
 * The logical replacement for a class name, or `null` when it is already fine.
 *
 * @param {string} className A single class token, variants included.
 * @returns {{ physical: string, logical: string } | null}
 */
export function logicalReplacementFor(className) {
  const base = baseOf(className);
  if (NOT_DIRECTIONAL.has(base)) return null;

  if (VALUELESS.has(base)) {
    return { physical: base, logical: PHYSICAL_UTILITIES.get(base) };
  }

  const separator = base.lastIndexOf('-');
  if (separator <= 0) return null;
  const prefix = base.slice(0, separator);
  if (VALUELESS.has(prefix) || !PHYSICAL_UTILITIES.has(prefix)) return null;

  return { physical: prefix, logical: PHYSICAL_UTILITIES.get(prefix) };
}

/**
 * Audit a whitespace-separated class list.
 *
 * Exported for {@link selfTest}, and used for both template `class` attributes and the
 * class-name constants that components build their `[class]` bindings from — the latter
 * being where this repository keeps its longest lists, and where a template-only gate
 * would have seen nothing at all.
 *
 * @param {string} classList
 * @returns {{ physical: string, logical: string }[]}
 */
export function auditClassList(classList) {
  const found = [];
  for (const token of classList.split(/\s+/)) {
    if (token === '') continue;
    const replacement = logicalReplacementFor(token);
    if (replacement !== null) found.push(replacement);
  }
  return found;
}

/**
 * Every `class="…"` in every component template.
 *
 * Bound `[class]` expressions are not read here: their value is a TypeScript expression
 * rather than a string, and in this repository it is always a constant declared in the
 * same file, which {@link auditSourceStrings} covers by reading the file's string literals.
 */
function auditTemplates(templates) {
  const failures = [];

  for (const template of templates) {
    walk(template.nodes, (node) => {
      const kind = node.constructor.name;
      if (kind !== 'Element' && kind !== 'Template') return;

      for (const attribute of node.attributes ?? []) {
        if (attribute.name !== 'class') continue;
        for (const { physical, logical } of auditClassList(attribute.value ?? '')) {
          failures.push({
            file: template.file,
            line: fileLineOf(template, node.sourceSpan),
            message:
              `${describeUtility(physical, logical)}.`,
          });
        }
      }
    });
  }

  return failures;
}

/**
 * Every string literal in a `.ts` file that ships, scanned as a class list.
 *
 * Deliberately crude — it does not know which strings are class lists — and safe because
 * of what it matches: a token has to be a whole physical utility with a value to be
 * reported, so prose and identifiers do not hit it. That crudeness is the point. The
 * longest class lists in this repository are not in templates at all; they are
 * `const SIDEBAR_BASE = 'fixed inset-y-0 start-0 …'` in a component file, and a gate that
 * read only templates would have passed the drawer that this rule exists for.
 */
function auditSourceStrings(file, source) {
  const failures = [];
  const literal = /'([^'\n]*)'|"([^"\n]*)"/g;
  let match;

  while ((match = literal.exec(source)) !== null) {
    const value = match[1] ?? match[2] ?? '';
    const found = auditClassList(value);
    if (found.length === 0) continue;

    const line = source.slice(0, match.index).split('\n').length;
    for (const { physical, logical } of found) {
      failures.push({
        file,
        line,
        message:
          `${describeUtility(physical, logical)}.`,
      });
    }
  }

  return failures;
}

/** Each rule, against an input written to provoke it. */
const SELF_TESTS = [
  { classList: 'ml-2', expect: 'ms' },
  { classList: 'mr-auto', expect: 'me' },
  { classList: 'pl-2 pr-0.5', expect: 'ps' },
  { classList: 'left-0', expect: 'start' },
  { classList: 'md:right-4', expect: 'end' },
  { classList: 'border-r', expect: null },
  { classList: 'border-r-2', expect: 'border-e' },
  { classList: 'text-left', expect: 'text-start' },
  { classList: 'text-right', expect: 'text-end' },
  { classList: 'focus:left-4', expect: 'start' },
  { classList: 'rounded-l-lg', expect: 'rounded-s' },
  // Already logical, symmetric, or on the block axis.
  { classList: 'ms-2 me-2 ps-2 pe-2 start-0 end-4', expect: null },
  { classList: 'mt-4 mb-4 pt-2 pb-2 top-0 bottom-0', expect: null },
  { classList: 'inset-x-0 inset-y-0', expect: null },
  { classList: 'text-center justify-between items-start', expect: null },
  { classList: 'flex-1 w-64 z-40', expect: null },
  // Transforms have no logical form; the `rtl:` variant is how they are handled.
  { classList: '-translate-x-full rtl:translate-x-full', expect: null },
  // Words that merely start like a utility.
  { classList: 'leftovers', expect: null },
  { classList: 'text-left-ish', expect: null },
];

function selfTest() {
  for (const { classList, expect } of SELF_TESTS) {
    const found = auditClassList(classList);
    if (expect === null) {
      if (found.length > 0) {
        throw new Error(
          `assert-logical-properties self-test: "${classList}" should pass but was reported ` +
            `as "${found[0].physical}".`
        );
      }
      continue;
    }
    if (!found.some((entry) => entry.logical.startsWith(expect) || entry.physical === expect)) {
      throw new Error(
        `assert-logical-properties self-test: "${classList}" should have been reported with ` +
          `"${expect}", got ${found.length === 0 ? 'nothing' : JSON.stringify(found)}.`
      );
    }
  }

  // The template reader, once, end to end: a physical class in real template syntax.
  const source = `@Component({ template: \`<div class="ml-2"></div>\` }) export class C {}`;
  if (auditTemplates(parseFile('self-test.ts', source)).length !== 1) {
    throw new Error('assert-logical-properties self-test: a template `class="ml-2"` went unreported.');
  }
}

/** Every `.ts` and `.css` file under `src/` that ships. Specs are excluded. */
async function shippedFiles() {
  const walkDir = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walkDir(path);
        const shipped = path.endsWith('.ts') && !path.endsWith('.spec.ts');
        return entry.isFile() && shipped ? [path] : [];
      })
    );
    return files.flat();
  };

  return (await walkDir(join(repoRoot, 'src'))).sort();
}

async function main() {
  selfTest();

  const templates = await collectTemplates();
  const failures = auditTemplates(templates);

  let scanned = 0;
  for (const absolute of await shippedFiles()) {
    scanned += 1;
    failures.push(...auditSourceStrings(relative(repoRoot, absolute), readFileSync(absolute, 'utf8')));
  }

  // Deduplicate: a class list that appears in both a template and a constant is one fault.
  const unique = new Map(
    failures.map((failure) => [`${failure.file}:${failure.line}:${failure.message}`, failure])
  );

  writeSummary(
    `### Logical properties\n\n` +
      `${templates.length} template(s) and ${scanned} source file(s) scanned; ` +
      `${unique.size} physical direction utility(ies) found.\n`
  );

  if (unique.size > 0) {
    for (const failure of unique.values()) {
      console.error(`::error file=${failure.file},line=${failure.line}::RTL — ${failure.message}`);
    }
    console.error('See docs/i18n.md for why dir="rtl" does not fix these on its own.');
    process.exit(1);
  }

  console.log(
    `assert-logical-properties: clean (${templates.length} template(s), ${scanned} source ` +
      `file(s), ${SELF_TESTS.length} rule self-tests passed)`
  );
}

/** Append to the GitHub Actions job summary when there is one, so the audit lands on the PR. */
function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${markdown}\n`);
}

await main();
