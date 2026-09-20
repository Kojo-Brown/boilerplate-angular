#!/usr/bin/env node
// Fail when the typed-form helpers stop rejecting a call they are meant to reject.
//
// ## Why a gate rather than a spec
//
// `src/app/core/forms/` produces types and almost nothing else: `typedGroup` is
// `new FormGroup(…)` with a signature around it, and every claim this item makes is a
// claim about what will not compile. A Karma spec cannot make that claim. Code that does
// not compile cannot be in a spec at all, and the assertions that *can* be written there
// — `expect(form.getRawValue()).toEqual({ email: '' })` — pass identically whether the
// return type is `LoginFormData`, `Partial<LoginFormData>`, `{ email: string | null }` or
// `any`. Three of those four are the bugs.
//
// So the positive half lives in the specs as `expectTypeEquals` (`src/testing/types.ts`),
// which `pnpm test`'s compile step checks, and the negative half lives here: fixtures
// that are *supposed* to fail, compiled by a `tsc` whose diagnostics are the assertion.
//
// ## Why not `@ts-expect-error`
//
// `@ts-expect-error` would fail the build if the next line stopped erroring, which is
// most of what this does — but it accepts *any* error on that line. A fixture that has
// drifted into a typo, an unresolved import or an unrelated arity mistake still reports
// an error, still satisfies the directive, and no longer tests anything. The failures
// here are near-misses by construction (a `string | null` where a `string` belongs), so
// "it errored" is not the interesting part; "it errored *for that reason*" is. Every
// annotation therefore names the diagnostic code and a phrase from the message, and the
// gate fails on an unannotated error as well as on a missing one.
//
// ## The annotation
//
//   // @expect-error TS2322: Type 'string | null' is not assignable to type 'string'
//
// Matching is by file, code and message substring rather than by line: TypeScript reports
// a missing property against the *call*, which is several lines above the annotation
// inside the object literal, and pinning that would make the fixtures fragile for no gain.
// Each annotation is consumed by at most one diagnostic, so two fixtures expecting the
// same error still need two errors.
//
// Usage: node scripts/ci/assert-form-types.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DIR = join(REPO_ROOT, 'scripts/ci/fixtures/form-types');
const FIXTURE_PROJECT = join(FIXTURE_DIR, 'tsconfig.json');
const TSC = join(REPO_ROOT, 'node_modules/typescript/bin/tsc');

/** Files in the fixture directory that carry no expectation of their own. */
const SUPPORT_FILES = new Set(['model.ts']);

const ANNOTATION = /^\s*\/\/\s*@expect-error\s+(TS\d+):\s*(.+?)\s*$/;
const DIAGNOSTIC = /^(?<file>[^(]+)\((?<line>\d+),(?<column>\d+)\):\s+error\s+(?<code>TS\d+):\s+(?<message>.*)$/;

/** Every `@expect-error` in the fixture directory, in file order. */
function readExpectations() {
  const files = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .sort();

  const expectations = [];
  const barren = [];

  for (const name of files) {
    if (SUPPORT_FILES.has(name)) continue;
    const lines = readFileSync(join(FIXTURE_DIR, name), 'utf8').split('\n');
    let found = 0;
    lines.forEach((line, index) => {
      const match = ANNOTATION.exec(line);
      if (!match) return;
      found += 1;
      expectations.push({
        file: relative(REPO_ROOT, join(FIXTURE_DIR, name)),
        line: index + 1,
        code: match[1],
        phrase: match[2],
      });
    });
    if (found === 0) barren.push(name);
  }

  return { expectations, barren, fixtureCount: files.length - SUPPORT_FILES.size };
}

/**
 * Compiles the fixtures and returns one record per diagnostic.
 *
 * TypeScript's elaboration ("Types of property 'x' are incompatible…") arrives as
 * indented continuation lines under the diagnostic it belongs to, and it is usually where
 * the phrase worth matching on lives — so a diagnostic's `text` is its first line plus
 * everything indented beneath it.
 */
function compileFixtures() {
  const result = spawnSync(process.execPath, [TSC, '--noEmit', '-p', FIXTURE_PROJECT, '--pretty', 'false'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`could not run tsc: ${result.error.message}`);
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const diagnostics = [];

  for (const line of output.split('\n')) {
    const match = DIAGNOSTIC.exec(line);
    if (match) {
      const { file, line: row, code, message } = match.groups;
      diagnostics.push({ file, line: Number(row), code, text: message });
      continue;
    }
    // A continuation line belongs to the diagnostic above it. A blank line or an
    // unindented line that is not a diagnostic (tsc's summary, an npm notice) is neither.
    if (diagnostics.length > 0 && /^\s+\S/.test(line)) {
      diagnostics[diagnostics.length - 1].text += `\n${line}`;
    }
  }

  return { diagnostics, raw: output };
}

/**
 * Pairs each diagnostic with the annotation that predicted it.
 *
 * Every annotation is consumable once, so two fixtures expecting the same code and phrase
 * still need two errors; an annotation only matches a diagnostic in its own file, so a
 * fixture cannot be certified by another fixture's failure.
 */
function reconcile(expectations, diagnostics) {
  const claimed = new Set();
  const unexpected = [];

  for (const diagnostic of diagnostics) {
    const expectation = expectations.find(
      (candidate) =>
        !claimed.has(candidate) &&
        candidate.file === diagnostic.file &&
        candidate.code === diagnostic.code &&
        diagnostic.text.includes(candidate.phrase)
    );
    if (expectation) {
      claimed.add(expectation);
    } else {
      unexpected.push(diagnostic);
    }
  }

  return { missing: expectations.filter((expectation) => !claimed.has(expectation)), unexpected };
}

/**
 * Proves the matcher still fails, against fabricated input, before it is trusted to
 * certify the repository.
 *
 * Nothing under `scripts/` is in Karma's build graph, so a `reconcile` that had degraded
 * into "always matches" would report every run clean and nothing else would notice. The
 * cases are the two ways this gate is supposed to fail plus the three near-misses that
 * must not be accepted as matches.
 */
function selfTest() {
  const at = (file, code, phrase) => ({ file, line: 1, code, phrase });
  const err = (file, code, text) => ({ file, line: 1, code, text });

  const cases = [
    {
      name: 'an expected error that was reported',
      expectations: [at('a.ts', 'TS2322', "not assignable to type 'string'")],
      diagnostics: [err('a.ts', 'TS2322', "Type 'null' is not assignable to type 'string'.")],
      missing: 0,
      unexpected: 0,
    },
    {
      name: 'an expected error that stopped being reported',
      expectations: [at('a.ts', 'TS2322', 'nullable')],
      diagnostics: [],
      missing: 1,
      unexpected: 0,
    },
    {
      name: 'an error nothing predicted',
      expectations: [],
      diagnostics: [err('a.ts', 'TS2304', "Cannot find name 'Foo'.")],
      missing: 0,
      unexpected: 1,
    },
    {
      name: 'the right message under the wrong code',
      expectations: [at('a.ts', 'TS2322', 'nullable')],
      diagnostics: [err('a.ts', 'TS2345', 'a nullable control')],
      missing: 1,
      unexpected: 1,
    },
    {
      name: 'the right code in the wrong file',
      expectations: [at('a.ts', 'TS2322', 'nullable')],
      diagnostics: [err('b.ts', 'TS2322', 'a nullable control')],
      missing: 1,
      unexpected: 1,
    },
    {
      name: 'one error where two were expected',
      expectations: [at('a.ts', 'TS2322', 'nullable'), at('a.ts', 'TS2322', 'nullable')],
      diagnostics: [err('a.ts', 'TS2322', 'a nullable control')],
      missing: 1,
      unexpected: 0,
    },
  ];

  for (const testCase of cases) {
    const { missing, unexpected } = reconcile(testCase.expectations, testCase.diagnostics);
    if (missing.length !== testCase.missing || unexpected.length !== testCase.unexpected) {
      console.error(
        `assert-form-types: self-test "${testCase.name}" failed — expected ` +
          `${testCase.missing} missing / ${testCase.unexpected} unexpected, got ` +
          `${missing.length} / ${unexpected.length}. The matcher is broken, so the fixtures ` +
          'below cannot be trusted either.'
      );
      process.exit(2);
    }
  }

  return cases.length;
}

function main() {
  const selfTests = selfTest();
  const { expectations, barren, fixtureCount } = readExpectations();

  if (fixtureCount === 0) {
    console.error('assert-form-types: no fixtures found — has scripts/ci/fixtures/form-types/ moved?');
    process.exit(2);
  }

  if (barren.length > 0) {
    for (const name of barren) {
      console.error(
        `::error file=scripts/ci/fixtures/form-types/${name}::fixture has no @expect-error ` +
          'annotation, so it asserts nothing. Add one, or move the file out of the fixture directory.'
      );
    }
    process.exit(1);
  }

  const { diagnostics, raw } = compileFixtures();

  if (diagnostics.length === 0) {
    console.error(
      'assert-form-types: tsc reported no errors at all. Either every fixture now compiles ' +
        '— which means the helpers stopped checking — or the project stopped including them.'
    );
    console.error(raw.trim());
    process.exit(1);
  }

  const { missing, unexpected } = reconcile(expectations, diagnostics);
  let failed = false;

  for (const expectation of missing) {
    failed = true;
    console.error(
      `::error file=${expectation.file},line=${expectation.line}::expected ` +
        `${expectation.code} containing "${expectation.phrase}", but no such error was reported. ` +
        'The helper has stopped rejecting this call — that is the regression, not the fixture.'
    );
  }

  for (const diagnostic of unexpected) {
    failed = true;
    const [first] = diagnostic.text.split('\n');
    console.error(
      `::error file=${diagnostic.file},line=${diagnostic.line}::unannotated ${diagnostic.code}: ` +
        `${first} — a fixture must fail for exactly the reason it names, and nothing else.`
    );
  }

  if (failed) {
    console.error('See docs/typed-forms.md for what each fixture is meant to prove.');
    process.exit(1);
  }

  console.log(
    `assert-form-types: clean (${fixtureCount} fixture(s), ${expectations.length} expected ` +
      `type error(s), all reported with the stated code and message; ${selfTests} matcher ` +
      `self-test(s) passed)`
  );
}

main();
