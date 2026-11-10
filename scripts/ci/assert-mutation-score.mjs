#!/usr/bin/env node
// Fail when the mutation run is weaker than it was, or weaker than it looks.
//
// ## Why this is a gate and not just `thresholds.break`
//
// Stryker can fail its own run: set `thresholds.break` and the process exits non-zero
// below that score. That is one number over the whole run, and **every cheap way of
// making a mutation score go up makes that number go up too**:
//
//   1. **Drop a file from `mutate`.** The weakest file in the scope is the one holding the
//      aggregate down, so removing it *raises* the score. A gate on the aggregate alone
//      does not merely miss this — it rewards it. `pnpm test` stays green, coverage stays
//      where it was, and the diff is one line in a config file.
//   2. **Keep the file and lose the glob.** A path that matches nothing contributes no
//      mutants and no error. Rename `plural.ts`, leave the `mutate` entry pointing at the
//      old name, and Stryker reports `Found 9 of 337 files to be mutated` — a line nobody
//      reads — then scores the nine that are left.
//   3. **Let one file rot.** 373 mutants over ten files means a file can go from 100% to
//      0% and move the aggregate by a few points. Rot is per file; a threshold has to be
//      per file or it is measuring the other nine.
//   4. **Make mutants fail to build.** `CompileError` and `RuntimeError` mutants are
//      *invalid* in the report schema and are left out of the score's denominator
//      entirely — `detected / (detected + survived + noCoverage)`. A change that stops
//      150 mutants compiling in the sandbox deletes them from the sum rather than failing
//      it, and the score goes up.
//
// None of the four is visible in a score. Three of them raise it. So the floors here are
// per file, they are paired with a mutant count, and the scope is pinned against the
// table: a file cannot leave the run without the table saying so in the same diff.
//
// `thresholds.break` is therefore **0** in `stryker.conf.json` — not "no threshold", but
// the threshold living in one place instead of two. `docs/mutation-testing.md` says so
// where a reader meets the config.
//
// ## The concurrency rule, which is not a tuning knob
//
// `concurrency` must be 1, and this gate fails if it is raised. With more than one test
// runner process this stack reports **false survivors**, non-deterministically: measured
// over four runs of one 24-mutant file, `concurrency: 2` returned 24 killed twice, and
// 13/11 and 12/12 the other two times, while `concurrency: 1` returned 24/24 four times
// out of four. Each of the eleven "survivors" in that run was then confirmed killed by
// `coverageAnalysis: "off"`, and one was confirmed by hand against `pnpm test`.
//
// That is the worst possible failure for a merge gate: the score drops for no reason in
// the source, and a false survivor is indistinguishable from a real test gap, so the
// honest response to one is to write a test that was never missing. The cost of pinning
// it is wall-clock in one job. `docs/mutation-testing.md` has the measurements and what is
// known about the cause.
//
// ## Staleness
//
// `reports/` is not checked in, so on a pull request the report is always the one Stryker
// just wrote. Locally it is not: editing a source file and running this gate without
// re-running Stryker grades the previous version of the code and passes. So the report has
// to be at least as new as every file it scored.
//
// Usage:  node scripts/ci/assert-mutation-score.mjs
//         node scripts/ci/assert-mutation-score.mjs --self-test   # check the rules only
//         node scripts/ci/assert-mutation-score.mjs --print       # measured vs floor
// See:    docs/mutation-testing.md

import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const CONFIG = 'stryker.conf.json';
const REPORT = 'reports/mutation/mutation.json';
const WORKFLOW = '.github/workflows/ci.yml';

/**
 * The floors, one row per mutated file.
 *
 * `score` is the mutation score the file must still reach and `mutants` the number of
 * mutants it must still produce. The second half is what makes the first half mean
 * something: a score is a ratio, and a file that stopped being mutated has no ratio to
 * fail. Both are the measured values at the time the row was written, so a row is a
 * record of what held, not an aspiration.
 *
 * A `score` below 100 must carry a `why`. That is the only thing standing between this
 * table and the failure mode the repository's own instructions name first — lowering a
 * threshold to turn a red build green. It cannot stop someone editing a number, but it
 * makes the edit arrive with a sentence a reviewer can disagree with.
 */
const FLOORS = {
  'src/app/core/auth/idle-session/idle-countdown.ts': { score: 100, mutants: 24 },

  'src/app/core/i18n/plural.ts': {
    score: 80,
    mutants: 5,
    why:
      "The survivor is `new Intl.PluralRules(locale, { type: 'cardinal' })` with the options " +
      "object replaced by `{}`, and `'cardinal'` is that constructor's default — so the mutant " +
      'is the same program. It is written out in the source precisely because it is a default ' +
      "worth stating (the other kind, `'ordinal'`, selects different categories for the same " +
      'language and would be a bug with no symptom in English). There is no observable ' +
      'difference for a test to assert on, and anything that appeared to kill it would be ' +
      "asserting on Intl's defaults rather than on this function.",
  },
};

// ---------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------

function readJson(relative) {
  return JSON.parse(readFileSync(join(repoRoot, relative), 'utf8'));
}

/**
 * The score, computed here rather than read from the report.
 *
 * This is the formula `mutation-testing-metrics` uses, restated so the gate's arithmetic
 * is in the gate: detected over valid, where `CompileError` and `RuntimeError` are
 * *invalid* and appear in neither. Restating it is deliberate — reason 4 in the header is
 * precisely that those two statuses leave the denominator, and a gate that read a
 * pre-computed number could not notice them going.
 */
export function scoreOf(mutants) {
  const count = (...statuses) => mutants.filter((m) => statuses.includes(m.status)).length;
  const detected = count('Killed', 'Timeout');
  const undetected = count('Survived', 'NoCoverage');
  const valid = detected + undetected;
  return {
    detected,
    undetected,
    invalid: count('CompileError', 'RuntimeError'),
    ignored: count('Ignored'),
    timeout: count('Timeout'),
    survived: count('Survived'),
    noCoverage: count('NoCoverage'),
    total: mutants.length,
    score: valid === 0 ? null : (detected / valid) * 100,
  };
}

// ---------------------------------------------------------------------------------------
// The rules. Pure functions of the parsed config, report and floor table, so `--self-test`
// can drive each one against the failure it names without a mutation run.
// ---------------------------------------------------------------------------------------

/** `concurrency` above 1 makes the score non-deterministic. See the header. */
export function checkConcurrency(config) {
  if (config.concurrency === 1) return [];
  return [
    `${CONFIG}: concurrency is ${JSON.stringify(config.concurrency)}, must be 1. ` +
      'Above 1 this stack reports false survivors non-deterministically; see docs/mutation-testing.md.',
  ];
}

/**
 * Every `mutate` entry is a literal path to one `.ts` file.
 *
 * This is what makes the two rules below sound rather than accidentally sound: both
 * compare `mutate` entries against report keys and table keys as strings, and a glob
 * matches neither. Stryker is happy with `src/app/core/**\/*.ts`, which would silently
 * turn "every scoped file produced mutants" into a rule about a path that never appears.
 * A mutation range postfix (`file.ts:12-30`) is refused for the same reason, and because
 * it is a way to narrow what is mutated that leaves the file list looking untouched.
 */
export function checkScopeIsLiteralPaths(config) {
  return (config.mutate ?? [])
    .filter((path) => !/^[\w./-]+\.ts$/.test(path))
    .map(
      (path) =>
        `${CONFIG}: mutate entry "${path}" is not a literal path to a .ts file. ` +
        'Globs and mutation ranges are refused here — the floors are per file and are matched by path.'
    );
}

/**
 * The scope and the table are the same set of files.
 *
 * Both directions matter and they fail differently. A file in `mutate` with no row has no
 * floor, so it can rot freely. A row with no `mutate` entry is a floor on a file nobody
 * mutates, which is the shape reason 1 leaves behind.
 */
export function checkScopePinned(config, floors) {
  const scope = new Set(config.mutate ?? []);
  const table = new Set(Object.keys(floors));
  const problems = [];
  for (const path of scope) {
    if (!table.has(path)) {
      problems.push(
        `${CONFIG}: "${path}" is mutated but has no row in FLOORS, so nothing holds it to a score.`
      );
    }
  }
  for (const path of table) {
    if (!scope.has(path)) {
      problems.push(
        `FLOORS has a row for "${path}", which is not in ${CONFIG}'s mutate list. ` +
          'Dropping a file from the scope raises the aggregate score; put it back or delete the row deliberately.'
      );
    }
  }
  return problems;
}

/**
 * Every scoped file actually produced mutants.
 *
 * This is reason 2. A `mutate` entry that matches nothing is absent from the report, and
 * absence reads exactly like a file that was never in scope.
 */
export function checkEveryScopedFileWasMutated(config, report) {
  const scored = new Set(Object.keys(report.files ?? {}));
  return (config.mutate ?? [])
    .filter((path) => !scored.has(path))
    .map(
      (path) =>
        `${CONFIG}: "${path}" is in the mutate list but produced no mutants. ` +
        'A glob that matches nothing is not an error in Stryker — check the path still exists.'
    );
}

/** Per-file score and mutant-count floors. Reasons 3 and 4. */
export function checkFloors(report, floors) {
  const problems = [];
  for (const [path, floor] of Object.entries(floors)) {
    const file = report.files?.[path];
    if (!file) continue; // reported by checkEveryScopedFileWasMutated
    const measured = scoreOf(file.mutants);

    if (measured.score === null) {
      problems.push(`${path}: no scorable mutants (${measured.total} produced, all invalid or ignored).`);
      continue;
    }
    if (measured.score + 1e-9 < floor.score) {
      const names = file.mutants
        .filter((m) => m.status === 'Survived' || m.status === 'NoCoverage')
        .map((m) => `      ${m.status} ${m.mutatorName} at line ${m.location.start.line}: ${m.replacement}`)
        .join('\n');
      problems.push(
        `${path}: mutation score ${measured.score.toFixed(2)}% is below its floor of ${floor.score}%.\n` +
          `    ${measured.survived} survived, ${measured.noCoverage} uncovered, of ${measured.total} mutants:\n${names}`
      );
    }
    if (measured.total < floor.mutants) {
      problems.push(
        `${path}: produced ${measured.total} mutants, floor is ${floor.mutants}. ` +
          'Fewer mutants means less was checked, and a shrinking denominator raises the score.'
      );
    }
    // A `Timeout` counts as *detected*, so it is the one status that can raise a score
    // without an assertion having objected to anything — and it has two causes that look
    // identical in the report.
    //
    // Sometimes it is real: a mutant that makes a loop or a poll never finish hangs the
    // spec, and hanging is a perfectly good way for a test to notice. `idle-countdown.ts`
    // has exactly one of those.
    //
    // Sometimes it is the allowance being wrong. Stryker's is `netTime * timeoutFactor +
    // timeoutMS`, and `netTime` counts only time spent *inside* the tests — 5.9s here
    // against 15.4s of karma round trip — so the default `timeoutMS: 5000` scored every
    // mutant needing a full-suite run as killed. See `timeoutMS` in `stryker.conf.json`.
    //
    // The report cannot tell them apart, so the floor row declares how many it expects and
    // owes a `why` naming each. More than declared fails; fewer passes, because a mutant
    // that graduated from hanging to being asserted against is an improvement.
    if (measured.timeout > (floor.timeouts ?? 0)) {
      problems.push(
        `${path}: ${measured.timeout} mutant(s) ended in Timeout, the row declares ` +
          `${floor.timeouts ?? 0}. A Timeout counts as detected, so an undeclared one raises the ` +
          'score for free. Check whether the mutant really hangs or whether `timeoutMS` is too low.'
      );
    }
    if (measured.invalid > 0) {
      problems.push(
        `${path}: ${measured.invalid} mutant(s) ended in CompileError/RuntimeError. ` +
          'Those are left out of the score entirely, so they hide rather than fail.'
      );
    }
    // `Ignored` is the cheapest hole of all and the mutant-count floor cannot see it: the
    // mutant is still produced and still counted in `total`, it just appears in neither
    // half of the score. One `// Stryker disable next-line all` above a survivor, or
    // `ignoreStatic: true` in the config, turns a red gate green with no number moving.
    // An equivalent mutant is handled by a floor below 100 carrying a `why`, which is a
    // diff a reviewer reads; a disable comment is one nobody will ever look at again.
    if (measured.ignored > 0) {
      problems.push(
        `${path}: ${measured.ignored} mutant(s) are Ignored, so they count towards neither ` +
          'half of the score. Remove the `// Stryker disable` comment (or `ignoreStatic`); if the ' +
          'mutant is genuinely equivalent, lower this row to the measured score and say so in its `why`.'
      );
    }
  }
  return problems;
}

/**
 * A floor that concedes something has to say what, so conceding is an argument and not an
 * edit. Two things count as conceding: a score below 100, and a declared timeout — both
 * are a mutant that no assertion objected to, recorded as acceptable.
 */
export function checkLoweredFloorsAreJustified(floors) {
  return Object.entries(floors)
    .filter(([, floor]) => (floor.score < 100 || (floor.timeouts ?? 0) > 0) && !(floor.why ?? '').trim())
    .map(
      ([path]) =>
        `FLOORS["${path}"]: a score floor below 100, or a declared timeout, needs a "why". ` +
        'Never lower a floor to turn a red build green — if the mutant is genuinely not worth killing, or genuinely hangs, say so here.'
    );
}

/**
 * The report is not older than the code it graded.
 *
 * `mtimeMs` rather than content hashing: the failure this names is a local edit-then-check
 * loop, where the file was written after the report and the timestamps are exactly the
 * evidence. On a pull request the report is minutes old and every source file is older.
 */
export function checkReportIsFresh(report, reportMtimeMs, sourceMtimeMs) {
  return Object.keys(report.files ?? {})
    .filter((path) => (sourceMtimeMs[path] ?? 0) > reportMtimeMs)
    .map(
      (path) =>
        `${path} was modified after ${REPORT} was written, so the report grades the previous version. ` +
        'Re-run `pnpm mutation`.'
    );
}

/**
 * The workflow runs the mutation run *and* this gate.
 *
 * `thresholds.break` is 0, which puts the whole decision in this script. A job that runs
 * Stryker and not this gate therefore passes on any score at all, which is a greener
 * version of having no gate. Same reasoning as the `check:*` resolution in
 * `assert-owasp-checklist.mjs`.
 */
export function checkWorkflowRunsBoth(workflowText) {
  const problems = [];
  if (!/pnpm\s+mutation\b/.test(workflowText)) {
    problems.push(`${WORKFLOW}: nothing runs \`pnpm mutation\`, so no mutation report is produced.`);
  }
  if (!/pnpm\s+check:mutation\b/.test(workflowText)) {
    problems.push(
      `${WORKFLOW}: nothing runs \`pnpm check:mutation\`. ` +
        'Stryker is configured with `thresholds.break: 0`, so without this gate the job passes on any score.'
    );
  }
  return problems;
}

/**
 * The only test excluded from the run is the one that is written up as excluded.
 *
 * `ignorePatterns` decides what reaches the sandbox, so an entry naming a spec file
 * removes it from the suite the mutants are run against — which lowers the bar for every
 * mutant those specs would have killed, invisibly, from a list that otherwise reads as
 * "directories not worth copying". One entry there is deliberate and explained in
 * `docs/mutation-testing.md`; this rule is what stops it becoming a habit.
 *
 * Excluding a spec is never the right response to a survivor, and this is the pattern it
 * would take.
 */
const EXCLUDED_SPECS = ['src/app/core/vitals/subscribe-web-vitals.spec.ts'];

export function checkOnlyDocumentedSpecsAreExcluded(config) {
  return (config.ignorePatterns ?? [])
    .filter((pattern) => /\.spec\.ts$|\bspec\b|\.spec\./.test(pattern))
    .filter((pattern) => !EXCLUDED_SPECS.includes(pattern))
    .map(
      (pattern) =>
        `${CONFIG}: ignorePatterns excludes "${pattern}" from the sandbox, which removes tests ` +
        'from the suite the mutants face. Only the exclusion documented in docs/mutation-testing.md ' +
        'is allowed; add it to EXCLUDED_SPECS with a reason, or kill the mutant properly.'
    );
}

/**
 * The karma worker is recycled, because it degrades as the run proceeds.
 *
 * Measured on a 29-mutant run with this unset: mutants 0–18 came back `Killed` and 19–28
 * almost all `Timeout`, with the worker at 5.5GB resident. The verdicts cluster by
 * *position in the run*, not by which mutant it was — the same mutants had been reported
 * `Killed` in earlier, shorter runs. A `Timeout` counts as detected, so the shape of that
 * failure is a score that stays respectable while the back half of the run stops being
 * measured at all.
 *
 * **How long a worker lasts depends on the machine.** At `15` on a 2-core GitHub runner the
 * second worker killed nine mutants and then reported all five of `plural.ts`'s as
 * `Survived` — degradation at its tenth mutant, against beyond its twenty-fourth on a
 * 4-core box with 16GB. So the bound here is well below the worst case observed, and a
 * smaller value is always the safer direction: it costs one rebuild and cannot improve a
 * score.
 *
 * `0` means infinite reuse, which is Stryker's default and the setting that produced the
 * first measurement above, so this rule refuses it as well as refusing a value past the
 * cap.
 */
const MAX_TEST_RUNNER_REUSE = 8;

export function checkTestRunnerIsRecycled(config) {
  const reuse = config.maxTestRunnerReuse;
  if (typeof reuse === 'number' && reuse > 0 && reuse <= MAX_TEST_RUNNER_REUSE) return [];
  return [
    `${CONFIG}: maxTestRunnerReuse is ${JSON.stringify(reuse)}, must be between 1 and ${MAX_TEST_RUNNER_REUSE}. ` +
      '0 (Stryker\'s default) means infinite reuse, and the karma worker degrades long before the end of a ' +
      'run: late mutants time out spuriously, which counts as detected. See docs/mutation-testing.md.',
  ];
}

/** `thresholds.break` is 0 on purpose, and this gate is the reason. */
export function checkBreakIsDelegated(config) {
  if (config.thresholds?.break === 0) return [];
  return [
    `${CONFIG}: thresholds.break is ${JSON.stringify(config.thresholds?.break)}, expected 0. ` +
      'Two thresholds in two places drift; the per-file floors in this gate are the threshold.',
  ];
}

// ---------------------------------------------------------------------------------------
// Self-tests: every rule driven against the failure it names.
// ---------------------------------------------------------------------------------------

const mutant = (status, line = 1) => ({
  status,
  mutatorName: 'ConditionalExpression',
  replacement: 'true',
  location: { start: { line, column: 1 }, end: { line, column: 9 } },
});

const okConfig = () => ({
  concurrency: 1,
  mutate: ['src/a.ts'],
  thresholds: { break: 0 },
});
const okReport = () => ({ files: { 'src/a.ts': { mutants: [mutant('Killed'), mutant('Killed')] } } });
const okFloors = () => ({ 'src/a.ts': { score: 100, mutants: 2 } });

const SELF_TESTS = [
  // scoreOf restates Stryker's formula; these pin the two halves that matter.
  ['score counts timeouts as detected', () => scoreOf([mutant('Killed'), mutant('Timeout')]).score === 100],
  ['score counts uncovered mutants against you', () => scoreOf([mutant('Killed'), mutant('NoCoverage')]).score === 50],
  [
    'score leaves compile errors out of the denominator',
    () => scoreOf([mutant('Killed'), mutant('CompileError')]).score === 100 && scoreOf([mutant('Killed'), mutant('CompileError')]).invalid === 1,
  ],
  ['score is null when nothing is scorable', () => scoreOf([mutant('CompileError')]).score === null],

  ['concurrency 1 passes', () => checkConcurrency({ concurrency: 1 }).length === 0],
  ['concurrency 2 fails', () => checkConcurrency({ concurrency: 2 }).length === 1],
  ['missing concurrency fails', () => checkConcurrency({}).length === 1],

  ['a literal .ts path passes', () => checkScopeIsLiteralPaths(okConfig()).length === 0],
  [
    'a glob in the mutate list fails',
    () => checkScopeIsLiteralPaths({ ...okConfig(), mutate: ['src/app/**/*.ts'] }).length === 1,
  ],
  [
    'a mutation range fails',
    () => checkScopeIsLiteralPaths({ ...okConfig(), mutate: ['src/a.ts:1:3-1:5'] }).length === 1,
  ],
  [
    'a non-TypeScript path fails',
    () => checkScopeIsLiteralPaths({ ...okConfig(), mutate: ['src/a.html'] }).length === 1,
  ],

  ['a pinned scope passes', () => checkScopePinned(okConfig(), okFloors()).length === 0],
  [
    'a mutated file with no floor fails',
    () => checkScopePinned({ ...okConfig(), mutate: ['src/a.ts', 'src/b.ts'] }, okFloors()).length === 1,
  ],
  [
    'dropping a file from the scope fails',
    () => checkScopePinned({ ...okConfig(), mutate: [] }, okFloors()).length === 1,
  ],

  ['a file that produced mutants passes', () => checkEveryScopedFileWasMutated(okConfig(), okReport()).length === 0],
  [
    'a glob that matched nothing fails',
    () => checkEveryScopedFileWasMutated({ ...okConfig(), mutate: ['src/gone.ts'] }, okReport()).length === 1,
  ],

  ['a file at its floor passes', () => checkFloors(okReport(), okFloors()).length === 0],
  [
    'a file below its floor fails',
    () =>
      checkFloors(
        { files: { 'src/a.ts': { mutants: [mutant('Killed'), mutant('Survived')] } } },
        okFloors()
      ).some((p) => p.includes('below its floor')),
  ],
  [
    'a file that lost mutants fails even at 100%',
    () =>
      checkFloors({ files: { 'src/a.ts': { mutants: [mutant('Killed')] } } }, okFloors()).some((p) =>
        p.includes('floor is 2')
      ),
  ],
  [
    'mutants that failed to build fail rather than vanish',
    () =>
      checkFloors(
        { files: { 'src/a.ts': { mutants: [mutant('Killed'), mutant('Killed'), mutant('CompileError')] } } },
        okFloors()
      ).some((p) => p.includes('CompileError')),
  ],
  [
    'an undeclared timeout fails rather than counting as detected',
    () =>
      checkFloors(
        { files: { 'src/a.ts': { mutants: [mutant('Killed'), mutant('Timeout')] } } },
        { 'src/a.ts': { score: 100, mutants: 2 } }
      ).some((p) => p.includes('Timeout')),
  ],
  [
    'a declared timeout passes',
    () =>
      checkFloors(
        { files: { 'src/a.ts': { mutants: [mutant('Killed'), mutant('Timeout')] } } },
        { 'src/a.ts': { score: 100, mutants: 2, timeouts: 1, why: 'it really hangs' } }
      ).length === 0,
  ],
  [
    'one more timeout than declared fails',
    () =>
      checkFloors(
        { files: { 'src/a.ts': { mutants: [mutant('Timeout'), mutant('Timeout')] } } },
        { 'src/a.ts': { score: 100, mutants: 2, timeouts: 1, why: 'one hangs' } }
      ).some((p) => p.includes('Timeout')),
  ],
  [
    'fewer timeouts than declared is an improvement and passes',
    () =>
      checkFloors(
        { files: { 'src/a.ts': { mutants: [mutant('Killed'), mutant('Killed')] } } },
        { 'src/a.ts': { score: 100, mutants: 2, timeouts: 1, why: 'one hangs' } }
      ).length === 0,
  ],
  [
    'a declared timeout still needs a reason',
    () => checkLoweredFloorsAreJustified({ 'src/a.ts': { score: 100, mutants: 2, timeouts: 1 } }).length === 1,
  ],
  [
    'a mutant silenced with a disable comment fails rather than vanishes',
    () =>
      checkFloors(
        { files: { 'src/a.ts': { mutants: [mutant('Killed'), mutant('Killed'), mutant('Ignored')] } } },
        { 'src/a.ts': { score: 100, mutants: 3 } }
      ).some((p) => p.includes('Ignored')),
  ],
  [
    'a file with nothing scorable fails',
    () =>
      checkFloors({ files: { 'src/a.ts': { mutants: [mutant('CompileError')] } } }, okFloors()).some((p) =>
        p.includes('no scorable mutants')
      ),
  ],

  ['a floor of 100 needs no reason', () => checkLoweredFloorsAreJustified(okFloors()).length === 0],
  [
    'a lowered floor without a reason fails',
    () => checkLoweredFloorsAreJustified({ 'src/a.ts': { score: 90, mutants: 2 } }).length === 1,
  ],
  [
    'a lowered floor with a reason passes',
    () => checkLoweredFloorsAreJustified({ 'src/a.ts': { score: 90, mutants: 2, why: 'because' } }).length === 0,
  ],
  [
    'a blank reason is not a reason',
    () => checkLoweredFloorsAreJustified({ 'src/a.ts': { score: 90, mutants: 2, why: '   ' } }).length === 1,
  ],

  ['a report newer than its sources passes', () => checkReportIsFresh(okReport(), 100, { 'src/a.ts': 50 }).length === 0],
  ['a source edited after the report fails', () => checkReportIsFresh(okReport(), 100, { 'src/a.ts': 150 }).length === 1],

  [
    'a workflow running both passes',
    () => checkWorkflowRunsBoth('        run: pnpm mutation\n        run: pnpm check:mutation\n').length === 0,
  ],
  ['a workflow missing the gate fails', () => checkWorkflowRunsBoth('run: pnpm mutation\n').length === 1],
  ['a workflow missing the run fails', () => checkWorkflowRunsBoth('run: pnpm check:mutation\n').length === 1],

  [
    'the documented spec exclusion passes',
    () => checkOnlyDocumentedSpecsAreExcluded({ ignorePatterns: ['dist', ...EXCLUDED_SPECS] }).length === 0,
  ],
  [
    'excluding another spec fails',
    () =>
      checkOnlyDocumentedSpecsAreExcluded({
        ignorePatterns: [...EXCLUDED_SPECS, 'src/app/core/http/http-cache.spec.ts'],
      }).length === 1,
  ],
  [
    'excluding a whole directory of specs fails',
    () => checkOnlyDocumentedSpecsAreExcluded({ ignorePatterns: ['**/*.spec.ts'] }).length === 1,
  ],
  [
    'ordinary weight entries are not mistaken for specs',
    () =>
      checkOnlyDocumentedSpecsAreExcluded({
        ignorePatterns: ['.angular', 'dist', 'coverage', '/reports', 'e2e', 'katas', '.husky', 'docs', '.stats'],
      }).length === 0,
  ],

  ['a recycled worker passes', () => checkTestRunnerIsRecycled({ maxTestRunnerReuse: 5 }).length === 0],
  ['infinite reuse fails', () => checkTestRunnerIsRecycled({ maxTestRunnerReuse: 0 }).length === 1],
  ['an unset reuse fails', () => checkTestRunnerIsRecycled({}).length === 1],
  [
    'a reuse past where degradation was seen fails',
    () => checkTestRunnerIsRecycled({ maxTestRunnerReuse: 15 }).length === 1,
  ],

  ['break 0 passes', () => checkBreakIsDelegated({ thresholds: { break: 0 } }).length === 0],
  ['a second threshold fails', () => checkBreakIsDelegated({ thresholds: { break: 80 } }).length === 1],
];

function selfTest() {
  const failed = [];
  for (const [name, fn] of SELF_TESTS) {
    let ok = false;
    try {
      ok = fn() === true;
    } catch (error) {
      failed.push(`${name}: threw ${error.message}`);
      continue;
    }
    if (!ok) failed.push(name);
  }
  if (failed.length > 0) {
    console.error(`✗ assert-mutation-score: ${failed.length} of its own rules do not hold:\n`);
    for (const f of failed) console.error(`  - ${f}`);
    return false;
  }
  console.log(`✓ assert-mutation-score: ${SELF_TESTS.length} self-tests pass`);
  return true;
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (!selfTest()) process.exit(1);
  if (args.includes('--self-test')) return;

  const config = readJson(CONFIG);

  let report;
  let reportMtimeMs;
  try {
    report = readJson(REPORT);
    reportMtimeMs = statSync(join(repoRoot, REPORT)).mtimeMs;
  } catch {
    console.error(
      `✗ assert-mutation-score: no report at ${REPORT}. Run \`pnpm mutation\` first — this gate grades a run, it does not perform one.`
    );
    process.exit(1);
  }

  const sourceMtimeMs = {};
  for (const path of Object.keys(report.files ?? {})) {
    try {
      sourceMtimeMs[path] = statSync(join(repoRoot, path)).mtimeMs;
    } catch {
      /* a scored file that no longer exists is caught by checkScopePinned */
    }
  }
  const workflowText = readFileSync(join(repoRoot, WORKFLOW), 'utf8');

  const rows = Object.entries(FLOORS)
    .map(([path, floor]) => ({ path, floor, measured: scoreOf(report.files?.[path]?.mutants ?? []) }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const width = Math.max(...rows.map((r) => r.path.length), 4);
  console.log(`\n  ${'file'.padEnd(width)}  score   floor  mutants  survived`);
  for (const { path, floor, measured } of rows) {
    const score = measured.score === null ? '  n/a' : `${measured.score.toFixed(2).padStart(6)}%`;
    console.log(
      `  ${path.padEnd(width)} ${score}  ${String(floor.score).padStart(5)}%  ` +
        `${String(measured.total).padStart(7)}  ${String(measured.survived + measured.noCoverage).padStart(8)}`
    );
  }
  const overall = scoreOf(Object.values(report.files ?? {}).flatMap((f) => f.mutants));
  console.log(
    `\n  all files: ${overall.score === null ? 'n/a' : `${overall.score.toFixed(2)}%`} ` +
      `(${overall.detected} detected, ${overall.survived} survived, ${overall.noCoverage} uncovered, ` +
      `${overall.invalid} invalid, of ${overall.total} mutants)\n`
  );

  if (args.includes('--print')) return;

  const rules = [
    () => checkConcurrency(config),
    () => checkScopeIsLiteralPaths(config),
    () => checkScopePinned(config, FLOORS),
    () => checkEveryScopedFileWasMutated(config, report),
    () => checkFloors(report, FLOORS),
    () => checkLoweredFloorsAreJustified(FLOORS),
    () => checkReportIsFresh(report, reportMtimeMs, sourceMtimeMs),
    () => checkWorkflowRunsBoth(workflowText),
    () => checkOnlyDocumentedSpecsAreExcluded(config),
    () => checkTestRunnerIsRecycled(config),
    () => checkBreakIsDelegated(config),
  ];
  const problems = rules.flatMap((rule) => rule());

  if (problems.length > 0) {
    console.error(`✗ assert-mutation-score: ${problems.length} problem(s)\n`);
    for (const problem of problems) console.error(`  - ${problem}\n`);
    console.error(
      'A surviving mutant is a change to the source that no test objected to. Kill it by asserting the\n' +
        'behaviour it changed — never by deleting the mutant from the scope or lowering its floor.\n' +
        'docs/mutation-testing.md has the per-file history and what each floor below 100 is for.'
    );
    process.exit(1);
  }

  console.log(
    `✓ assert-mutation-score: ${rows.length} file(s) at or above their floors, ${rules.length} rules checked.`
  );
}

main();
