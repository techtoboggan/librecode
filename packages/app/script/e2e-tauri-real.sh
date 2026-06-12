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

# Resolve the requested viewport ONCE and export it: the app applies it at
# window creation (windows.rs) and window-size.spec.ts asserts innerWidth/
# innerHeight match, so both processes must see the same value. Overridable
# from the caller's env for narrow-window repros (e.g.
# LIBRECODE_E2E_WINDOW_SIZE=900x700 — the v0.10.18 dock-overflow band).
export LIBRECODE_E2E_WINDOW_SIZE="${LIBRECODE_E2E_WINDOW_SIZE:-1280x800}"

# Regression decoy (window-size.spec.ts): with LIBRECODE_E2E_WINDOW_SIZE set,
# the e2e build must IGNORE persisted window geometry — tauri_plugin_window_state
# used to restore it AFTER windows.rs applied the explicit size, silently
# overriding the harness viewport whenever the profile had a .window-state.json
# (dev profiles under scripts/dev-setup.sh isolation do; CI is stateless and
# never caught it). The app now skips the plugin for these runs (lib.rs). Seed
# a decoy state file when the profile has none so stateless CI exercises the
# restore-override path too; teardown removes it so a later non-e2e dev launch
# can't restore the decoy geometry.
APP_IDENTIFIER=$(grep -oP '"identifier":\s*"\K[^"]+' "$DESKTOP_DIR/src-tauri/tauri.conf.json")
STATE_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/$APP_IDENTIFIER/.window-state.json"
SEEDED_STATE=""
if [ ! -f "$STATE_FILE" ]; then
  mkdir -p "$(dirname "$STATE_FILE")"
  cat >"$STATE_FILE" <<'EOF'
{
  "main": {
    "width": 1004,
    "height": 753,
    "x": 0,
    "y": 0,
    "prev_x": 0,
    "prev_y": 0,
    "maximized": false,
    "visible": true,
    "decorated": true,
    "fullscreen": false
  }
}
EOF
  SEEDED_STATE="$STATE_FILE"
  echo "seeded decoy window-state: $STATE_FILE"
fi

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
  # LIBRECODE_E2E_WINDOW_SIZE (exported above): xvfb has no window manager, so
  # the app's maximized(true) no-ops there and the window would stay at wry's
  # 800x600 default — too narrow for the desktop layout the specs assert. The
  # e2e-testing build honors this explicit size (windows.rs), giving local +
  # CI the same deterministic 1280x800 viewport the Layer-2 template mandates.
  # It ALSO makes the build skip tauri_plugin_window_state (lib.rs): the
  # plugin would otherwise restore a persisted .window-state.json AFTER window
  # creation and silently override this size — and clobber the profile's
  # saved geometry on exit. E2e runs neither read nor write window state.
  exec env TAURI_PLAYWRIGHT_SOCKET="$SOCK" LIBRECODE_REGEN_BINDINGS=0 \
    bun tauri dev --features e2e-testing
) >"$LOG" 2>&1 &
APP_PID=$!

cleanup() {
  echo "tearing down app process group ($APP_PID)"
  kill -TERM -- "-$APP_PID" 2>/dev/null || true
  sleep 2
  kill -KILL -- "-$APP_PID" 2>/dev/null || true
  free_port_1420
  rm -f "$SOCK"
  # Only remove the decoy WE seeded — a developer's real window-state stays.
  # (if-form, not `&&`: a false AND-list as the trap's last command would
  # flip the script's exit code under set -e.)
  if [ -n "$SEEDED_STATE" ]; then rm -f "$SEEDED_STATE"; fi
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

# The socket file appears slightly before the main window registers with the
# plugin; starting Playwright on socket-existence intermittently fails the
# first fixture eval ("window 'main' not found after retries"). Gate on a
# real eval round-trip succeeding.
TAURI_PLAYWRIGHT_SOCKET="$SOCK" bun e2e/scripts/wait-tauri-ready.mjs 120

TAURI_PLAYWRIGHT_SOCKET="$SOCK" bunx playwright test --config=e2e/playwright.tauri-real.config.ts --project=tauri "$@"
