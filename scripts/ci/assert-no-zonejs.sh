#!/usr/bin/env bash
# Fail when a production build ships ZoneJS.
#
# The app runs zoneless: `provideZonelessChangeDetection()` in `app.config.ts` and an
# empty `polyfills` array in `angular.json`. Neither of those fails loudly if ZoneJS
# comes back. Re-adding `"zone.js"` to the build polyfills keeps every test green and
# the app working — Angular tolerates ZoneJS being present while scheduling zonelessly
# — it just silently puts ~35 kB of monkey-patched browser APIs back in the bundle.
#
# So the artifact is checked rather than the config. `__load_patch` is ZoneJS's own
# patch registrar; it is a property name on the global `Zone`, so it survives
# minification, and nothing in Angular itself emits it. Angular's zoneless code does
# reference the bare identifier `Zone` (`typeof Zone !== 'undefined'` guards), which is
# why that is not what gets matched here.
#
# Usage: scripts/ci/assert-no-zonejs.sh <dist-dir>
set -euo pipefail

dist="${1:?usage: assert-no-zonejs.sh <dist-dir>}"

if [ ! -d "$dist" ]; then
  echo "assert-no-zonejs.sh: no such directory: $dist" >&2
  exit 2
fi

# A build that emitted nothing would otherwise "pass" this check.
bundles="$(find "$dist" -type f -name '*.js' -print)"
if [ -z "$bundles" ]; then
  echo "assert-no-zonejs.sh: no JavaScript bundles under $dist — did the build run?" >&2
  exit 2
fi

matches="$(grep -rl '__load_patch' "$dist" --include='*.js' || true)"

if [ -n "$matches" ]; then
  echo "::error::ZoneJS found in the production bundle — this app is zoneless (see docs/zoneless.md)."
  echo "$matches" >&2
  exit 1
fi

echo "assert-no-zonejs.sh: clean ($(printf '%s\n' "$bundles" | wc -l) bundles checked, no ZoneJS)"
