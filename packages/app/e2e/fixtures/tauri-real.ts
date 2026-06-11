/**
 * Phase 54 — REAL Tauri-mode E2E fixture (socket bridge).
 *
 * Separate from fixtures/tauri.ts (browser-mode, custom). This one uses
 * the library's createTauriTest in `tauri` mode: TauriProcessManager
 * launches `bun tauri dev --features e2e-testing`, the embedded
 * tauri-plugin-playwright opens a unix socket, and PluginClient drives
 * the REAL native WebKitGTK webview over it.
 *
 * Why a separate fixture (not createTauriTest for both modes):
 *   createTauriTest's BROWSER branch hard-codes
 *   `page.waitForLoadState("networkidle")` in setup, which never fires
 *   because LibreCode holds a live SSE connection — that's why the
 *   browser fixture is hand-rolled. The TAURI branch connects via the
 *   socket and does NOT wait for networkidle, so it's safe to use here.
 *
 * Scope reality: the plugin drives the MAIN webview through one socket.
 * A detached window is a separate webview the socket can't reach, so
 * tauri-mode specs assert real-desktop behavior on the main window
 * (e.g. the detach button EXISTS — it's hidden in web mode — and
 * clicking it fires real Tauri IPC), not cross-window driving.
 *
 * Verified locally (headless): the feature-built app opens
 * /tmp/tauri-playwright.sock and boots its sidecar. CI runs this under
 * xvfb-run on a headless runner (no real display to leak to).
 *
 * NOTE: runs under Node (Playwright), not Bun — keep Bun-only APIs out.
 */

import { fileURLToPath } from "node:url"
import { createTauriTest } from "@srsholmes/tauri-playwright"

// packages/desktop — where `bun tauri dev` runs. From this file
// (packages/app/e2e/fixtures/) that's ../../../desktop.
const DESKTOP_ROOT = fileURLToPath(new URL("../../../desktop", import.meta.url)).replace(/\/$/, "")

/**
 * Session route for the repo checkout, mirroring fixtures/tauri.ts (Phase 52F):
 * base64url-encode the directory exactly as the app's base64Encode does. The
 * dock only renders under a session route, and a fresh CI runner has no
 * last-session to restore — specs MUST navigate here explicitly. (Locally the
 * app restores the developer's previous session, which masked this; a
 * stateless CI boot lands on Home, where there is no dock.)
 */
function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url)).replace(/\/$/, "")
export const SESSION_URL = `http://localhost:1420/${base64UrlEncode(REPO_ROOT)}/session`

export const { test, expect } = createTauriTest({
  // The Vite dev server `bun tauri dev` starts (tauri.conf devUrl).
  devUrl: "http://localhost:1420",
  // NO tauriCommand: the suite connects to an ALREADY-RUNNING app launched
  // once by script/e2e-tauri-real.sh (the `bun run test:e2e:tauri:real`
  // entrypoint). When the fixture launched the app per-test, the library's
  // SIGTERM between tests orphaned vite (which kept port 1420, strictPort),
  // so the next test's relaunch exited 1 and the one after hung to the full
  // startTimeout. One shared instance kills the whole failure class and is
  // ~3x faster; the runner owns launch + process-group teardown.
  mcpSocket: "/tmp/tauri-playwright.sock",
})

// Kept for any future spec that needs the desktop package path.
export { DESKTOP_ROOT }

/**
 * Poll an expression until truthy. The library's waitForSelector/waitForFunction
 * are capped by the socket bridge's per-command timeout (~30s) regardless of
 * the timeout argument — but a cold vite dev server can take >30s to compile a
 * route chunk on first request (exactly what fresh CI runners hit). Polling
 * with short evaluate() calls keeps each command fast while allowing a long
 * total budget.
 */
export async function waitForExpr(
  tauriPage: { evaluate: (expr: string) => Promise<unknown> },
  expr: string,
  timeoutMs = 180_000,
  pollMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const v = await tauriPage.evaluate(expr)
      if (v === true || v === "true") return
    } catch (err) {
      lastErr = err // page may be mid-reload; keep polling
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`waitForExpr timed out after ${timeoutMs}ms: ${expr}${lastErr ? ` (last error: ${lastErr})` : ""}`)
}
