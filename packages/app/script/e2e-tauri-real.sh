#!/usr/bin/env bash
# Runner for the REAL tauri-mode E2E suite (Phase 54/55).
#
# Launches the desktop app ONCE (in its own process group), waits for the
# tauri-plugin-playwright socket, runs the whole Playwright suite against that
# single instance, then tears the entire process tree down.
#
# Why launch here instead of per-test via the fixture's tauriCommand:
# the library SIGTERMs only its direct child between tests, orphaning vite —
# which keeps holding port 1420 (strictPort), so the NEXT test's `tauri dev`
# exits 1 and the one after hangs to the full startTimeout. Observed exactly
# that on the first full-suite run (1 passed, then exit-code-1, then 15-min
# timeout). One shared instance also makes the suite ~3x faster and matches
# the library's documented "connect to an already-running app" mode (the
# fixture omits tauriCommand and calls waitForSocket).
#
# Used by `bun run test:e2e:tauri:real` both locally (wrap with xvfb-run and a
# scrubbed display env — see the WebKit-divergence playbook) and in CI
# (e2e-tauri.yml wraps it in xvfb-run; cargo is pre-built so the app launch is
# fast).
set -euo pipefail
# Job control gives the backgrounded app its own process group, so the EXIT
# trap can kill the whole tree (bun → tauri CLI → cargo → app + vite).
set -m

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$APP_DIR/../desktop"
SOCK="${TAURI_PLAYWRIGHT_SOCKET:-/tmp/tauri-playwright.sock}"
LOG="${TMPDIR:-/tmp}/tauri-real-app.log"

free_port_1420() {
  local pid
  pid=$(ss -ltnp 2>/dev/null | grep ':1420' | grep -oP 'pid=\K[0-9]+' | head -1 || true)
  if [ -n "${pid:-}" ]; then
    echo "freeing port 1420 (pid $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
}

free_port_1420
rm -f "$SOCK"

echo "launching desktop app (log: $LOG)..."
(
  cd "$DESKTOP_DIR"
  exec env TAURI_PLAYWRIGHT_SOCKET="$SOCK" LIBRECODE_REGEN_BINDINGS=0 bun tauri dev --features e2e-testing
) >"$LOG" 2>&1 &
APP_PID=$!

cleanup() {
  echo "tearing down app process group ($APP_PID)"
  kill -TERM -- "-$APP_PID" 2>/dev/null || true
  sleep 2
  kill -KILL -- "-$APP_PID" 2>/dev/null || true
  free_port_1420
  rm -f "$SOCK"
}
trap cleanup EXIT

# Wait for the plugin socket. CI pre-builds the crate so this is fast; a cold
# local run may compile for several minutes — allow up to 15 min, but bail
# immediately (with the log tail) if the app process dies first.
for _ in $(seq 1 900); do
  [ -S "$SOCK" ] && break
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "::error::tauri dev exited before the plugin socket appeared. Log tail:"
    tail -60 "$LOG"
    exit 1
  fi
  sleep 1
done
if [ ! -S "$SOCK" ]; then
  echo "::error::plugin socket $SOCK never appeared. Log tail:"
  tail -60 "$LOG"
  exit 1
fi
echo "plugin socket up: $SOCK"

cd "$APP_DIR"
TAURI_PLAYWRIGHT_SOCKET="$SOCK" bunx playwright test --config=e2e/playwright.tauri-real.config.ts --project=tauri "$@"
