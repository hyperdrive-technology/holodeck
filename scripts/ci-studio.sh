#!/usr/bin/env bash
# The studio job's gate (.github/workflows/ci.yml `studio`): Holodeck Studio (apps/studio) and the
# MCP server (packages/mcp), which both consume the BUILT editor-2.5d-react and provider/library
# packages (file: deps, copied at install time, so they are built before the consumers install).
#
#   deps       install + build each package in DEPS (scripts/ci-package.sh <dep> --only install,build)
#   install    apps/studio: pnpm install --frozen-lockfile
#   typecheck  apps/studio: pnpm type-check
#   test       apps/studio: vitest (fake-indexeddb)
#   build      apps/studio: production build (tsc + vite build)
#   mcp        the MCP server's full package gate (scripts/ci-package.sh mcp). After the studio
#              build: scene_render's tests drive the real apps/studio/dist in HOLODECK_CHROMIUM.
#   e2e        apps/studio: Playwright over `vite preview` of the production build (browser)
#
# Usage (from the holodeck repo root, holodeck-sdk built at ../holodeck-sdk/ts):
#   scripts/ci-studio.sh                  every phase, in order
#   scripts/ci-studio.sh --only <a,b>     just these phases, in order
#   scripts/ci-studio.sh --phases         print the phase ids
#   scripts/ci-studio.sh --deps           print DEPS
#
# scripts/dev-check.mjs runs the phases one by one (the `deps` builds come from the package
# steps it already runs); scripts/dev-check.test.mjs pins that the two agree.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPS=(editor-2.5d-react provider-http provider-aws library-cloud)
phases=(deps install typecheck test build mcp e2e)

case "${1:-}" in
  '') selected=("${phases[@]}") ;;
  --phases) printf '%s\n' "${phases[@]}"; exit 0 ;;
  --deps) printf '%s\n' "${DEPS[@]}"; exit 0 ;;
  --only)
    IFS=',' read -r -a selected <<< "${2:?--only needs a comma-separated phase list}"
    for id in "${selected[@]}"; do
      [[ " ${phases[*]} " == *" $id "* ]] || { echo "ci-studio: no phase '$id' (has: ${phases[*]})" >&2; exit 2; }
    done
    ;;
  *) echo "ci-studio: unknown argument $1" >&2; exit 2 ;;
esac

phase() {
  local label="$1"
  shift
  echo "::group::studio: $label"
  local status=0
  (cd "$root/apps/studio" && "$@") || status=$?
  echo "::endgroup::"
  if [[ $status -ne 0 ]]; then
    echo "::error title=studio: $label failed::exit $status"
    exit "$status"
  fi
}

run_phase() {
  case "$1" in
    deps) for dep in "${DEPS[@]}"; do "$root/scripts/ci-package.sh" "$dep" --only install,build; done ;;
    install) phase install pnpm install --frozen-lockfile ;;
    typecheck) phase 'type check' pnpm type-check ;;
    test) phase 'unit tests' pnpm exec vitest run ;;
    build) phase build pnpm build ;;
    mcp) "$root/scripts/ci-package.sh" mcp ;;
    e2e) phase 'e2e (Playwright over the production build)' timeout 15m pnpm exec playwright test ;;
  esac
}

for id in "${phases[@]}"; do
  if [[ " ${selected[*]} " == *" $id "* ]]; then run_phase "$id"; fi
done
echo "ci-studio: OK (${selected[*]})"
