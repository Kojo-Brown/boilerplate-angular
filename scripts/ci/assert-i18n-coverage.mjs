#!/usr/bin/env node
// Fail when a string a user can read is not translatable, or is translatable under an id
// that will not survive an edit.
//
// ## Why this needs a gate
//
// Nothing in the Angular toolchain notices an untranslated string. `ng extract-i18n`
// collects what is marked and is silent about what is not, so an unmarked heading does not
// shrink the message catalogue — it never enters it. The build is green, every unit spec
// passes (they run against the source locale, where an untranslated string is *correct*),
// and the only place the omission exists is the Arabic page, where one paragraph is in
// English. That is the failure this file exists to make loud, and it is the same shape as
// the ones `assert-for-track.mjs` and `assert-image-hygiene.mjs` catch: a correct-looking
// template whose defect has no diagnostic anywhere.
//
// ## The rules
//
//   1. **Every text node that contains prose is inside an `i18n` region.** "Prose" is two
//      consecutive letters in what is left after the interpolations are removed, which is
//      what separates `Welcome back` from `{{ user.name }}`, `·`, `&larr;` and `24h`.
//   2. **Every translatable attribute carries `i18n-<attr>`.** The list is closed
//      ({@link TRANSLATABLE_ATTRIBUTES}) because it has to be: `class`, `data-testid`,
//      `routerLink` and `formControlName` are all strings full of letters and none of them
//      is language. The ones here are either read out by a screen reader or painted into
//      the field.
//   3. **Every message has an explicit `@@id`.** Without one Angular hashes the source
//      text into an id, so correcting a typo in English silently orphans every translation
//      of that message — and with `i18nMissingTranslation: "error"` set in `angular.json`,
//      orphaning one fails the build in a message that names a hash rather than the string
//      that moved. An explicit id survives a rewording, which is the point: the English
//      changed, the message did not.
//   4. **A `$localize` metadata block reaches its `@@id`.** `$localize` delimits metadata
//      with colons — `` $localize`:meaning|description@@id:text` `` — so a colon *inside*
//      the description ends the block early and the rest of it becomes part of the
//      message. This was live in this repository for the length of one commit:
//      `` $localize`:Activity table column: who performed the action@@activity.col.actor:Actor` ``
//      rendered as `who performed the action@@activity.col.actor:Actor` in the table
//      header, and only in development — a localised build replaces the message by id, so
//      the one place it was visible is the one build no gate looked at. Rule 3 catches it,
//      because the truncated metadata no longer contains `@@`.
//
//   5. **Every translation file agrees with the catalogue it was made from.** Three
//      separate ways it can stop agreeing, and only one of them is something Angular
//      notices:
//        - a message with no entry, which `i18nMissingTranslation: "error"` does fail the
//          build on, so it is checked here only to fail earlier and with a better message;
//        - an entry whose `<target>` is empty, which the build accepts and ships as an
//          empty string — a blank heading rather than an English one;
//        - and the one this rule exists for: an entry whose `<source>` no longer matches
//          the catalogue's. Rule 3 makes ids explicit precisely so a reworded English
//          string keeps its translations, which means a reworded English string *silently
//          keeps its old translations*. The id still matches, nothing is missing, and the
//          Arabic build ships a sentence that answers the previous question. Comparing the
//          two `<source>` strings is the only thing that sees it.
//   6. **Every ICU `plural` target declares the categories its locale actually uses.** An
//      Arabic translation carrying only `=1` and `other` compiles, and quietly applies the
//      `other` wording to 0, 2, and 3–10, each of which takes a different form. The
//      category list comes from `Intl.PluralRules`, so it is CLDR's answer rather than
//      this file's.
//
// Rules 1–3 read the template AST through `@angular/compiler`, so `i18n` attributes are
// resolved the way the compiler resolves them rather than matched as text. Rule 4 reads
// the TypeScript AST, because `$localize` is not template syntax. Rules 5 and 6 read the
// XLIFF files named in `angular.json`.
//
// Usage:  node scripts/ci/assert-i18n-coverage.mjs
// See:    docs/i18n.md

import { appendFileSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { collectTemplates, fileLineOf, parseFile, repoRoot, walk } from './lib/templates.mjs';

/**
 * Attributes whose value is shown to, or read out to, a person.
 *
 * Closed rather than heuristic. The alternative — "any attribute whose value looks like
 * words" — flags `class`, `routerLink`, `formControlName`, `data-testid` and `type`, and a
 * gate that has to be suppressed on most of its hits stops being read.
 *
 * `aria-labelledby` and `aria-describedby` are deliberately absent: their values are *ids*,
 * and the text they point at is a node this gate already covers under rule 1.
 */
const TRANSLATABLE_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'placeholder',
  'title',
  // Component inputs written as static attributes. These are this application's own, and
  // the list grows when a component takes a new one: a required `label` that nobody marked
  // is the same defect as an unmarked `aria-label`, and it is not visible in the component
  // that declares the input.
  'brandName',
  'emptyMessage',
  'hint',
  'label',
]);

/**
 * Text that is exempt from rule 1, and why.
 *
 * Empty, and meant to stay small. An entry here is a claim that a string is the same in
 * every language — a product name, a currency code, a unit symbol — and the reason is
 * required so that the claim is reviewed rather than inherited.
 *
 * Note what does *not* need an entry: anything without two consecutive letters. Arrows,
 * bullets, `·`, `%` and bare numbers are already out of scope.
 *
 * @type {{ text: string, reason: string }[]}
 */
const EXEMPT_TEXT = [];

/** Where `ng extract-i18n` writes the catalogue, and `pnpm i18n:extract` regenerates it. */
const CATALOGUE = 'src/locale/messages.xlf';

/**
 * The `<trans-unit>` elements of an XLIFF 1.2 file, keyed by id.
 *
 * A regular expression rather than an XML parser, deliberately: the only structure needed
 * is "id, source, target", the files are machine-written by one tool, and adding a
 * dependency to a gate is a cost paid on every install for the life of the repository.
 * A malformed file fails the build long before this runs.
 */
function readXliff(path) {
  const text = readFileSync(path, 'utf8');
  const units = new Map();

  for (const unit of text.match(/<trans-unit id="[^"]+"[\s\S]*?<\/trans-unit>/g) ?? []) {
    const id = /id="([^"]+)"/.exec(unit)[1];
    units.set(id, {
      source: /<source>([\s\S]*?)<\/source>/.exec(unit)?.[1] ?? null,
      target: /<target>([\s\S]*?)<\/target>/.exec(unit)?.[1] ?? null,
    });
  }

  return units;
}

/** The locales `angular.json` configures, and the file each one's translations live in. */
function configuredLocales() {
  const config = JSON.parse(readFileSync(join(repoRoot, 'angular.json'), 'utf8'));
  const i18n = Object.values(config.projects)[0]?.i18n ?? {};
  return Object.entries(i18n.locales ?? {}).map(([code, value]) => ({
    code,
    file: typeof value === 'string' ? value : value.translation,
  }));
}

/**
 * Rules 5 and 6, per locale.
 *
 * @returns {{ file: string, line: number, message: string }[]}
 */
export function auditTranslations(catalogue, locale, translations) {
  const failures = [];
  const fail = (message) => failures.push({ file: locale.file, line: 1, message });
  const categories = new Set(
    new Intl.PluralRules(locale.code, { type: 'cardinal' }).resolvedOptions().pluralCategories
  );

  for (const [id, entry] of catalogue) {
    const translated = translations.get(id);

    if (translated === undefined) {
      fail(`${locale.code} has no entry for "${id}". Run \`pnpm i18n:extract\` and translate it.`);
      continue;
    }
    if (translated.target === null || translated.target.trim() === '') {
      fail(
        `${locale.code}'s entry for "${id}" has an empty <target>, which ships as an empty ` +
          `string rather than as the English source. Angular accepts it; a reader does not.`
      );
      continue;
    }
    if (normalise(translated.source) !== normalise(entry.source)) {
      fail(
        `${locale.code}'s entry for "${id}" was translated from a different English string.\n` +
          `  catalogue:   ${summarise(entry.source ?? '')}\n` +
          `  translation: ${summarise(translated.source ?? '')}\n` +
          `  The id is explicit, so nothing else notices: the build matches on the id, finds ` +
          `a translation, and ships the answer to the older question.`
      );
      continue;
    }

    // Rule 6, for the units that are an ICU rather than a sentence.
    if (!/^\s*\{\s*VAR_PLURAL\s*,\s*plural\s*,/.test(entry.source ?? '')) continue;
    const declared = pluralCategoriesIn(translated.target);
    for (const category of categories) {
      if (declared.has(category)) continue;
      fail(
        `${locale.code}'s plural for "${id}" declares no "${category}" case, so ${locale.code} ` +
          `falls back to "other" for it. Intl.PluralRules says ${locale.code} selects ` +
          `${[...categories].join(', ')}.`
      );
    }
  }

  for (const id of translations.keys()) {
    if (catalogue.has(id)) continue;
    fail(
      `${locale.code} carries an entry for "${id}", which is not in ${CATALOGUE} any more. ` +
        `Either the message was deleted and this is dead weight, or the catalogue is stale ` +
        `— \`pnpm i18n:extract\` says which.`
    );
  }

  return failures;
}

/**
 * The plural categories an ICU target names.
 *
 * Both spellings count. `=2` is an *exact* match and takes precedence over the `two`
 * category, so a translation using it has covered `two` — writing `=2` where CLDR says
 * `two` is how a translator pins a wording to the number rather than to the rule, and
 * rejecting it would be rejecting the more specific answer.
 */
function pluralCategoriesIn(target) {
  const named = new Set(target.match(/\b(zero|one|two|few|many|other)\s*\{/g)?.map((m) => m.trim().slice(0, -1).trim()) ?? []);
  const exact = [...target.matchAll(/=(\d+)\s*\{/g)].map((match) => Number(match[1]));

  for (const value of exact) {
    if (value === 0) named.add('zero');
    if (value === 1) named.add('one');
    if (value === 2) named.add('two');
  }

  return named;
}

/** Whitespace-insensitive, because the extractor's own indentation is not content. */
function normalise(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Two consecutive letters, once the interpolations are taken out. */
function containsProse(text) {
  return /[A-Za-z]{2}/.test(text.replace(/\{\{[^}]*\}\}/g, ' '));
}

/**
 * Audit every template.
 *
 * Exported so {@link selfTest} can drive it with a source string rather than a fixture on
 * disk — the same reasoning `assert-image-hygiene.mjs` gives: fixtures for these rules are
 * deliberately broken components, and a directory of them would have to be excluded from
 * the compiler, the linter and every other gate.
 *
 * @param {import('./lib/templates.mjs').InlineTemplate[]} templates
 * @returns {{ messages: object[], failures: { file: string, line: number, message: string }[] }}
 */
export function auditTemplates(templates) {
  const messages = [];
  const failures = [];
  const fail = (file, line, message) => failures.push({ file, line, message });

  for (const template of templates) {
    walk(template.nodes, (node, ancestors) => {
      const kind = node.constructor.name;
      const line = () => fileLineOf(template, node.sourceSpan);

      if (kind === 'Text' || kind === 'BoundText') {
        // `node.value` is the *cooked* text for a `Text` node, so `&larr;` has already
        // become `←` and is correctly seen as having no letters. A `BoundText` has no
        // single value, so its source span is read instead and the interpolations are
        // stripped by `containsProse`.
        const text = kind === 'Text' ? node.value : sourceTextOf(template, node);
        if (!containsProse(text)) return;
        if (EXEMPT_TEXT.some((entry) => entry.text === text.trim())) return;
        if (ancestors.some((ancestor) => ancestor.i18n !== undefined)) return;

        fail(
          template.file,
          line(),
          `text "${summarise(text)}" is not inside an i18n region. Mark the element it is ` +
            `in with i18n="…@@some.stable.id", or wrap it in <ng-container i18n="…">.`
        );
        return;
      }

      if (kind !== 'Element' && kind !== 'Template') return;

      for (const attribute of node.attributes ?? []) {
        if (!TRANSLATABLE_ATTRIBUTES.has(attribute.name)) continue;
        if (!containsProse(attribute.value ?? '')) continue;

        if (attribute.i18n === undefined) {
          fail(
            template.file,
            line(),
            `${attribute.name}="${summarise(attribute.value)}" is shown to a user and is ` +
              `not translatable. Add i18n-${attribute.name}="…@@some.stable.id".`
          );
          continue;
        }
        messages.push(describe(template, line(), `@${attribute.name}`, attribute.i18n));
      }

      // An element *inside* an i18n region carries a sub-message of the enclosing one —
      // `<a>` inside a translated sentence, say. It is part of its parent's unit, not a
      // message a translation file keys on, so rule 3 does not apply to it and it is not
      // counted twice in the summary.
      const nested = ancestors.some((ancestor) => ancestor.i18n !== undefined);
      if (node.i18n !== undefined && !nested) {
        messages.push(describe(template, line(), 'text', node.i18n));
      }
    });
  }

  for (const message of messages) {
    if (message.customId !== '') continue;
    failures.push({
      file: message.file,
      line: message.line,
      message:
        `the i18n message on ${message.slot} has no explicit @@id, so Angular will hash its ` +
        `English text into one and every translation of it will be orphaned the next time ` +
        `that text is edited.`,
    });
  }

  return { messages, failures };
}

/** One row for the job summary, and the `customId` rule 3 checks. */
function describe(template, line, slot, i18n) {
  return {
    file: template.file,
    line,
    slot,
    customId: i18n.customId ?? '',
    text: summarise(i18n.messageString ?? ''),
  };
}

/** A node's text exactly as it appears in the file. */
function sourceTextOf(template, node) {
  return template.text.slice(node.sourceSpan.start.offset, node.sourceSpan.end.offset);
}

/** One line of a string, short enough for an error message. */
function summarise(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

/**
 * Rule 4, against the TypeScript AST.
 *
 * `$localize` is a tagged template, so the metadata is the leading text of its *first*
 * span — `head` for a template with substitutions, the whole literal without them. Reading
 * it from the AST rather than with a regular expression is what makes a `:` inside an
 * interpolated expression, or a nested template literal, a non-question.
 *
 * @param {string} file Repository-relative path, for messages.
 * @param {string} source
 * @returns {{ found: number, failures: { file: string, line: number, message: string }[] }}
 */
export function auditLocalizeCalls(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const failures = [];
  let found = 0;

  const visit = (node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === '$localize'
    ) {
      found += 1;
      const literal = node.template;
      const head = rawHeadOf(sourceFile, literal);
      const { line } = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
      const metadata = readMetadata(head);

      if (metadata === null) {
        failures.push({
          file,
          line: line + 1,
          message:
            `$localize message "${summarise(head)}" has no metadata block, so it has no ` +
            `explicit id. Write it as $localize\`:description@@some.stable.id:text\`.`,
        });
      } else if (!metadata.includes('@@')) {
        failures.push({
          file,
          line: line + 1,
          message:
            `$localize metadata ":${summarise(metadata)}:" contains no @@id. A ":" inside a ` +
            `description ends the metadata block early — escape it as "\\:" or reword — and ` +
            `a message with no @@id is keyed by a hash of its English text.`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { found, failures };
}

/**
 * The *raw* text of a tagged template's first span, backticks and `${` removed.
 *
 * Raw and not cooked, which is the difference between this gate agreeing with `$localize`
 * and quietly disagreeing with it. `\\:` is not a JavaScript escape sequence, so the
 * TypeScript parser cooks it to a bare `:` — and a gate reading the cooked text would see
 * an escaped colon as a terminator and reject the one spelling Angular documents.
 * `@angular/localize` reads `TemplateStringsArray.raw` for exactly this reason.
 */
function rawHeadOf(sourceFile, literal) {
  const source = literal.getText(sourceFile);
  return ts.isNoSubstitutionTemplateLiteral(literal)
    ? source.slice(1, -1) // `…`
    : source.slice(1, -2); // `…${
}

/**
 * The metadata block of a `$localize` message, or `null` when it has none.
 *
 * The rule is `$localize`'s own: the block runs from a leading `:` to the first
 * unescaped `:`. A message whose *text* starts with a colon escapes it, which is why the
 * escape is honoured here rather than being treated as an end.
 */
function readMetadata(head) {
  if (!head.startsWith(':')) return null;
  for (let index = 1; index < head.length; index += 1) {
    if (head[index] === '\\') {
      index += 1;
      continue;
    }
    if (head[index] === ':') return head.slice(1, index);
  }
  return null;
}

/**
 * Each rule, against a template written to provoke it.
 *
 * A gate that has stopped checking anything passes exactly like one that works, so every
 * rule above is proved against an input that must fail it and — where the distinction is
 * the interesting part — against the neighbouring input that must not.
 */
const TEMPLATE_SELF_TESTS = [
  { body: '<h1>Welcome back</h1>', expect: 'not inside an i18n region' },
  { body: '<h1 i18n="@@x">Welcome back</h1>', expect: null },
  { body: '<h1 i18n="@@x"><span>Welcome back</span></h1>', expect: null },
  { body: '<h1 i18n>Welcome back</h1>', expect: 'no explicit @@id' },
  { body: '<p>{{ user.name }}</p>', expect: null },
  { body: '<p>·</p>', expect: null },
  { body: '<p>&larr;</p>', expect: null },
  { body: '<p>24</p>', expect: null },
  { body: '<button aria-label="Close dialog"></button>', expect: 'not translatable' },
  { body: '<button i18n-aria-label="@@x" aria-label="Close dialog"></button>', expect: null },
  { body: '<button i18n-aria-label aria-label="Close dialog"></button>', expect: 'no explicit @@id' },
  { body: '<div class="flex items-center"></div>', expect: null },
  { body: '<a routerLink="/dashboard/posts"></a>', expect: null },
  { body: '<app-panel label="publishing activity" />', expect: 'not translatable' },
  { body: '<p i18n="@@x">{count, plural, =1 {1 post} other {{{ count }} posts}}</p>', expect: null },
];

/** Rules 5 and 6, against a catalogue and a translation written to provoke each. */
const TRANSLATION_SELF_TESTS = [
  { catalogue: { a: 'Actor' }, translation: { a: { source: 'Actor', target: 'المنفِّذ' } }, expect: null },
  { catalogue: { a: 'Actor' }, translation: {}, expect: 'has no entry' },
  { catalogue: { a: 'Actor' }, translation: { a: { source: 'Actor', target: '' } }, expect: 'empty <target>' },
  {
    catalogue: { a: 'Actor' },
    translation: { a: { source: 'Who acted', target: 'المنفِّذ' } },
    expect: 'translated from a different English string',
  },
  {
    catalogue: { a: 'Actor' },
    translation: { a: { source: 'Actor', target: 'المنفِّذ' }, b: { source: 'Gone', target: 'ذهب' } },
    expect: 'not in src/locale/messages.xlf any more',
  },
  {
    catalogue: { p: '{VAR_PLURAL, plural, =1 {1 post} other {posts}}' },
    translation: { p: { source: '{VAR_PLURAL, plural, =1 {1 post} other {posts}}', target: '{VAR_PLURAL, plural, =1 {منشور} other {منشورات}}' } },
    expect: 'declares no "zero" case',
  },
  {
    catalogue: { p: '{VAR_PLURAL, plural, =1 {1 post} other {posts}}' },
    translation: {
      p: {
        source: '{VAR_PLURAL, plural, =1 {1 post} other {posts}}',
        target: '{VAR_PLURAL, plural, =0 {أ} =1 {ب} =2 {ج} few {د} many {هـ} other {و}}',
      },
    },
    expect: null,
  },
];

const LOCALIZE_SELF_TESTS = [
  { body: 'const a = $localize`:A column@@col.a:Actor`;', expect: null },
  { body: 'const a = $localize`:A column@@col.a:Up ${pct}:percent:`;', expect: null },
  { body: 'const a = $localize`Actor`;', expect: 'no metadata block' },
  { body: 'const a = $localize`:A column: who acted@@col.a:Actor`;', expect: 'contains no @@id' },
  { body: 'const a = $localize`:A column\\: who acted@@col.a:Actor`;', expect: null },
  { body: 'const a = $localize`:@@col.a:Actor`;', expect: null },
  { body: 'const a = `:not localized at all:`;', expect: null },
];

function selfTest() {
  for (const { body, expect } of TEMPLATE_SELF_TESTS) {
    const source = `@Component({ template: \`${body}\` }) export class C {}`;
    const { failures } = auditTemplates(parseFile('self-test.ts', source));
    assertOutcome('assert-i18n-coverage', body, expect, failures);
  }

  for (const { body, expect } of LOCALIZE_SELF_TESTS) {
    const { failures } = auditLocalizeCalls('self-test.ts', body);
    assertOutcome('assert-i18n-coverage', body, expect, failures);
  }

  // Arabic, because it is the locale in this repository and the one with six categories:
  // a rule-6 self-test against a two-category locale would pass whatever the rule did.
  const locale = { code: 'ar', file: 'self-test.ar.xlf' };
  for (const { catalogue, translation, expect } of TRANSLATION_SELF_TESTS) {
    const failures = auditTranslations(
      new Map(Object.entries(catalogue).map(([id, source]) => [id, { source, target: null }])),
      locale,
      new Map(Object.entries(translation))
    );
    assertOutcome('assert-i18n-coverage', JSON.stringify(translation), expect, failures);
  }
}

/** Shared assertion for both self-test tables. */
function assertOutcome(gate, body, expect, failures) {
  if (expect === null) {
    if (failures.length > 0) {
      throw new Error(
        `${gate} self-test: \`${body}\` should pass but failed — ${failures[0].message}`
      );
    }
    return;
  }

  if (!failures.some((failure) => failure.message.includes(expect))) {
    throw new Error(
      `${gate} self-test: \`${body}\` should have failed with a message containing ` +
        `"${expect}", got ${failures.length === 0 ? 'no failures' : `"${failures[0].message}"`}`
    );
  }
}

/** Every `.ts` file that ships, specs excluded — the same tree the template gates read. */
async function shippedSourceFiles() {
  const walkDir = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walkDir(path);
        return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
      })
    );
    return files.flat();
  };

  return (await walkDir(join(repoRoot, 'src'))).sort();
}

async function main() {
  selfTest();

  const templates = await collectTemplates();
  const { messages, failures } = auditTemplates(templates);

  const catalogue = readXliff(join(repoRoot, CATALOGUE));
  const locales = configuredLocales();
  for (const locale of locales) {
    failures.push(...auditTranslations(catalogue, locale, readXliff(join(repoRoot, locale.file))));
  }

  let localizeCalls = 0;
  for (const absolute of await shippedSourceFiles()) {
    const file = relative(repoRoot, absolute);
    const audit = auditLocalizeCalls(file, readFileSync(absolute, 'utf8'));
    localizeCalls += audit.found;
    failures.push(...audit.failures);
  }

  writeSummary(
    `### Translatable strings\n\n` +
      `${messages.length} template message(s) across ${templates.length} template(s), ` +
      `plus ${localizeCalls} \`$localize\` message(s) in TypeScript. ` +
      `Every one carries an explicit \`@@id\`, and ${catalogue.size} catalogue entry(ies) ` +
      `are translated into ${locales.map((locale) => locale.code).join(', ') || '(no locales)'}.\n`
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`::error file=${failure.file},line=${failure.line}::i18n — ${failure.message}`);
    }
    console.error('See docs/i18n.md for what each of these rules is protecting.');
    process.exit(1);
  }

  console.log(
    `assert-i18n-coverage: clean (${messages.length} template message(s), ${localizeCalls} ` +
      `$localize message(s), ${catalogue.size} catalogue entry(ies) × ${locales.length} ` +
      `locale(s), ` +
      `${TEMPLATE_SELF_TESTS.length + LOCALIZE_SELF_TESTS.length + TRANSLATION_SELF_TESTS.length} ` +
      `rule self-tests passed)`
  );
}

/** Append to the GitHub Actions job summary when there is one, so the audit lands on the PR. */
function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${markdown}\n`);
}

await main();
