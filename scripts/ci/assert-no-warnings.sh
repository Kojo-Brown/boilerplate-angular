#!/usr/bin/env bash
# Fail when a build or test log contains a compiler warning.
#
# `ng build` and `ng test` exit 0 on warnings — bundle-budget overruns,
# optimization bailouts, CommonJS interop notices — so the exit code alone
# cannot enforce a no-warnings policy. esbuild, which Angular bundles with,
# marks every one with `▲ [WARNING]`; the Angular CLI's own notices use a
# leading `Warning:`. Both are matched here, after stripping ANSI colour codes
# that otherwise split the marker across escape sequences.
#
# Usage: scripts/ci/assert-no-warnings.sh <log-file>
set -euo pipefail

log="${1:?usage: assert-no-warnings.sh <log-file>}"

if [ ! -f "$log" ]; then
  echo "assert-no-warnings.sh: no such log file: $log" >&2
  exit 2
fi

matches="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | grep -nE '\[WARNING\]|^[[:space:]]*Warning:' || true)"

if [ -n "$matches" ]; then
  echo "::error::Warnings found in $log — this project treats build warnings as failures."
  echo "$matches" >&2
  exit 1
fi

echo "assert-no-warnings.sh: clean ($log)"
