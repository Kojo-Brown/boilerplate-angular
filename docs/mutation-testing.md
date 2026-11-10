# Mutation testing

This suite runs 97.17% of the statements in `src/`. That number has stopped being
interesting. It says every line was reached by something; it does not say anything about
whether a test would notice if the line changed, and those are different questions with
different answers. `karma.conf.js`'s coverage thresholds can be satisfied by a spec that
calls a function and asserts nothing.

Mutation testing asks the second question directly: change the code, and see whether the
suite objects. Stryker compiles a copy of the project with every mutation behind a runtime
switch, then for each mutation runs the tests that cover it. A mutant that survives is a
change to the source that no assertion refused — either a test that is not asserting what
it looks like it asserts, or behaviour nothing pins at all.

```
pnpm mutation        # run Stryker, write reports/mutation/{mutation.json,mutation.html}
pnpm check:mutation  # hold every file to its floor; this is the gate
```

Both run in the `mutation` CI job and both block a merge.

## What is in scope, and why not everything

`stryker.conf.json`'s `mutate` list is deliberately short. The scope is pure-logic modules
under `src/app/core/` — decisions over values, no templates, no DOM. Two reasons, and the
second is the one that decided it.

**Mutants in a template or a component are mostly noise.** Stryker mutates string literals
and conditionals wherever it finds them, and a component's class is full of both for
reasons that have nothing to do with behaviour: a `class` attribute, an `aria-label`, a
`@if` guarding presentation. Killing those mutants means asserting on markup, which is how
a suite comes to break every time anybody touches a style.

**The run is expensive and the cost is per mutant.** See [Cost](#cost). A scope that takes
an hour gets disabled; a scope that takes ten minutes gets fixed.

So the scope is the part of the codebase where a surviving mutant is nearly always a real
gap. Adding a file to `mutate` requires adding a row to `FLOORS` in
`scripts/ci/assert-mutation-score.mjs` — the gate fails if the two disagree, in either
direction — so the scope cannot drift from the thing holding it to a number.

## Why the threshold is a separate gate

Stryker can fail its own run: `thresholds.break` exits non-zero below a score. It is set to
**0** here, which is not "no threshold" — it is the threshold living in one place instead of
two. `assert-mutation-score.mjs` owns it.

The reason is that `thresholds.break` is one number over the whole run, and **every cheap
way to make a mutation score go up makes that number go up too**:

1. **Drop a file from `mutate`.** The weakest file is the one holding the aggregate down, so
   removing it *raises* the score. A gate on the aggregate does not merely miss this, it
   rewards it. One line in a config file, and `pnpm test` stays green.
2. **Keep the file and lose the glob.** A `mutate` entry that matches nothing produces no
   mutants and no error. Rename a file, leave the entry pointing at the old path, and
   Stryker logs `Found 9 of 338 files to be mutated` — a line nobody reads — then scores the
   nine.
3. **Let one file rot.** With several hundred mutants over ten files, a file can go from
   100% to 0% and move the aggregate by a few points. Rot is per file, so a floor has to be
   per file or it is measuring the other nine.
4. **Make mutants fail to build.** `CompileError` and `RuntimeError` mutants are *invalid*
   in the report schema and appear in neither half of
   `detected / (detected + survived + noCoverage)`. A change that stops mutants compiling in
   the sandbox deletes them from the sum rather than failing it.

Hence the shape of the gate: a floor per file, each paired with a **mutant count** so a
file that stopped being mutated has no ratio to pass with, the `mutate` list pinned against
the table, and any floor below 100 required to carry a `why`. The last one cannot stop
somebody editing a number, but it makes the edit arrive with a sentence a reviewer can
disagree with.

The gate also fails if `ci.yml` stops running either half. With `thresholds.break: 0`, a job
that runs Stryker and not the gate passes on any score at all, which is a greener version
of having no gate — the same reasoning as the `check:*` resolution in
`assert-owasp-checklist.mjs`.

## `concurrency` is 1, and it is not a tuning knob

**With more than one test-runner process this stack reports false survivors,
non-deterministically.** Measured on one 24-mutant file, four runs each:

| `concurrency` | results |
| --- | --- |
| 1 | 24 killed, 24 killed, 24 killed, 24 killed |
| 2 | 24 killed, 24 killed, **13 killed / 11 survived**, **12 killed / 12 survived** |

The eleven "survivors" in that third run were not survivors. Each was confirmed killed by
re-running the same file under `coverageAnalysis: "off"`, which runs the whole suite per
mutant and does no test selection. One was confirmed by hand: applying
`whileCounting`'s `countdown.status === 'expired' ? …` → `true ? …` mutation to the real
source fails six specs in `provide-idle-session.spec.ts` under plain `pnpm test`.

What makes it a false survivor rather than a missed test is that the selection was right:
the report's own `coveredBy` list for that mutant contains the spec that kills it, and the
clear-text reporter printed that spec under "Tests ran". The right tests were chosen, were
reported as executed, and did not fail — so the mutant was not active while they ran.
Beyond that the cause is not isolated. The workers share one sandbox and one `.angular/cache`
inside it, which is the obvious suspect and is not proof.

So it is pinned, and `assert-mutation-score.mjs` fails if it is raised. A false survivor is
the worst failure available to a merge gate: the score drops with nothing wrong in the
source, it is indistinguishable from a real gap, and the honest response to one is to go and
write a test that was never missing. Raising `concurrency` is not safe until somebody roots
this out; the payoff would be real, because the run is long.

## Cost

Roughly twenty minutes, in its own job, holding a browser for all of it. The shape of that
number matters more than the number:

- **~2 minutes of setup.** Stryker copies the project into a sandbox and `ng test` builds it
  once. `ignorePatterns` keeps the copy to 338 files instead of 1213, which is most of what
  can be done about this half.
- **~2s per ordinary mutant.** Only the specs that cover the mutant run, so this is a
  handful of specs plus a Karma round trip, and the round trip dominates.
- **~12s per *static* mutant**, of which there are 71 — 19% of the mutants and the majority
  of the wall clock. A static mutant is one Stryker saw execute during module evaluation
  rather than inside a test: a module-level table, a `const` built at import time. Per-test
  coverage cannot narrow those, because every test loaded the module, so Stryker runs the
  entire suite for each one.

Stryker's own advice when it detects them is to set `ignoreStatic: true`. **Don't**, and the
gate will not let you: that does not make those mutants cheap, it marks them `Ignored` and
removes them from the score — 71 unchecked mutants and a number that goes up. The gate fails
on any `Ignored` mutant for the same reason it fails on a `CompileError` one, and a
`// Stryker disable` comment above an awkward survivor is the same move at a smaller scale.
If the job has to get faster, the honest lever is the `mutate` list, with the floor table
changing in the same diff.

`coverageAnalysis` is `perTest` for that 6× difference. `"all"` and `"off"` are both correct
here and both run the whole suite per mutant; they are what to fall back to if `perTest` is
ever in doubt, at roughly four times the cost.

## One spec is excluded from the run

`ignorePatterns` ends with `src/app/core/vitals/subscribe-web-vitals.spec.ts`. That is the
only entry in the list that removes a **test** rather than weight, and the gate pins it for
that reason.

Those three specs are the one place `web-vitals` is exercised for real — a dynamic
`import()` of a lazy chunk, against live `PerformanceObserver` timing. Driven through
Stryker's karma runner they fail intermittently, and the failure is in the dry run, so it
takes the whole job with it rather than one mutant. It presents as
`An error was thrown in afterAll` naming an expectation that "ran after it finished": the
spec is abandoned and the awaited `expectAsync` settles afterwards. It is not a timeout —
it reproduces with the spec timeout raised to 90s, failing 26 seconds into a run — and it is
not caused by `ignorePatterns`, which was tested by removing it. Six dry runs were attempted
with the file in the sandbox and five of them failed; four in a row have succeeded with it
excluded.

What it costs: nothing in the current scope, since no module in `mutate` is reachable from
those specs, and the direction of error is safe — a mutant that only an excluded spec would
kill shows up as a *survivor*, so it argues for attention rather than hiding. What it would
cost is a scope that reached `core/vitals/`, which is why the exclusion is one named file
and not a directory.

The same investigation found a real defect in the suite's own configuration, now fixed in
`src/testing/test-main.ts`: the 10s spec timeout lived in `karma.conf.js`'s `client.jasmine`
block, and a runner that drives this suite through its own karma configuration **replaces**
`client` rather than merging into it. Under Stryker every spec silently got Jasmine's 5s
default instead. The timeout now lives in the suite's entry point, where every runner sees
it. `random: true` is still replaced the same way — Stryker needs a deterministic order —
so the mutation run does not exercise the spec-order independence the normal run does.

## Reading a survivor

`reports/mutation/mutation.html` is the only view that shows a mutant in its source
context, and it is uploaded as a CI artifact on every run including failures. The gate's
own output lists each survivor as mutator, line and replacement, which is usually enough.

A survivor is a question: *if I made this change for real, what should have broken?* The
answers, in the order they turn up:

- **The assertion is weaker than it looks.** `expect(result).toBeTruthy()` on an object
  that is always truthy. Half a boundary tested — "one millisecond short is still running"
  passes against a function that does nothing, which is a finding the kata already recorded
  for `settledAt`. The fix is a real assertion.
- **The behaviour is genuinely unpinned.** No test ever passes the value that makes the
  branch matter. The fix is a test.
- **The mutant is equivalent.** Two spellings of the same behaviour, so nothing can tell
  them apart and nothing should try. This is the one case where a floor below 100 is
  honest — put the reason in the row's `why` and name the mutant.

What a survivor never justifies is removing its file from `mutate` or lowering its floor to
clear the gate. That is the specific move `CLAUDE.md` names first, and it is also
self-defeating: the floors exist because the aggregate rewards it.

## Per-file floors

The measured scores at the time each row was written. `assert-mutation-score.mjs` holds each
file to both numbers; `pnpm check:mutation --print` prints measured against floor without
failing.
