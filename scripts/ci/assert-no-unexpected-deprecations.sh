#!/usr/bin/env bash
# Fail when a build log contains a Node deprecation warning that is not one we have
# looked at and accepted.
#
# This is the build job's replacement for `NODE_OPTIONS=--throw-deprecation`, which every
# other job still carries. The policy is unchanged — a deprecated Node API, ours or a
# dependency's, fails the build on the oldest and the newest supported runtime rather
# than when it is finally removed — but it is enforced by reading the log rather than by
# throwing, because on one runtime the throw takes the build with it.
#
# ## Why the build job cannot use --throw-deprecation
#
# On Node 26, `module.register()` is deprecated as DEP0205. Angular's server-rendering
# route extractor calls it — `@angular/build/src/utils/server-rendering/esm-in-memory-loader/
# register-hooks.js` — from inside the worker that prerenders each route, so under
# `--throw-deprecation` the warning becomes a thrown error there and `ng build` reports
# "An error occurred while extracting routes", prerenders 0 routes, and exits 1. There is
# nothing in this repository to fix: it is one line in a dependency, still present in
# every published Angular 22 release including 22.2.0-next.7, and the build is clean on
# Node 22 and 24.
#
# `--disable-warning=DEP0205` does not rescue it either. The disable list filters warnings
# on their way to being *printed*; `--throw-deprecation` throws before that, so the two
# flags together still throw. Verified on Node 26.8.2 rather than assumed.
#
# So the build runs without the flag, Node prints the warning as it normally would, and
# this reads the log. What that costs, honestly: a deprecation reached only on a code path
# the build does not execute is no longer surfaced — but `--throw-deprecation` never
# surfaced those either, since it also only fires on code that runs.
#
# ## Adding to the allow-list
#
# One entry per line, `DEPxxxx` plus a reason. A warning with no code at all is never
# allowed: an unidentifiable deprecation cannot be vetted, and `process.emitWarning`
# without a code is a caller's choice, not Node's.
#
# Usage: scripts/ci/assert-no-unexpected-deprecations.sh <log-file>
set -euo pipefail

log="${1:?usage: assert-no-unexpected-deprecations.sh <log-file>}"

if [ ! -f "$log" ]; then
  echo "assert-no-unexpected-deprecations.sh: no such log file: $log" >&2
  exit 2
fi

# Deprecations that have been looked at, with why they are tolerated. Keep the reason with
# the code; a bare list of numbers is how an allow-list stops being reviewed.
#
#   DEP0205 — `module.register()`, called by @angular/build's server-rendering loader.
#             Not reachable from this repository's source. See the header above.
ALLOWED_CODES="DEP0205"

# Strip ANSI first: the CLI colours its output, and an escape sequence in the middle of
# `[DEP0205]` would otherwise hide the code and read as an uncoded warning.
warnings="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | grep -E 'DeprecationWarning' || true)"

if [ -z "$warnings" ]; then
  echo "assert-no-unexpected-deprecations.sh: clean ($log, no deprecation warnings)"
  exit 0
fi

unexpected=""
allowed_seen=""

while IFS= read -r line; do
  code="$(printf '%s\n' "$line" | grep -oE '\[DEP[0-9]+\]' | tr -d '[]' || true)"

  if [ -n "$code" ] && printf '%s\n' "$ALLOWED_CODES" | tr ' ' '\n' | grep -qx "$code"; then
    case " $allowed_seen " in
      *" $code "*) ;;
      *) allowed_seen="$allowed_seen $code" ;;
    esac
    continue
  fi

  unexpected="$unexpected$line
"
done <<EOF
$warnings
EOF

if [ -n "$unexpected" ]; then
  echo "::error::Unexpected Node deprecation warning(s) in $log."
  printf '%s' "$unexpected" >&2
  echo "" >&2
  echo "Fix the call, or — if it is a dependency's and unreachable from src/ — add its" >&2
  echo "DEP code to ALLOWED_CODES in $0 with a reason." >&2
  exit 1
fi

echo "assert-no-unexpected-deprecations.sh: clean ($log, only allow-listed:${allowed_seen:- none})"
