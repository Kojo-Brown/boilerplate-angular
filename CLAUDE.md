# boilerplate-angular — Agent Instructions

## What this repo is
Production-grade Angular 22 standalone-component boilerplate. Spec-driven and PR-driven: one `SPEC.md` item per run.

## Your job (scheduled agent, every 4h)
1. `git checkout main && git pull --ff-only origin main`
2. Read `SPEC.md`, take the **first** `- [ ]` item. Phase 0 items always win.
3. `git checkout -b <type>/<kebab-slug>` (`feat`/`fix`/`chore`/`ci`/`docs`)
4. Implement it completely — source, types, tests, docs.
5. Run every gate locally; **all must pass** before pushing:
   ```
   pnpm install
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   pnpm mutation && pnpm check:mutation
   ```
   `pnpm check:mutation` is the `mutation` CI job and blocks a merge like the rest, so it
   belongs in this list. It is about five minutes for 29 mutants over two modules — run it
   last, after the cheap gates are green. `pnpm mutation` exits 0 whatever the score
   (`thresholds.break` is deliberately 0), so the threshold is the separate script, which
   holds each file to its own floor and mutant count rather than to an aggregate. Read
   `docs/mutation-testing.md` before changing the `mutate` list, a floor, or anything in
   `stryker.conf.json`; the four things that bite are that `maxTestRunnerReuse` must stay
   between 1 and 18 (the karma worker degrades over a run and late mutants then time out,
   which *counts as detected*), that `concurrency` must stay 1 (above it the run reports
   false survivors non-deterministically), that `ignoreStatic` is not a speed-up but
   mutants removed from the score, and that dropping a file from `mutate` makes the
   aggregate go *up*, which is why the floors are per file and pinned against the list.
6. Commit, `git push -u origin <branch>`, then `gh pr create`.
7. `gh pr checks --watch` → **merge only if every check is green**:
   `gh pr merge --squash --delete-branch`
8. Pull main, mark the item `- [x]` in `SPEC.md`, update
   `../PROGRESS.md`, push as a `chore:` commit.

If a check fails, fix forward on the same branch. Never merge red. Never
weaken a test or lower a threshold to force green — if a gate is genuinely
wrong, change it deliberately and say why in the PR.

## Secrets
Never commit real credentials, tokens, keys, or `.env` files. Placeholders in
`.env.example` only; CI reads from the GitHub secret store. Test fixtures must
look obviously fake. Scan `git diff --cached` before every push.

## Conventions
- Standalone components only — no NgModules
- Signals for local state; NgRx Signal Store for global
- Functional guards and interceptors (`authGuard`, `HttpInterceptorFn`)
- `OnPush` on every component
- Typed reactive forms; no `FormGroup<any>`

See `../ROUTINE.md` for the full workflow.
