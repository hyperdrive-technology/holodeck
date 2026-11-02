#!/usr/bin/env bash
# One package's CI gate, shared by every package job in .github/workflows/ci.yml:
# install (frozen lockfile), type check, tests, build, then the smoke checks the
# package opts into by shipping the script:
#
#   scripts/smoke-dist.mjs                   every package: load dist/ by name, ESM + CJS,
#                                            and check bundled GLB URLs (holodeck#7)
#   <pkg>/scripts/smoke-holodeck-package.mjs install the built entry into a HolodeckHost
#                                            through holodeck.package.json (holodeck#15)
#   <pkg>/scripts/browser-bundle-check.mjs   bundle dist/ for the browser, fail on Node
#                                            built-ins (provider-aws)
#   "check:vite-consumer" in package.json    consume the build from a throwaway Vite app
#                                            in Chromium and fetch every GLB (holodeck#28)
#
# Usage (from the holodeck repo root, holodeck-sdk built at ../holodeck-sdk/ts):
#   scripts/ci-package.sh <package-dir-name>
#
# Render tests: the caller sets HOLODECK_CHROMIUM (a real Chrome) or
# HOLODECK_SKIP_RENDER_TESTS=1; with neither, the render-harness guard test fails on
# purpose (holodeck#78). Each phase is a collapsible log group; the first failure
# stops the script with that phase's exit code.
set -euo pipefail

pkg="${1:?usage: scripts/ci-package.sh <package-dir-name>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/packages/$pkg"
[[ -f "$dir/package.json" ]] || { echo "ci-package: no package at packages/$pkg" >&2; exit 2; }
cd "$dir"

phase() {
  local label="$1"
  shift
  echo "::group::$pkg: $label"
  local status=0
  "$@" || status=$?
  echo "::endgroup::"
  if [[ $status -ne 0 ]]; then
    echo "::error title=$pkg: $label failed::exit $status"
    exit "$status"
  fi
}

has_script() { node -e 'process.exit(require("./package.json").scripts?.[process.argv[1]] ? 0 : 1)' "$1"; }

phase install pnpm install --frozen-lockfile
phase 'type check' pnpm type-check
# 15-minute cap on the tests alone (render tests can hang on a wedged GPU process).
phase test timeout 15m pnpm exec vitest run
phase build pnpm build
phase 'smoke-test built package' node ../../scripts/smoke-dist.mjs .
if [[ -f scripts/smoke-holodeck-package.mjs ]]; then
  phase 'smoke-test the Holodeck package entry' node --no-deprecation scripts/smoke-holodeck-package.mjs
fi
if [[ -f scripts/browser-bundle-check.mjs ]]; then
  phase 'browser bundle check' node scripts/browser-bundle-check.mjs
fi
if has_script check:vite-consumer; then
  [[ -n "${HOLODECK_CHROMIUM:-}" ]] || { echo "::error::$pkg: check:vite-consumer needs HOLODECK_CHROMIUM" >&2; exit 1; }
  phase 'vite consumer check (GLB URLs resolve)' timeout 15m pnpm check:vite-consumer
fi
echo "ci-package: $pkg OK"
