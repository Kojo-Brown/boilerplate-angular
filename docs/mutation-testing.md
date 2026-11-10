# Mutation testing

This suite runs 97.17% of the statements in `src/`. That number has stopped being
interesting. It says every line was reached by something; it does not say whether a test
would notice if the line changed, and those are different questions with different answers.
`karma.conf.js`'s coverage thresholds are satisfied by a spec that calls a function and
asserts nothing.

Mutation testing asks the second question directly: change the code, and see whether the
suite objects. Stryker compiles a copy of the project with every mutation behind a runtime
switch, then for each mutation runs the tests that cover it. A mutant that survives is a
change to the source that no assertion refused — either a test that is not asserting what it
appears to assert, or behaviour nothing pins at all.

```
pnpm mutation        # run Stryker, write reports/mutation/{mutation.json,mutation.html}
pnpm check:mutation  # hold every file to its floor; this is the gate
```

Both run in the `mutation` CI job and both block a merge. The current run is **one module,
24 mutants, 100%**, in about four minutes.

## Per-file floors

| File | Score | Mutants | Notes |
| --- | --- | --- | --- |
| `core/auth/idle-session/idle-countdown.ts` | 100% | 24 | The TDD kata's subject. |

`FLOORS` in `scripts/ci/assert-mutation-score.mjs` is the authority; the table above is a
copy for readers. `pnpm check:mutation --print` shows measured against floor without
failing.

**One module is a deliberately small start, and the reason is the reproducibility problem
below rather than taste.** This is the one file whose mutation score has been measured to be
the same on two different machines. Extending the scope means establishing that for each new
file, which is work, not a config edit — and the gate makes the floor table change in the
same diff either way.

## What is in scope, and why it is small

Two modules, both self-contained decisions over values: no templates, no DOM, no Angular.
That is much less than is worth mutating, and the reason is cost rather than taste — the
section below has the measurements. Three things were tried and dropped:

- **Components and templates.** Stryker mutates string literals and conditionals wherever it
  finds them, and a component class is full of both for reasons that have nothing to do with
  behaviour: a `class` attribute, an `aria-label`, an `@if` guarding presentation. Killing
  those mutants means asserting on markup, which is how a suite comes to break whenever
  anybody touches a style.
- **Modules that are mostly a module-level table** — `error-messages.ts`,
  `api-error-mappers.ts`, `csrf.ts`. Their mutants are *static* (see below) and cost roughly
  twenty times an ordinary one.
- **`typed-form.ts`.** Five of the first twenty-five mutants in a three-module run timed out,
  and the cause was never established before it was dropped on cost. Its only loop is a
  bounded `for (const key of Object.keys(specs))`, so an infinite loop is not an obvious
  explanation. It is out for cost, not because anything about it was proven.
- **`plural.ts`, and this is the one that matters.** It measured **80% locally and 0% on a
  GitHub runner** — four of its five mutants changed verdict between machines. Its specs are
  ordinary and pass everywhere; it is the *measurement* that is not reproducible, not the
  module. It is out until that is understood, and it is the concrete lead for anyone picking
  this up: same config, same commit, two machines, four mutants flipping.

Adding a file to `mutate` requires adding a row to `FLOORS` — the gate fails if the two
disagree, in either direction — so the scope cannot drift from the thing holding it to a
number. It also requires budgeting the time, honestly: see the cost model.

## Why the threshold is a separate gate

Stryker can fail its own run: `thresholds.break` exits non-zero below a score. It is set to
**0** here, which is not "no threshold" — it is the threshold living in one place instead of
two. `assert-mutation-score.mjs` owns it.

The reason is that `thresholds.break` is one number over the whole run, and **every cheap way
to make a mutation score go up makes that number go up too**:

1. **Drop a file from `mutate`.** The weakest file is the one holding the aggregate down, so
   removing it *raises* the score. A gate on the aggregate does not merely miss this, it
   rewards it. One line in a config file, and `pnpm test` stays green.
2. **Keep the file and lose the glob.** A `mutate` entry that matches nothing produces no
   mutants and no error. Rename a file, leave the entry pointing at the old path, and Stryker
   logs `Found 1 of 337 files to be mutated` — a line nobody reads — then scores the one.
3. **Let one file rot.** Rot is per file, and a file can go to 0% while the aggregate moves a
   few points, so a floor has to be per file or it is measuring the other files.
4. **Move mutants out of the score.** `CompileError`, `RuntimeError`, `Ignored` and
   `NoCoverage` all leave `detected / (detected + survived + noCoverage)` or land in the
   denominator only. One `// Stryker disable next-line all` above an awkward survivor, or
   `ignoreStatic: true` in the config, turns a red gate green with no number moving.
5. **Let a mutant be killed by the clock.** A `Timeout` counts as *detected*. The section on
   worker degradation below is a worked example of a 100% score where ten mutants were not
   measured at all.

So the floors are per file, each paired with a **mutant count** (a file that stopped being
mutated has no ratio to fail with), the `mutate` list is pinned against the table and
required to be literal `.ts` paths, `Ignored` and invalid mutants are refused outright, and
any floor below 100 must carry a `why`. The gate also fails if `ci.yml` stops running either
half, since with `thresholds.break: 0` a job that runs Stryker and not the gate passes on any
score at all. Forty-six self-tests drive each rule against the failure it names
(`pnpm check:mutation` runs them before it certifies anything).

## The two settings that are not tuning knobs

Both of these were found by measurement, both produce a *greener* result when wrong, and
`assert-mutation-score.mjs` fails if either is changed.

### `maxTestRunnerReuse: 15`

**The karma worker's verdicts depend on how long it has been alive, and both directions
hurt.** Three measurements:

| Setting | Local (4 cores, 16GB) | GitHub runner (2 cores) |
| --- | --- | --- |
| unset (infinite reuse) | mutants 0–18 `Killed`, 19–28 almost all `Timeout`; worker at 5.5GB | not measured |
| **15** | `idle-countdown.ts` **100% / 24** | `idle-countdown.ts` **100% / 24** |
| 5 | survivors and timeouts by the 13th mutant | `idle-countdown.ts` **20.83%** |

Unset, the verdicts cluster by *position in the run* rather than by which mutant it was —
the same mutants were reported `Killed` in earlier, shorter runs. A `Timeout` counts as
detected, so the run still reported 100% with ten mutants unmeasured, which is the worst
shape this failure can take.

Restarting *more* often is not the safe direction, which is the counter-intuitive part and
the reason this is pinned rather than tuned: at 5 both machines got dramatically worse. Why
is not understood. 15 is simply the only value measured to give the same answer twice on
different hardware, and `assert-mutation-score.mjs` refuses `0` and anything above 18.

### `concurrency: 1`

**With more than one test-runner process the run reports false survivors**,
non-deterministically. Measured on one 24-mutant file, four runs each:

| `concurrency` | results |
| --- | --- |
| 1 | 24 killed ×4 |
| 2 | 24 killed ×2, **13 killed / 11 survived**, **12 killed / 12 survived** |

Those eleven "survivors" were not survivors. Each was confirmed killed by re-running under
`coverageAnalysis: "off"`, which runs the whole suite per mutant and does no test selection.
One was confirmed by hand: applying `whileCounting`'s
`countdown.status === 'expired' ? …` → `true ? …` mutation to the real source fails six specs
in `provide-idle-session.spec.ts` under plain `pnpm test`.

What makes it a false survivor rather than a missed test is that the *selection* was right —
the report's own `coveredBy` list for that mutant contains the spec that kills it, and the
clear-text reporter printed that spec under "Tests ran". The right tests were chosen, were
reported as executed, and did not fail, so the mutant was not active while they ran. Beyond
that the cause is not isolated; the workers share one sandbox and one `.angular/cache` inside
it, which is a suspect and not a proof. This is a separate fault from the degradation above,
which is what was wrong with the long runs.

## Cost

About five minutes, in its own job, holding a browser for all of it. The shape of the number
matters more than the number, because it decides what can be added to the scope:

- **~2 minutes of setup.** Stryker copies the project into a sandbox and `ng test` builds it
  once (about 90s, and up to 3 minutes from a cold `.angular/cache`). `ignorePatterns` keeps
  the copy to 337 files instead of 1213, which is most of what can be done about this half.
- **~6s per ordinary mutant.** Only the specs covering the mutant run, so this is almost
  entirely the karma round trip, not the tests. It means **mutant count is the only lever
  that matters**, and a module's cost has little to do with its size. The karma overhead is
  itself machine-dependent and not in the direction you would guess: about 15s locally
  against 2s on a GitHub runner, where the whole 1248-spec suite runs in 6 seconds.
- **~90s per *restart*.** Every 15 mutants by configuration, and additionally whenever a
  mutant run errors or times out, because with the Angular karma builder a test-runner
  restart is a full `ng test` rebuild.
- **~20s plus a restart per *static* mutant.** A static mutant is one Stryker saw execute
  during module evaluation rather than inside a test: a module-level table, a `const` built at
  import time. Per-test coverage cannot narrow those, so the whole suite runs for each one,
  and the module graph has to be reloaded. A ten-module scope with 71 static mutants did not
  finish inside 65 minutes before it was stopped. Modules that are mostly a module-level
  table are therefore the expensive ones, which is the opposite of what their size suggests.

Stryker's advice when it detects static mutants is to set `ignoreStatic: true`. **Don't**, and
the gate will not let you: that does not make them cheap, it marks them `Ignored` and removes
them from the score. If the job has to get faster, the honest lever is the `mutate` list, with
the floor table changing in the same diff.

`coverageAnalysis` is `perTest` for the per-mutant saving. `"all"` and `"off"` are both
correct here and both run the whole suite per mutant; they are what to fall back to if
`perTest` is ever in doubt, at many times the cost.

`timeoutMS` is 30s rather than the default 5s. Stryker's allowance is
`netTime * timeoutFactor + timeoutMS`, and `netTime` counts only time spent *inside* the
tests — 5.9s here against about 15s of karma round trip — so the default gives roughly 14s to
a run that costs about 21s, and every mutant needing a full-suite run timed out by
construction, scoring as detected.

## One spec is excluded from the run

`ignorePatterns` ends with `src/app/core/vitals/subscribe-web-vitals.spec.ts`. That is the
only entry in the list that removes a **test** rather than weight, and the gate pins it by
name so the exclusion cannot quietly grow into a directory.

Those three specs are the one place `web-vitals` is exercised for real — a dynamic `import()`
of a lazy chunk, against live `PerformanceObserver` timing. Driven through Stryker's karma
runner they fail intermittently, and they fail in the *dry run*, so they take the whole job
with them rather than one mutant. It presents as `An error was thrown in afterAll` naming an
expectation that "ran after it finished": the spec is abandoned and the awaited `expectAsync`
settles afterwards. It is **not** a timeout — it reproduces with the spec timeout raised to
90s, failing 26 seconds into a run — and it is not caused by `ignorePatterns`, which was
tested by removing it. Six dry runs were attempted with the file in the sandbox and five
failed; it has not failed since the file was excluded.

What it costs: nothing in the current scope, since neither mutated module is reachable from
those specs, and the direction of error is safe — a mutant only an excluded spec would kill
shows up as a *survivor*, so it argues for attention rather than hiding. What it would cost is
a scope reaching `core/vitals/`, which is why the exclusion is one named file.

### An open caveat about the spec timeout

`karma.conf.js` sets `client.jasmine.timeoutInterval: 10000`, and Stryker's karma runner
**replaces** the whole `client` object rather than merging into it, so inside the sandbox
every spec runs with Jasmine's 5s default. `random: true` is replaced the same way,
deliberately — Stryker needs a deterministic spec order — so the mutation run also does not
exercise the spec-order independence the normal run does.

The obvious fix does not work and was reverted rather than left in: moving the timeout into
`src/testing/test-main.ts` as `jasmine.getEnv().configure({ defaultTimeoutInterval: … })`
does not compile, because `defaultTimeoutInterval` is not a key of Jasmine's `Env.configure`
(the global `jasmine.DEFAULT_TIMEOUT_INTERVAL` is a separate mechanism). That mistake is
worth recording for one reason: **Stryker's sandbox adds `// @ts-nocheck` to every file it
copies**, so it compiled and ran happily for four dry runs while `pnpm test` would not
compile at all. A change verified only through a mutation run has not been verified. Run
`pnpm test`.

## Reading a survivor

`reports/mutation/mutation.html` is the only view that shows a mutant in its source context,
and it is uploaded as a CI artifact on every run including failures. The gate's own output
lists each survivor as mutator, line and replacement, which is usually enough.

A survivor is a question: *if I made this change for real, what should have broken?* The
answers, in the order they turn up:

- **The assertion is weaker than it looks.** `expect(result).toBeTruthy()` on an object that
  is always truthy. Half a boundary tested — "one millisecond short of the window is still
  running" passes against a function that does nothing, which is a finding
  `katas/idle-countdown/` already recorded for `settledAt`. The fix is a real assertion.
- **The behaviour is genuinely unpinned.** No test ever passes the value that makes the branch
  matter. The fix is a test.
- **The mutant is equivalent.** Two spellings of the same program, so nothing can tell them
  apart and nothing should try. The clearest example found here is in `plural.ts`, which is
  no longer in scope: `new Intl.PluralRules(locale, { type: 'cardinal' })` with the options
  object replaced by `{}`, where `'cardinal'` is the constructor's default, so the mutant is
  the same program. The fix for one of these is a floor below 100 and a `why` naming it.
- **The measurement is not reproducible.** Establish this before believing any of the above:
  re-run, and if possible re-run elsewhere. A hand-applied mutation under plain `pnpm test`
  is the tiebreaker and has settled every disagreement in this item so far.

What a survivor never justifies is removing its file from `mutate`, excluding a spec, or
lowering a floor without the third answer above. That is the move `CLAUDE.md` names first, and
it is also self-defeating: the floors exist because the aggregate rewards it.
