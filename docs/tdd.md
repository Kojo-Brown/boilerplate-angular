# Test-first, and the one kata that is kept

Two different things live here. The first is a position on when writing the test first is
worth it in this repository. The second is a recorded kata — eleven steps of a real
feature, in the tree, replayed by CI — and the rules that stop it from becoming a
decorative artifact.

## Where test-first earns its keep here

The honest answer is "not everywhere", and the shape of this repository is why.

Most of what gets added is a component, an interceptor or a provider, and most of what
can go wrong with those is a property of a *composition*: the nonce is identical across
two responses, the `@defer` block stopped splitting a chunk, the drawer is off screen and
still in the accessibility tree, `withXsrfConfiguration` is inert because the API is
cross-origin. None of that is reachable from a function signature, so a test written
first against an imagined one tends to encode the imagination. The gates in
`scripts/ci/` exist because several of those failures are invisible to any test at all —
see the header comments in `.github/workflows/ci.yml`.

Where test-first does pay, and pays immediately, is a **decision**: a pure function whose
inputs you can enumerate, whose cases have boundaries, and whose caller is going to
depend on properties that are easy to state and easy to lose. `retryDelayMs`,
`normalisePath`, `readCookie`, `keyOf`, and now `idle-countdown.ts` are all that shape.
For those the first test is cheap, the second is cheaper, and the design pressure is real:
a function that is awkward to drive from a spec is usually a function holding something
that belongs to its caller.

So the rule in this repository is not "write the test first". It is: **when the thing you
are about to write is a decision, separate it from the machinery around it and write that
decision test first.** `idle-session/` is that split made visible —
`idle-countdown.ts` is the decision and was built this way, and
`provide-idle-session.ts` is the machinery and was not.

## The kata

`katas/idle-countdown/` records how `idle-countdown.ts` was built: eleven steps, each one
a directory holding the implementation and the spec exactly as they stood. Its own
`README.md` has the step table and what the exercise turned up. The three findings worth
repeating here:

- **Two of every three red bars were the compiler**, which is a red bar that proves
  nothing about the behaviour being specified — no assertion ran. The useful red is the
  one after the smallest declaration that compiles.
- **A negative test could not fail.** "A session one millisecond short of the window is
  still running" is satisfied by a `settledAt` that returns its argument. It belongs in
  the spec beside its opposite, and would have been a comment with a runtime cost on its
  own.
- **Both defects were in the one function that never read the state it was replacing.**
  The union's narrowing had already closed both properties for `settledAt` before anyone
  wrote a test for them.

### Why it is a directory and not eleven commits

Every item in this repository lands through `gh pr merge --squash --delete-branch`. The
squash replaces the branch's commits with one, and `--delete-branch` removes the branch —
so a kata recorded only as history is destroyed by the merge that accepts it. The commits
were still made, and the pull request shows them; the directory is the half that survives
a clone.

### The rules the gate enforces

`pnpm check:kata` replays every step through this repository's own test command — the
same TypeScript configuration, the same zoneless test platform, the same Jasmine — so
"this step was red" means what it means in `pnpm test`. Each step's two files are copied
into `src/kata-run/` for the run and deleted afterwards; the directory is in
`.gitignore`, and the gate refuses to start if an interrupted run left one behind.

Seven rules, each of which fails on something that is otherwise invisible:

1. **A red step is still red, with the recorded tests failing and the recorded message.**
   Not "something failed": a step whose red moved to a different assertion still passes a
   "did it fail?" check and no longer demonstrates what it says it does.
2. **A red step is red for the recorded *kind* of reason.** `red-compile` must fail before
   any spec runs and carry the recorded diagnostic code; `red-declare` and `red` must
   build and then fail an assertion. A compile error that crept into an assertion step
   looks identical in a pass/fail check.
3. **A red step does not touch the implementation** — it is the previous step's file, byte
   for byte. A red step that also edited the code was written backwards, and reads the
   same either way.
4. **A green step does not touch the spec.** You make a test pass by changing the code.
   This is the one move the discipline has no answer for, and in a diff where both files
   changed there is nothing to see.
5. **No step deletes a test.** Every spec title survives into every later step.
6. **The refactor step changed the implementation, changed nothing else, and follows a
   green step.** A "refactor" after a red step is a fix wearing the word.
7. **The kata still describes the code that ships.** Every name the last step exports is
   still exported by `src/app/core/auth/idle-session/idle-countdown.ts`, and every test it
   ends on is still in that module's spec. This is the rule that fires when the feature
   moves on and the kata is left behind, which is the only way a recorded kata can lie.

Every spec count is checked against what the runner executed, which is what stops a `fit`
or an `xit` from shrinking a step to the assertions that still hold without changing a
visible line.

The rules themselves are pure functions of the recorded files and the parsed run, and
`node scripts/ci/assert-tdd-kata.mjs --self-test` drives all of them against the failures
they name — a green step that is red, a red step that is green, a red whose message moved,
a deleted test, a refactor after a red, a step the runner's output cannot be read for.
That last one matters most: `TOTAL: 0 SUCCESS` and an exit code of zero is what a run that
executed nothing looks like, so the parser reports an output it cannot understand rather
than a pass.

### Adding one

1. `katas/<name>/steps/NN-<kind>-<slug>/`, two files per step, named in `kata.json`.
2. `kata.json` declares `subject` (the shipped module and its spec), `files`, and one
   entry per step: its `kind`, its `note`, the `diagnostic` for a `red-compile`, and the
   `failing` specs with a `message` substring for an assertion red.
3. `pnpm check:kata -- --print` checks the structural rules without running anything,
   which is the fast loop. Then the full replay.

### Re-recording a step

If the gate fails because the shipped code moved on, the fix is to re-record — not to edit
a step until it agrees. A step is a claim about what happened, and editing one to match
today's code leaves a kata that reads like a history and is not one. If the feature has
changed enough that the kata no longer describes it, deleting the kata is a better outcome
than keeping a plausible fiction; rule 7 exists to force that choice rather than let it
drift.

## What is still open

- **The kata covers the decision, not the feature.** `provide-idle-session.ts` has no
  recorded steps, for two reasons: a recorded step may not import anything that can change
  underneath it (a step injecting `AuthFacade` would one day be red because the facade
  moved, in a step whose claim is *why* it was red), and the test bed in those specs is
  most of their length.
- **One kata.** The rules are general and the gate reads every directory under `katas/`,
  but a second one has not been written, so "the rules are general" is an argument rather
  than a measurement.
- **The replay costs about four minutes** — eleven Karma runs, each a build. It is its own
  CI job for that reason. Running the green steps together would be faster and would stop
  each step's failures from being attributable to it, which is the thing being asserted.
- **Nothing checks that the eleven commits exist.** They cannot be checked: the squash
  merge removes them. The directory is the artifact the repository keeps, and the pull
  request is where the commits are.
