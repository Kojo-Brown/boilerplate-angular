# Kata: an idle-session countdown, built test first

The feature is in `src/app/core/auth/idle-session/`: a signed-in session that has been
left alone for fifteen minutes is ended. This directory is how its decision logic —
`idle-countdown.ts` — was built, one step at a time, with the test written before the
code at every step.

Each `steps/NN-*/` directory is a complete, runnable pair: the implementation and the
spec exactly as they stood at the end of that step. `scripts/ci/assert-tdd-kata.mjs`
replays all eleven on every pull request, through this repository's own test command, and
fails if a step has stopped being the colour it records or has become that colour for a
different reason.

```bash
pnpm check:kata                  # replay every step (about four minutes)
pnpm check:kata -- --print       # the step table, without running anything
pnpm check:kata -- --step 07     # one step
KATA_VERBOSE=1 pnpm check:kata   # print the runner's output for failing steps
```

## Why a directory and not a branch

`CLAUDE.md` merges every item with `gh pr merge --squash --delete-branch`. That replaces
the branch's commits with a single commit on `main` and deletes the branch, so a kata
recorded only as history is destroyed by the merge that accepts it: eleven commits become
one, the branch is gone, and `main` contains no trace of the process the item was about.
The commits are still worth making, and they were made — the pull request shows the kata
performed, in order, one step per commit. This directory is the kata *kept*, which is the
half that survives and the half a gate can hold to anything.

## The steps

| # | Step | Kind | Specs | What happened |
|---|------|------|-------|---------------|
| 1 | `red-no-such-module` | red (compiler, TS2307) | 4 | A spec with nothing to import. |
| 2 | `red-declare-the-api` | red (assertion) | 4 | The two states and an inert `settledAt`, so the assertions can speak. |
| 3 | `green-expire-at-the-window` | green | 4 | `>=` against the window. |
| 4 | `red-no-such-export` | red (compiler, TS2305) | 6 | A second function named before it exists. |
| 5 | `red-declare-activity` | red (assertion) | 6 | `withActivityAt` declared and inert. |
| 6 | `green-activity-moves-the-deadline` | green | 6 | Activity restarts the countdown. |
| 7 | `red-activity-revives-an-expired-session` | red (assertion) | 8 | Step 6 cancels an expiry that already happened. |
| 8 | `green-expiry-is-terminal` | green | 8 | Expiry is terminal. |
| 9 | `red-a-fresh-object-every-poll` | red (assertion) | 11 | Step 8 reports a change on every poll. |
| 10 | `green-nothing-changed-means-the-same-value` | green | 11 | Identity when nothing moved. |
| 11 | `refactor-one-home-for-the-invariants` | refactor | 11 | Both invariants into `whileCounting`. The file `src/` ships. |

## What the kata turned up

**Two of every three red bars were the compiler.** Steps 1 and 4 are red because a module
and then an export did not exist, and a compiler error is a red bar that teaches nothing
about the behaviour under specification: no assertion ran, so nothing has been said about
whether the idea was right. The useful red is the one in steps 2 and 5, where the smallest
declaration that compiles is in place and the *assertion* is what fails. Both kinds are
recorded separately for that reason, and the gate holds each step to the kind it claims —
a step whose red quietly became a compile error would otherwise still look like a step.

**A negative test could not fail.** Step 2's spec has four tests and two of them passed
against a `settledAt` that returned its argument: the test that a session one millisecond
short of the window is still running is satisfied by a function that does nothing at all.
It is in the spec because it is the boundary from the other side and the pair pins the
instant; on its own it would have been a test that cannot go red, which is a comment with
a runtime cost. Writing the code first is what makes this easy to miss — the assertion is
written against an implementation that already passes it.

**Both real defects were in the function that never had to look at its input.** The
narrowing in step 3 forced `settledAt` to return early on an expired countdown, and that
one line is both of the properties steps 7 and 9 went on to test, closed before anyone
thought of them: the two matching tests for `settledAt` were green the moment they were
written. `withActivityAt` builds its result from the new reading alone, so it never had to
mention the state it was replacing — and it got both wrong. A discriminated union pays
back exactly where a function is obliged to read the discriminant, and nowhere else, which
is an argument for keeping that obligation rather than designing it away.

**The two defects it did find both read as correct code.** Step 6 is one line and the
obvious one. Step 8 is the same line with the guard everybody agrees about. What step 9
refuses — a new object each call, equal to the one before — is the kind of thing an
immutability habit produces on purpose, and the cost only exists one layer up, where
`provide-idle-session.ts` detects the transition into expiry by identity: an equal-but-new
value is a change reported on every poll, so the sign-out, and the revocation request it
sends, would fire once a poll for as long as the tab stayed open.

## What it is not

It is not the whole feature. `provide-idle-session.ts` — the activity listeners, the poll,
the clock, the sign-out — was built conventionally, and its specs are in
`src/app/core/auth/idle-session/provide-idle-session.spec.ts`. Two reasons, and the first
is about this directory rather than about TDD: a recorded step has to keep compiling and
keep meaning the same thing for as long as it is in the tree, so it may not import
anything that can change underneath it. A step that injected `AuthFacade` would be red one
day because the facade moved, in a step whose whole claim is *why* it was red. The second
is that the test bed, the fake facade and the virtual clock in those specs are most of
each one's length, and a kata step is worth recording when the step is where the thinking
is.

It is also not a claim that this is how every change here is written. `docs/tdd.md` says
where test-first earns its keep in this repository and where it does not.
