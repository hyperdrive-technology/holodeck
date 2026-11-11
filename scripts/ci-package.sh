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
#   scripts/ci-package.sh <package-dir-name>                 every phase, in order (CI)
#   scripts/ci-package.sh <package-dir-name> --only <a,b>    just these phases, in order
#   scripts/ci-package.sh <package-dir-name> --phases        print the phase ids that apply
#
# Phase ids: install typecheck test build smoke-dist smoke-package bundle-check vite-consumer.
# scripts/dev-check.mjs runs this script phase by phase (--phases, then --only <id>), so the
# local ladder and CI share one list of commands (scripts/dev-check.test.mjs pins it).
#
# Render tests: the caller sets HOLODECK_CHROMIUM (a real Chrome) or
# HOLODECK_SKIP_RENDER_TESTS=1; with neither, the render-harness guard test fails on
# purpose (holodeck#78). Each phase is a collapsible log group; the first failure
# stops the script with that phase's exit code.
set -euo pipefail

pkg="${1:?usage: scripts/ci-package.sh <package-dir-name> [--only <phase,...> | --phases]}"
mode="${2:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/packages/$pkg"
[[ -f "$dir/package.json" ]] || { echo "ci-package: no package at packages/$pkg" >&2; exit 2; }
cd "$dir"

# GNU timeout (Linux CI; Homebrew coreutils on macOS as timeout or gtimeout). Without one the
# command runs uncapped: a local run is watched by a person, CI always has it.
with_timeout() {
  local limit="$1"
  shift
  if command -v timeout >/dev/null; then timeout "$limit" "$@"
  elif command -v gtimeout >/dev/null; then gtimeout "$limit" "$@"
  else "$@"; fi
}

has_script() { node -e 'process.exit(require("./package.json").scripts?.[process.argv[1]] ? 0 : 1)' "$1"; }

# The phases that apply to this package, in run order (opt-ins: see the header).
phases=(install typecheck test build smoke-dist)
[[ -f scripts/smoke-holodeck-package.mjs ]] && phases+=(smoke-package)
[[ -f scripts/browser-bundle-check.mjs ]] && phases+=(bundle-check)
has_script check:vite-consumer && phases+=(vite-consumer)

case "$mode" in
  '') selected=("${phases[@]}") ;;
  --phases) printf '%s\n' "${phases[@]}"; exit 0 ;;
  --only)
    IFS=',' read -r -a selected <<< "${3:?--only needs a comma-separated phase list}"
    for id in "${selected[@]}"; do
      [[ " ${phases[*]} " == *" $id "* ]] || { echo "ci-package: $pkg has no phase '$id' (has: ${phases[*]})" >&2; exit 2; }
    done
    ;;
  *) echo "ci-package: unknown argument $mode" >&2; exit 2 ;;
esac

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

run_phase() {
  case "$1" in
    install) phase install pnpm install --frozen-lockfile ;;
    typecheck) phase 'type check' pnpm type-check ;;
    # 15-minute cap on the tests alone (render tests can hang on a wedged GPU process).
    test) phase test with_timeout 15m pnpm exec vitest run ;;
    build) phase build pnpm build ;;
    smoke-dist) phase 'smoke-test built package' node ../../scripts/smoke-dist.mjs . ;;
    smoke-package) phase 'smoke-test the Holodeck package entry' node --no-deprecation scripts/smoke-holodeck-package.mjs ;;
    bundle-check) phase 'browser bundle check' node scripts/browser-bundle-check.mjs ;;
    vite-consumer)
      [[ -n "${HOLODECK_CHROMIUM:-}" ]] || { echo "::error::$pkg: check:vite-consumer needs HOLODECK_CHROMIUM" >&2; exit 1; }
      phase 'vite consumer check (GLB URLs resolve)' with_timeout 15m pnpm check:vite-consumer
      ;;
  esac
}

# Always in the canonical order, whatever order --only listed them in.
for id in "${phases[@]}"; do
  [[ " ${selected[*]} " == *" $id "* ]] && run_phase "$id"
done
echo "ci-package: $pkg OK (${selected[*]})"
