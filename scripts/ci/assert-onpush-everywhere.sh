#!/usr/bin/env bash
# Fail when a production component ships without `ChangeDetectionStrategy.OnPush`.
#
# The rule (see `docs/change-detection-profiling.md`) is that every production
# component is `OnPush` — under zoneless, Default and OnPush schedule the same set
# of refreshes, so the only work Default adds is a full check of the *view tree*
# when a change-detection cycle runs. OnPush lets Angular skip subtrees whose
# inputs and signals have not changed.
#
# Neither the Angular CLI nor the compiler flags a Default component as a
# warning — it is the framework's own default — so nothing else in the pipeline
# would catch a new component that forgot the metadata. This is that gate.
#
# What is checked: every `*.component.ts` file under `src/app/` that is not a
# `*.spec.ts` file. Test host components inside spec files are excluded because
# they never ship and, when the test is *about* change detection, forcing them
# OnPush would change what the test observes.
#
# What "OnPush" means here: the file has a `@Component` decorator whose metadata
# object contains `changeDetection: ChangeDetectionStrategy.OnPush`. Files with
# multiple `@Component` decorators (a container plus an item component in one
# module) need one OnPush line per decorator.
#
# Usage: scripts/ci/assert-onpush-everywhere.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

# A run that found no component files at all would otherwise "pass" this check.
mapfile -t files < <(find src/app -type f -name '*.component.ts' ! -name '*.spec.ts' | sort)
if [ "${#files[@]}" -eq 0 ]; then
  echo "assert-onpush-everywhere.sh: no *.component.ts files under src/app — has the layout changed?" >&2
  exit 2
fi

failed=0
checked=0
for file in "${files[@]}"; do
  components=$(grep -c '^@Component' "$file" || true)
  onpush=$(grep -c 'changeDetection: ChangeDetectionStrategy\.OnPush,' "$file" || true)
  if [ "$components" -eq 0 ]; then
    # A `*.component.ts` file that has no `@Component` decorator at all is either
    # renamed-in-progress or a helper that should not carry the suffix. Flag it
    # so the naming stays honest.
    echo "::error file=$file::no @Component decorator found in a *.component.ts file"
    failed=1
    continue
  fi
  if [ "$onpush" -lt "$components" ]; then
    echo "::error file=$file::$components @Component decorator(s), $onpush OnPush — add \`changeDetection: ChangeDetectionStrategy.OnPush\` (see docs/change-detection-profiling.md)"
    failed=1
    continue
  fi
  checked=$((checked + 1))
done

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "assert-onpush-everywhere.sh: clean ($checked component file(s) checked, all OnPush)"
