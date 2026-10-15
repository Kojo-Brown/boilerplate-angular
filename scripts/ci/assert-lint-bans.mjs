#!/usr/bin/env node
// Prove the security bans in `eslint.config.mjs` still fire.
//
// ## Why this is a gate and not a test
//
// Two of this repository's security claims are enforced by a lint rule and by nothing
// else: `DomSanitizer.bypassSecurityTrust*` is refused (`docs/security.md`), and the bare
// `location` global is refused so a user-controlled string has no sink that can leave the
// origin (`docs/owasp-top-10.md`, A01). `pnpm lint` runs in CI and would fail a repository
// that called either — but only while the rules still *match*, and a rule that has stopped
// matching is indistinguishable from a repository that complies:
//
//   1. **A selector that matches nothing.** The bypass ban is an ESLint AST selector with
//      a regular expression in it. Mistype the alternation, rename a captured property,
//      or move to a parser that reports the member differently, and `no-restricted-syntax`
//      goes quiet. `pnpm lint` then passes on every file, forever, and the one signal that
//      something broke is the absence of an error nobody was expecting.
//   2. **A deleted entry.** A `no-restricted-globals` list is a flat array, and removing
//      one object from it is a one-line diff that reads as tidying. Nothing else in CI
//      mentions these two names.
//
// So the rules are run against source that is supposed to trip them, and each fixture has
// to fail for the rule it names — the same arrangement `assert-form-types.mjs` uses for
// the typed-form helpers, which are proven by compiling code that must not compile.
//
// The one deviation from the repository's own lint run: type-aware parsing is switched off
// for these fixtures, because they are linted as text at a path that holds no file and
// typescript-eslint refuses a file outside the tsconfig's program. Neither rule here reads
// type information — both are syntactic — and the rule *configuration* comes from
// `eslint.config.mjs` unchanged, which is the part that has to be true.
//
// Usage:  node scripts/ci/assert-lint-bans.mjs
// See:    docs/security.md, docs/owasp-top-10.md

import { appendFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { repoRoot } from './lib/templates.mjs';

/**
 * A path under `src/app/` that holds no file.
 *
 * It has to be under `src/app/` because that is the scope both rules are configured for,
 * and it must not be a real file so that a fixture can never be mistaken for shipped
 * source — or be left behind by a crashed run to break `pnpm typecheck`.
 */
const AS_IF_AT = 'src/app/__lint-ban-fixture__.ts';

/** Same path, but matching the `*.spec.ts` exclusion the globals rule carries. */
const AS_IF_AT_SPEC = 'src/app/__lint-ban-fixture__.spec.ts';

/**
 * Each case is source that must be refused, and the rule that must refuse it.
 *
 * `@owasp` markers tie a case to the claim it proves in
 * `src/app/core/security/owasp.ts`; `assert-owasp-checklist.mjs` checks the two agree in
 * both directions, so a claim cannot cite a rule that is not here and a rule here cannot
 * stop being cited.
 */
const BANNED = [
  {
    // @owasp A05.sanitiser-is-never-bypassed
    name: 'a dotted bypassSecurityTrust* call',
    rule: 'no-restricted-syntax',
    path: AS_IF_AT,
    source: [
      "import type { DomSanitizer } from '@angular/platform-browser';",
      'export function render(sanitizer: DomSanitizer, markup: string): unknown {',
      '  return sanitizer.bypassSecurityTrustHtml(markup);',
      '}',
      '',
    ].join('\n'),
  },
  {
    // @owasp A05.sanitiser-is-never-bypassed
    //
    // The form written to get around a rule that only looked at dotted access. It is
    // listed separately because it is a second selector in the config: losing it would
    // leave the first one passing and the ban half gone.
    name: 'a computed bypassSecurityTrust* call',
    rule: 'no-restricted-syntax',
    path: AS_IF_AT,
    source: [
      "import type { DomSanitizer } from '@angular/platform-browser';",
      'export function render(sanitizer: DomSanitizer, markup: string): unknown {',
      "  return sanitizer['bypassSecurityTrustHtml'](markup);",
      '}',
      '',
    ].join('\n'),
  },
  {
    // @owasp A05.sanitiser-is-never-bypassed
    name: 'a bypassSecurityTrustResourceUrl call, the alternation’s last branch',
    rule: 'no-restricted-syntax',
    path: AS_IF_AT,
    source: [
      "import type { DomSanitizer } from '@angular/platform-browser';",
      'export function frame(sanitizer: DomSanitizer, url: string): unknown {',
      '  return sanitizer.bypassSecurityTrustResourceUrl(url);',
      '}',
      '',
    ].join('\n'),
  },
  {
    // @owasp A01.no-sink-that-can-leave-the-origin
    name: 'an assignment to location.href',
    rule: 'no-restricted-globals',
    path: AS_IF_AT,
    source: ['export function go(url: string): void {', '  location.href = url;', '}', ''].join(
      '\n'
    ),
  },
  {
    // @owasp A01.no-sink-that-can-leave-the-origin
    name: 'a location.assign call',
    rule: 'no-restricted-globals',
    path: AS_IF_AT,
    source: ['export function go(url: string): void {', '  location.assign(url);', '}', ''].join(
      '\n'
    ),
  },
  {
    // @owasp A01.no-sink-that-can-leave-the-origin
    //
    // `window` has been banned since SSR was turned on, and it is the other half of the
    // same sink: `window.location.href = …` and `window.open(…)` both leave the origin.
    name: 'a window.open call',
    rule: 'no-restricted-globals',
    path: AS_IF_AT,
    source: ['export function pop(url: string): void {', '  window.open(url);', '}', ''].join('\n'),
  },
];

/**
 * Source that must lint clean, so a failure above means the rule fired and not that
 * everything fires.
 *
 * A gate that only ever asserts "this is refused" cannot tell a working rule from a
 * configuration that refuses all source — a parse error, a missing plugin, a glob that
 * matches nothing and falls through to some stricter default. The third case is the one
 * that matters most: it proves the *scope* is still right, because the globals rule
 * exempts specs and a scope that had stopped exempting them would be a different rule
 * than the one `docs/security.md` describes.
 */
const ALLOWED = [
  {
    name: 'ordinary source that touches neither ban',
    path: AS_IF_AT,
    source: ['export function identity(value: string): string {', '  return value;', '}', ''].join(
      '\n'
    ),
  },
  {
    name: 'sanitising through the sanctioned helper',
    path: AS_IF_AT,
    source: [
      "import type { HtmlSanitiser } from '@/app/core/security';",
      'export function render(sanitiser: HtmlSanitiser, markup: string): string {',
      '  return sanitiser.sanitise(markup);',
      '}',
      '',
    ].join('\n'),
  },
  {
    name: 'a spec reaching for a browser global, which the globals rule exempts',
    path: AS_IF_AT_SPEC,
    source: ['export function url(): string {', '  return location.href;', '}', ''].join('\n'),
  },
];

/** The rules this gate speaks for. A finding from any other rule is not its business. */
const RULES_UNDER_TEST = new Set(['no-restricted-syntax', 'no-restricted-globals']);

function createLinter() {
  return new ESLint({
    cwd: repoRoot,
    // See the header: the fixtures are text at a path with no file, which type-aware
    // parsing cannot accept. The rules under test are syntactic.
    overrideConfig: {
      languageOptions: { parserOptions: { project: false, projectService: false } },
    },
  });
}

/** Every message from a rule this gate speaks for, with the parse errors kept. */
export function relevantMessages(messages) {
  return messages.filter(
    (message) => message.ruleId === null || RULES_UNDER_TEST.has(message.ruleId)
  );
}

async function main() {
  const eslint = createLinter();
  const failures = [];

  for (const banned of BANNED) {
    const [result] = await eslint.lintText(banned.source, {
      filePath: banned.path,
      warnIgnored: false,
    });
    const messages = relevantMessages(result.messages);
    const parseError = messages.find((message) => message.ruleId === null);

    if (parseError) {
      failures.push({
        message:
          `${banned.name}: the fixture did not parse (${parseError.message}). The ban was ` +
          `never exercised, so this gate proved nothing about it`,
      });
      continue;
    }

    if (!messages.some((message) => message.ruleId === banned.rule)) {
      failures.push({
        message:
          `${banned.name} linted clean. \`${banned.rule}\` in eslint.config.mjs no longer ` +
          `refuses it, so \`pnpm lint\` would pass a repository that did this — and would ` +
          `keep passing, because nothing else in CI mentions it. See docs/security.md`,
      });
    }
  }

  for (const allowed of ALLOWED) {
    const [result] = await eslint.lintText(allowed.source, {
      filePath: allowed.path,
      warnIgnored: false,
    });
    const messages = relevantMessages(result.messages);

    if (messages.length > 0) {
      failures.push({
        message:
          `${allowed.name} was refused by \`${messages[0].ruleId ?? 'the parser'}\`: ` +
          `${messages[0].message}. A ban that refuses compliant source is not narrower ` +
          `than it looks, it is a different rule, and the "is refused" cases above would ` +
          `pass however broken it was`,
      });
    }
  }

  writeSummary(
    `### Lint bans\n\n` +
      `${BANNED.length} banned construct(s) and ${ALLOWED.length} compliant one(s) linted ` +
      `through \`eslint.config.mjs\`; ${failures.length} problem(s) found.\n`
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`::error file=eslint.config.mjs::Lint ban — ${failure.message}`);
    }
    process.exit(1);
  }

  console.log(
    `assert-lint-bans: clean (${BANNED.length} refused as expected, ` +
      `${ALLOWED.length} compliant fixture(s) untouched)`
  );
}

/** Append to the GitHub Actions job summary when there is one, so the audit lands on the PR. */
function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${markdown}\n`);
}

await main();
