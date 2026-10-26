#!/usr/bin/env node
// Replay the recorded TDD kata and hold it to the discipline it claims to demonstrate.
//
// ## Why this exists at all
//
// `SPEC.md` asks for "one feature built red→green→refactor, one commit per step", and the
// obvious reading is that the commits *are* the deliverable. They cannot be: every item in
// this repository lands through `gh pr merge --squash --delete-branch`, which replaces the
// branch's commits with one commit on `main` and then deletes the branch. A kata recorded
// only as history is therefore destroyed by the merge that accepts it — the steps survive
// on the pull request and nowhere in the repository, so nobody who clones it can replay
// them, and `git log` cannot be a gate on something it no longer contains.
//
// So the steps are recorded in the tree, under `katas/<name>/steps/`, and this is what
// makes them more than a museum. Each step is a complete, self-contained pair of files —
// an implementation and the spec as it stood — and each is *run*: the red ones must still
// be red, for the stated reason, and the green ones must still be green. A kata nobody
// executes rots exactly the way a checklist rots, and in the same silence.
//
// ## What it checks, and why each one is invisible otherwise
//
// 1. **A red step is red.** Not "fails" — fails in the declared way, with the declared
//    specs failing and a message that matches. A step whose red turned into a *different*
//    red still passes a "did it fail?" check while no longer demonstrating anything.
// 2. **A red step is red for the right kind of reason.** `red-compile` must fail before a
//    single assertion runs (which is the whole point of the first step: in a typed
//    language the first red is usually the compiler, and the compiler tells you nothing
//    about the behaviour you are specifying). `red-declare` and `red` must *build* and
//    then fail an assertion. Nothing about a failing build says which of the two it was.
// 3. **A red step does not touch the implementation.** The test comes first, so the
//    implementation at a red step is the previous step's, byte for byte. A "red" step
//    that also edited the code is a step that was written backwards and reads identically.
// 4. **A green step does not touch the spec.** You make a test pass by changing the code.
//    A green step whose spec differs from the red step before it is the one move TDD has
//    no answer for, and it is invisible in a diff that shows both files changing.
// 5. **No step deletes a test.** Every spec title in a step survives into every later
//    step. Deleting an inconvenient assertion is the other way to turn a bar green.
// 6. **The refactor step changed the code and nothing else**, and follows a green step —
//    a "refactor" that follows a red one is a fix wearing the word.
// 7. **The kata still describes the code that ships.** Every function the last step
//    exports is still exported by the module in `src/`, and every spec it ends with is
//    still in that module's spec. This is the rule that fails when the feature moves on
//    and the kata is left behind, which is the only way a recorded kata can lie.
//
// Every spec count is checked too, which is what stops a `fit` or an `xit` from quietly
// shrinking a step to the assertions that still hold.
//
// ## How a step is replayed
//
// The step's two files are copied into `src/kata-run/` and the repository's own test
// command is pointed at them. Using the real runner rather than a second one is the point:
// "this spec was red" has to mean the same thing it means in `pnpm test`, which includes
// the TypeScript configuration, the zoneless test platform and the Jasmine version. The
// staging directory is inside `src/` because that is where the Karma builder looks for
// specs, is deleted after every step, and is in `.gitignore`.
//
// Usage:
//   node scripts/ci/assert-tdd-kata.mjs                # replay every kata in katas/
//   node scripts/ci/assert-tdd-kata.mjs --self-test    # check the rules, run nothing
//   node scripts/ci/assert-tdd-kata.mjs --step 03      # replay one step, for debugging
//   node scripts/ci/assert-tdd-kata.mjs --print        # what each step does, no replay

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KATAS_DIR = join(REPO_ROOT, 'katas');
const STAGING_DIR = join(REPO_ROOT, 'src/kata-run');

/** The step kinds, and what each one promises about the two files and the run. */
const KINDS = {
  'red-compile': { spec: 'grows', implementation: 'unchanged', outcome: 'no-build' },
  'red-declare': { spec: 'unchanged', implementation: 'changed', outcome: 'assertions-fail' },
  red: { spec: 'grows', implementation: 'unchanged', outcome: 'assertions-fail' },
  green: { spec: 'unchanged', implementation: 'changed', outcome: 'all-pass' },
  refactor: { spec: 'unchanged', implementation: 'changed', outcome: 'all-pass' },
};

// ---------------------------------------------------------------------------------------
// Reading the runner's output.
//
// Karma's `progress` reporter is the format here, pinned with `--reporters=progress` so a
// change to `karma.conf.js`'s reporter list cannot change what this parses. Three shapes
// matter: the `TOTAL:` summary, the `<browser> <full spec name> FAILED` blocks with their
// indented messages, and the TypeScript diagnostics a build failure prints instead of all
// of it. A run that produced none of them is reported as unreadable rather than as a pass,
// because "no TOTAL line" and "nothing failed" are indistinguishable to a naive parser and
// the second is the dangerous reading.
// ---------------------------------------------------------------------------------------

/** Remove the colour and cursor-control sequences the reporter writes. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex -- the point of this function
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

export function parseRun(rawOutput, exitCode) {
  const lines = stripAnsi(rawOutput).split('\n');

  const diagnostics = [
    ...new Set(lines.flatMap((line) => [...line.matchAll(/error (TS\d+)/g)].map((m) => m[1]))),
  ];

  let total = null;
  for (const line of lines) {
    const summary = /^TOTAL: (?:(\d+) FAILED, )?(\d+) SUCCESS/.exec(line.trim());
    if (summary) {
      total = { failed: Number(summary[1] ?? 0), passed: Number(summary[2]) };
    }
  }

  const failures = [];
  for (let i = 0; i < lines.length; i++) {
    // `<name> <version> (<os>) <full spec name> FAILED`, and not a progress line, which
    // carries "Executed n of m" and a colon after the browser.
    const failed = /^[A-Za-z][^(]*\([^)]*\)\s(.+?)\sFAILED\s*$/.exec(lines[i]);
    if (!failed || lines[i].includes('Executed ')) continue;

    const messages = [];
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]) && lines[j].trim() !== ''; j++) {
      const message = lines[j].trim();
      if (message.startsWith('at ')) continue;
      messages.push(message);
    }
    failures.push({ spec: failed[1], messages });
  }

  return {
    built: total !== null,
    executed: total === null ? 0 : total.failed + total.passed,
    failed: total?.failed ?? 0,
    passed: total?.passed ?? 0,
    failures,
    diagnostics,
    exitCode,
    unreadable: total === null && diagnostics.length === 0 && exitCode !== 0,
  };
}

// ---------------------------------------------------------------------------------------
// The rules. Pure functions of the recorded files and the parsed run, so `--self-test` can
// drive every failure they report without a browser.
// ---------------------------------------------------------------------------------------

/** The full `describe > … > it` names a spec file declares, in source order. */
export function specTitles(source) {
  const titles = [];
  const stack = [];
  // Indentation is the nesting, which is true of any file Prettier has formatted and is
  // checked against the real spec files on every run: a `describe` or an `it` that this
  // misreads shows up as a count that disagrees with the runner's.
  for (const line of source.split('\n')) {
    const block = /^(\s*)(describe|it)\(\s*'((?:[^'\\]|\\.)*)'/.exec(line);
    if (!block) continue;
    const depth = block[1].length / 2;
    stack.length = Math.min(stack.length, depth);
    const title = block[3].replace(/\\(.)/g, '$1');
    if (block[2] === 'describe') {
      stack[depth] = title;
    } else {
      titles.push([...stack.slice(0, depth).filter((s) => s !== undefined), title].join(' '));
    }
  }
  return titles;
}

/** The names a step's implementation exports. */
export function exportedNames(source) {
  return [
    ...new Set(
      [...source.matchAll(/^export (?:async )?(?:function|const|class|interface|type) (\w+)/gm)].map(
        (m) => m[1]
      )
    ),
  ];
}

export function checkStep(step, previous, run) {
  const problems = [];
  const kind = KINDS[step.kind];
  const where = `${step.dir} (${step.kind})`;

  if (!kind) {
    return [`${where}: unknown step kind. Expected one of ${Object.keys(KINDS).join(', ')}.`];
  }

  // --- the two files, against the step before them -------------------------------------
  if (previous === null) {
    if (step.implementation !== null) {
      problems.push(
        `${where}: the first step must have no implementation — a kata starts with a spec and nothing to run it against.`
      );
    }
  } else if (kind.implementation === 'unchanged') {
    if (step.implementation !== previous.implementation) {
      problems.push(
        `${where}: a red step may not change the implementation. The test comes first, so this file must be ${previous.dir}'s byte for byte.`
      );
    }
  } else if (step.implementation === previous.implementation) {
    problems.push(
      `${where}: this step claims to change the implementation and it is identical to ${previous.dir}'s.`
    );
  }

  if (previous !== null) {
    const titles = specTitles(step.spec);
    const before = specTitles(previous.spec);
    const dropped = before.filter((t) => !titles.includes(t));
    if (dropped.length > 0) {
      problems.push(
        `${where}: no step may delete a test, and these are gone since ${previous.dir}:\n` +
          dropped.map((t) => `      - ${t}`).join('\n')
      );
    }

    if (kind.spec === 'unchanged' && step.spec !== previous.spec) {
      problems.push(
        `${where}: a ${step.kind} step may not change the spec — a test is made to pass by changing the code. This file differs from ${previous.dir}'s.`
      );
    }
    if (kind.spec === 'grows' && titles.length === before.length) {
      problems.push(
        `${where}: a red step has to add a failing test, and this spec declares the same ${titles.length} as ${previous.dir}.`
      );
    }
  }

  if (step.kind === 'refactor' && previous !== null && KINDS[previous.kind].outcome !== 'all-pass') {
    problems.push(
      `${where}: a refactor follows a green step. ${previous.dir} is ${previous.kind}, which makes this a fix rather than a refactor.`
    );
  }

  // --- the run --------------------------------------------------------------------------
  if (run === null) return problems;

  if (run.unreadable) {
    return [
      ...problems,
      `${where}: could not read the runner's output — no TOTAL line and no TypeScript diagnostic. Treating that as a pass is the one thing this must not do.`,
    ];
  }

  const declared = specTitles(step.spec);

  if (kind.outcome === 'no-build') {
    if (run.built) {
      problems.push(
        `${where}: expected the build to fail before any spec ran, and ${run.executed} ran.`
      );
    }
    if (step.diagnostic && !run.diagnostics.includes(step.diagnostic)) {
      problems.push(
        `${where}: expected diagnostic ${step.diagnostic}, got ${
          run.diagnostics.length > 0 ? run.diagnostics.join(', ') : 'none'
        }. The step is still red, but no longer for the reason it records.`
      );
    }
    return problems;
  }

  if (!run.built) {
    problems.push(
      `${where}: expected the step to build and the assertions to decide it, and it did not compile${
        run.diagnostics.length > 0 ? ` (${run.diagnostics.join(', ')})` : ''
      }.`
    );
    return problems;
  }

  if (run.executed !== declared.length) {
    problems.push(
      `${where}: the spec declares ${declared.length} tests and ${run.executed} ran. A focused or disabled test shrinks a step without changing a line of it.`
    );
  }

  const expected = (step.failing ?? []).map((f) => f.spec);
  const actual = run.failures.map((f) => f.spec);

  if (kind.outcome === 'all-pass') {
    if (run.failed !== 0) {
      problems.push(`${where}: expected every test to pass, and these failed:\n${bullets(actual)}`);
    }
    return problems;
  }

  if (expected.length === 0) {
    problems.push(`${where}: a red step must record which tests fail, and this one records none.`);
  }

  const unexpected = actual.filter((s) => !expected.includes(s));
  const missing = expected.filter((s) => !actual.includes(s));
  if (unexpected.length > 0) {
    problems.push(
      `${where}: these tests failed and the step does not say they should:\n${bullets(unexpected)}`
    );
  }
  if (missing.length > 0) {
    problems.push(
      `${where}: these tests are recorded as failing here and they passed:\n${bullets(missing)}`
    );
  }

  for (const want of step.failing ?? []) {
    const got = run.failures.find((f) => f.spec === want.spec);
    if (!got || !want.message) continue;
    if (!got.messages.some((m) => m.includes(want.message))) {
      problems.push(
        `${where}: "${want.spec}" failed for a different reason than recorded.\n` +
          `      recorded: ${want.message}\n` +
          `      actual:   ${got.messages.join(' / ') || '(no message)'}`
      );
    }
  }

  return problems;
}

/** Rule 7: the kata still describes the module the application ships. */
export function checkStillShipped(kata, lastStep, shipped) {
  const problems = [];

  const katasExports = exportedNames(lastStep.implementation);
  const goneFromSource = katasExports.filter((name) => !exportedNames(shipped.implementation).includes(name));
  if (goneFromSource.length > 0) {
    problems.push(
      `${kata.name}: the kata ends by exporting names that ${kata.subject.implementation} no longer does:\n` +
        bullets(goneFromSource) +
        `\n      The kata is a record of how this code was built. If the code moved on, the record is wrong — update the last step or delete the kata, but do not leave it describing a function that is gone.`
    );
  }

  const shippedTitles = specTitles(shipped.spec);
  const goneFromSpec = specTitles(lastStep.spec).filter((t) => !shippedTitles.includes(t));
  if (goneFromSpec.length > 0) {
    problems.push(
      `${kata.name}: the kata ends on tests that ${kata.subject.spec} no longer has:\n` +
        bullets(goneFromSpec)
    );
  }

  return problems;
}

function bullets(items) {
  return items.map((i) => `      - ${i}`).join('\n');
}

// ---------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------

function loadKata(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'kata.json'), 'utf8'));
  const name = relative(KATAS_DIR, dir);
  const stepsDir = join(dir, 'steps');

  const recorded = readdirSync(stepsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const declared = manifest.steps.map((s) => s.dir);
  if (recorded.join('\n') !== declared.join('\n')) {
    throw new Error(
      `${name}: kata.json and steps/ disagree.\n  on disk:   ${recorded.join(', ')}\n  in kata.json: ${declared.join(', ')}`
    );
  }

  const steps = manifest.steps.map((step, index) => {
    const stepDir = join(stepsDir, step.dir);
    const files = readdirSync(stepDir).sort();
    const expected = [manifest.files.spec, ...(index === 0 ? [] : [manifest.files.implementation])].sort();
    if (files.join(',') !== expected.join(',')) {
      throw new Error(
        `${name}/${step.dir}: a step holds exactly the files the kata is about.\n  found:    ${files.join(', ')}\n  expected: ${expected.join(', ')}`
      );
    }
    const implementationPath = join(stepDir, manifest.files.implementation);
    return {
      ...step,
      dir: step.dir,
      spec: readFileSync(join(stepDir, manifest.files.spec), 'utf8'),
      implementation: existsSync(implementationPath)
        ? readFileSync(implementationPath, 'utf8')
        : null,
      paths: { dir: stepDir, implementation: implementationPath },
    };
  });

  return {
    name,
    ...manifest,
    steps,
    shipped: {
      implementation: readFileSync(join(REPO_ROOT, manifest.subject.implementation), 'utf8'),
      spec: readFileSync(join(REPO_ROOT, manifest.subject.spec), 'utf8'),
    },
  };
}

function katas() {
  if (!existsSync(KATAS_DIR)) return [];
  return readdirSync(KATAS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(KATAS_DIR, e.name, 'kata.json')))
    .map((e) => loadKata(join(KATAS_DIR, e.name)));
}

// ---------------------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------------------

function replay(kata, step) {
  if (existsSync(STAGING_DIR)) {
    throw new Error(
      `${relative(REPO_ROOT, STAGING_DIR)} already exists. A previous replay was interrupted; delete it and run again. It is never committed, and the unit suite would pick up whatever is in it.`
    );
  }

  mkdirSync(STAGING_DIR, { recursive: true });
  try {
    cpSync(join(step.paths.dir, kata.files.spec), join(STAGING_DIR, kata.files.spec));
    if (step.implementation !== null) {
      cpSync(
        join(step.paths.dir, kata.files.implementation),
        join(STAGING_DIR, kata.files.implementation)
      );
    }

    let output = '';
    let exitCode = 0;
    try {
      output = execFileSync(
        'pnpm',
        [
          'exec',
          'ng',
          'test',
          '--no-watch',
          '--no-progress',
          '--code-coverage=false',
          '--reporters=progress',
          `--browsers=${process.env['KATA_BROWSER'] ?? 'ChromeHeadlessCI'}`,
          `--include=src/kata-run/${kata.files.spec}`,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (error) {
      output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
      exitCode = error.status ?? 1;
    }

    return { ...parseRun(output, exitCode), output };
  } finally {
    rmSync(STAGING_DIR, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------
// Self-test: every rule above, driven against the failure it names.
// ---------------------------------------------------------------------------------------

const SPEC_A = "describe('m', () => {\n  it('a', () => {});\n});\n";
const SPEC_AB = "describe('m', () => {\n  it('a', () => {});\n  it('b', () => {});\n});\n";
const IMPL_A = 'export function f() {}\n';
const IMPL_B = 'export function f() {\n  return 1;\n}\n';

function step(over = {}) {
  return { dir: 'NN-step', kind: 'green', spec: SPEC_A, implementation: IMPL_B, ...over };
}

function run(over = {}) {
  return {
    built: true,
    executed: 1,
    failed: 0,
    passed: 1,
    failures: [],
    diagnostics: [],
    exitCode: 0,
    unreadable: false,
    ...over,
  };
}

const SELF_TESTS = [
  [
    'reads a passing run',
    () => parseRun('TOTAL: 3 SUCCESS\n', 0),
    (r) => r.built && r.executed === 3 && r.failed === 0 && !r.unreadable,
  ],
  [
    'reads a failing run, with the spec name and the message',
    () =>
      parseRun(
        '\u001b[31mChrome Headless 153.0.0.0 (Linux 0.0.0) m a FAILED\u001b[39m\n' +
          '\tExpected 4 to be 5.\n\t    at <Jasmine>\n' +
          'Chrome Headless 153.0.0.0 (Linux 0.0.0): Executed 2 of 2 (1 FAILED) (0.03 secs)\n' +
          'TOTAL: 1 FAILED, 1 SUCCESS\n',
        1
      ),
    (r) =>
      r.built &&
      r.executed === 2 &&
      r.failures.length === 1 &&
      r.failures[0].spec === 'm a' &&
      r.failures[0].messages.join() === 'Expected 4 to be 5.',
  ],
  [
    'reads a build failure as a build failure, with its diagnostic',
    () =>
      parseRun(
        "Error: src/kata-run/x.spec.ts:1:23 - error TS2307: Cannot find module './x'.\n" +
          'ERROR [karma-server]: Error: Found 1 load error\n',
        1
      ),
    (r) => !r.built && r.executed === 0 && r.diagnostics.join() === 'TS2307' && !r.unreadable,
  ],
  [
    'refuses to read a run it does not understand as a pass',
    () => parseRun('karma exploded\n', 1),
    (r) => r.unreadable,
  ],
  [
    'reads nested spec titles as the runner reports them',
    () => specTitles("describe('a', () => {\n  describe('b', () => {\n    it('c', () => {});\n  });\n});\n"),
    (t) => t.join() === 'a b c',
  ],
  [
    'does not let a sibling describe leak into a later title',
    () =>
      specTitles(
        "describe('a', () => {\n  describe('b', () => {\n    it('c', () => {});\n  });\n  it('d', () => {});\n});\n"
      ),
    (t) => t.join('|') === 'a b c|a d',
  ],
  ['reads exported names', () => exportedNames('export function f() {}\nexport type T = 1;\nfunction g() {}\n'), (n) => n.join() === 'f,T'],

  // --- the rules ------------------------------------------------------------------------
  [
    'passes a green step that changed the code and not the spec',
    () => checkStep(step(), step({ dir: '01', kind: 'red', implementation: IMPL_A }), run()),
    (p) => p.length === 0,
  ],
  [
    'fails a green step that edited the spec',
    () => checkStep(step({ spec: SPEC_AB }), step({ dir: '01', kind: 'red', implementation: IMPL_A }), run({ executed: 2, passed: 2 })),
    (p) => p.some((m) => m.includes('may not change the spec')),
  ],
  [
    'fails a red step that edited the implementation',
    () => checkStep(step({ kind: 'red', spec: SPEC_AB, implementation: IMPL_B }), step({ dir: '01', implementation: IMPL_A }), null),
    (p) => p.some((m) => m.includes('may not change the implementation')),
  ],
  [
    'fails a step that deleted a test',
    () => checkStep(step({ spec: SPEC_A }), step({ dir: '01', kind: 'red', spec: SPEC_AB, implementation: IMPL_A }), null),
    (p) => p.some((m) => m.includes('no step may delete a test') && m.includes('b')),
  ],
  [
    'fails a red step that added no test',
    () => checkStep(step({ kind: 'red', failing: [{ spec: 'm a' }] }), step({ dir: '01' }), null),
    (p) => p.some((m) => m.includes('has to add a failing test')),
  ],
  [
    'fails a green step that is red',
    () => checkStep(step(), step({ dir: '01', kind: 'red', implementation: IMPL_A }), run({ failed: 1, passed: 0, failures: [{ spec: 'm a', messages: ['nope'] }] })),
    (p) => p.some((m) => m.includes('expected every test to pass')),
  ],
  [
    'fails a red step that is green',
    () =>
      checkStep(
        step({ kind: 'red', spec: SPEC_AB, implementation: IMPL_A, failing: [{ spec: 'm b' }] }),
        step({ dir: '01', implementation: IMPL_A }),
        run({ executed: 2, passed: 2 })
      ),
    (p) => p.some((m) => m.includes('recorded as failing here and they passed')),
  ],
  [
    'fails a red step whose red moved to another test',
    () =>
      checkStep(
        step({ kind: 'red', spec: SPEC_AB, implementation: IMPL_A, failing: [{ spec: 'm b' }] }),
        step({ dir: '01', implementation: IMPL_A }),
        run({ executed: 2, failed: 1, passed: 1, failures: [{ spec: 'm a', messages: ['x'] }] })
      ),
    (p) => p.some((m) => m.includes('does not say they should')),
  ],
  [
    'fails a red step whose message changed',
    () =>
      checkStep(
        step({ kind: 'red', spec: SPEC_AB, implementation: IMPL_A, failing: [{ spec: 'm b', message: "to be 'expired'" }] }),
        step({ dir: '01', implementation: IMPL_A }),
        run({ executed: 2, failed: 1, passed: 1, failures: [{ spec: 'm b', messages: ['Expected 1 to be 2.'] }] })
      ),
    (p) => p.some((m) => m.includes('for a different reason than recorded')),
  ],
  [
    'fails a red-compile step that compiled',
    () => checkStep(step({ kind: 'red-compile', spec: SPEC_AB, implementation: IMPL_A, diagnostic: 'TS2307' }), step({ dir: '01', implementation: IMPL_A }), run()),
    (p) => p.some((m) => m.includes('expected the build to fail before any spec ran')),
  ],
  [
    'fails a red-compile step whose diagnostic changed',
    () =>
      checkStep(
        step({ kind: 'red-compile', spec: SPEC_AB, implementation: IMPL_A, diagnostic: 'TS2307' }),
        step({ dir: '01', implementation: IMPL_A }),
        run({ built: false, executed: 0, passed: 0, diagnostics: ['TS2345'] })
      ),
    (p) => p.some((m) => m.includes('expected diagnostic TS2307')),
  ],
  [
    'fails an assertion-red step that did not compile',
    () =>
      checkStep(
        step({ kind: 'red', spec: SPEC_AB, implementation: IMPL_A, failing: [{ spec: 'm b' }] }),
        step({ dir: '01', implementation: IMPL_A }),
        run({ built: false, executed: 0, passed: 0, diagnostics: ['TS2305'] })
      ),
    (p) => p.some((m) => m.includes('expected the step to build')),
  ],
  [
    'fails a step where fewer tests ran than it declares',
    () => checkStep(step({ spec: SPEC_AB }), step({ dir: '01', kind: 'red', spec: SPEC_AB, implementation: IMPL_A }), run({ executed: 1, passed: 1 })),
    (p) => p.some((m) => m.includes('declares 2 tests and 1 ran')),
  ],
  [
    'fails a refactor that follows a red step',
    () => checkStep(step({ kind: 'refactor' }), step({ dir: '01', kind: 'red', implementation: IMPL_A }), run()),
    (p) => p.some((m) => m.includes('a refactor follows a green step')),
  ],
  [
    'passes a refactor that follows a green step',
    () => checkStep(step({ kind: 'refactor' }), step({ dir: '01', kind: 'green', implementation: IMPL_A }), run()),
    (p) => p.length === 0,
  ],
  [
    'fails a first step that shipped an implementation',
    () => checkStep(step({ kind: 'red-compile', implementation: IMPL_A, diagnostic: 'TS2307' }), null, run({ built: false, executed: 0, passed: 0, diagnostics: ['TS2307'] })),
    (p) => p.some((m) => m.includes('the first step must have no implementation')),
  ],
  [
    'fails a kata whose last step exports what the shipped module no longer does',
    () =>
      checkStillShipped(
        { name: 'k', subject: { implementation: 'src/x.ts', spec: 'src/x.spec.ts' } },
        { implementation: 'export function gone() {}\n', spec: SPEC_A },
        { implementation: IMPL_A, spec: SPEC_A }
      ),
    (p) => p.some((m) => m.includes('no longer does') && m.includes('gone')),
  ],
  [
    'fails a kata whose last tests are gone from the shipped spec',
    () =>
      checkStillShipped(
        { name: 'k', subject: { implementation: 'src/x.ts', spec: 'src/x.spec.ts' } },
        { implementation: IMPL_A, spec: SPEC_AB },
        { implementation: IMPL_A, spec: SPEC_A }
      ),
    (p) => p.some((m) => m.includes('no longer has') && m.includes('m b')),
  ],
  [
    'passes a kata the shipped module has only grown past',
    () =>
      checkStillShipped(
        { name: 'k', subject: { implementation: 'src/x.ts', spec: 'src/x.spec.ts' } },
        { implementation: IMPL_A, spec: SPEC_A },
        { implementation: `${IMPL_A}export const extra = 1;\n`, spec: SPEC_AB }
      ),
    (p) => p.length === 0,
  ],
];

function selfTest() {
  const failed = [];
  for (const [name, act, holds] of SELF_TESTS) {
    let result;
    try {
      result = act();
    } catch (error) {
      failed.push(`${name}: threw ${error.message}`);
      continue;
    }
    if (!holds(result)) {
      failed.push(`${name}: ${JSON.stringify(result, null, 2)}`);
    }
  }

  if (failed.length > 0) {
    console.error(`✗ assert-tdd-kata: ${failed.length} of its own rules do not hold:\n`);
    for (const f of failed) console.error(`  - ${f}\n`);
    return false;
  }

  console.log(`✓ assert-tdd-kata: ${SELF_TESTS.length} self-tests pass`);
  return true;
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--step') ? args[args.indexOf('--step') + 1] : null;

  if (!selfTest()) process.exit(1);
  if (args.includes('--self-test')) return;

  const all = katas();
  if (all.length === 0) {
    console.error('✗ assert-tdd-kata: no kata found under katas/.');
    process.exit(1);
  }

  const problems = [];

  for (const kata of all) {
    console.log(`\n${kata.name}: ${kata.title}`);

    for (const [index, step] of kata.steps.entries()) {
      const previous = index === 0 ? null : kata.steps[index - 1];

      if (args.includes('--print')) {
        console.log(`  ${step.dir}  ${step.kind}  ${specTitles(step.spec).length} specs`);
        problems.push(...checkStep(step, previous, null));
        continue;
      }

      if (only !== null && !step.dir.startsWith(only)) continue;

      const outcome = replay(kata, step);
      const stepProblems = checkStep(step, previous, outcome);
      const verdict = stepProblems.length === 0 ? '✓' : '✗';
      const ran = outcome.built
        ? `${outcome.passed} passed, ${outcome.failed} failed`
        : `did not build (${outcome.diagnostics.join(', ') || 'no diagnostic'})`;
      console.log(`  ${verdict} ${step.dir.padEnd(46)} ${step.kind.padEnd(12)} ${ran}`);

      if (stepProblems.length > 0 && process.env['KATA_VERBOSE'] === '1') {
        console.log(outcome.output);
      }
      problems.push(...stepProblems);
    }

    problems.push(...checkStillShipped(kata, kata.steps[kata.steps.length - 1], kata.shipped));
  }

  if (problems.length > 0) {
    console.error(`\n✗ assert-tdd-kata: ${problems.length} problem(s)\n`);
    for (const problem of problems) console.error(`  - ${problem}\n`);
    console.error(
      'A kata is a record of how a piece of code was built. Re-record the step rather than editing it to agree with the code; `docs/tdd.md` says how.'
    );
    process.exit(1);
  }

  console.log('\n✓ assert-tdd-kata: every step is still the colour it records, for the reason it records.');
}

main();
