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
 * base64url-encode a directory path exactly as the app's `base64Encode`
 * (@librecode/util/encode) does — same helper as the browser-mode fixture
 * (fixtures/tauri.ts). Lets us build the `/{encoded}/session` route for any
 * machine/CI runner instead of hardcoding a developer's home-dir path.
 */
function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

// Repo root resolved from this file: fixtures/ → e2e/ → app/ → packages/ → root.
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url)).replace(/\/$/, "")

/**
 * Session route for the repo checkout, computed at runtime. The librecode
 * backend serves `/session?directory=<REPO_ROOT>` for any readable dir, so
 * this works on a fresh CI runner where there are no "recent projects" on the
 * splash. The real app boots to the home route (devUrl `/`) — specs navigate
 * here to reach the session route where the App Dock lives.
 */
export const SESSION_URL = `http://localhost:1420/${base64UrlEncode(REPO_ROOT)}/session`

export const { test, expect } = createTauriTest({
  // The Vite dev server `bun tauri dev` starts (tauri.conf devUrl).
  devUrl: "http://localhost:1420",
  // Launch the real app with the e2e plugin compiled in. Matches the
  // repo's `dev:desktop` invocation (`bun --cwd packages/desktop tauri dev`),
  // run from DESKTOP_ROOT so `bun tauri dev` resolves the desktop package.
  tauriCommand: "bun tauri dev",
  tauriCwd: DESKTOP_ROOT,
  tauriFeatures: ["e2e-testing"],
  mcpSocket: "/tmp/tauri-playwright.sock",
  // Cold CI: vite + a full cargo build of the desktop crate. Generous.
  startTimeout: 900,
})
