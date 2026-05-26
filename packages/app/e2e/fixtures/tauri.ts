/**
 * Phase 52 Sub-C — Tauri E2E test fixture.
 *
 * Exports a Playwright `test` + `expect` whose `tauriPage` fixture is a
 * standard Playwright `Page` with Tauri IPC mocked via addInitScript.
 *
 * Why not createTauriTest from @srsholmes/tauri-playwright?
 *   The library's browser-mode fixture hard-codes waitForLoadState("networkidle")
 *   during setup. LibreCode maintains a persistent SSE connection to the backend
 *   (port 4096), so networkidle never fires and every test times out at 30 s.
 *   We import only `generateIpcMockScript` from the library (it is exported) and
 *   build a minimal fixture ourselves, waiting for "load" which fires reliably
 *   regardless of live SSE connections.
 *
 * Three modes (for future expansion):
 *  - browser: headless Chromium + mocked Tauri IPC (CI default, this file)
 *  - tauri:   real native webview via socket bridge (requires --features e2e-testing)
 *  - cdp:     direct CDP to WebView2 (Windows, future)
 *
 * NOTE (Pitfall 7 — Bun-native): This file runs under Node.js (Playwright),
 * not Bun. Do NOT import Bun-specific APIs here. Keep it pure Node/ESM.
 *
 * NOTE (Pitfall 6 — IPC mode): ipcMocks apply ONLY in browser mode.
 * In tauri mode, the real backend runs and real IPC fires. Tests that
 * rely on mocked responses must be skipped or adapted for tauri mode.
 */

import { test as base, expect, type Page } from "@playwright/test"
import { fileURLToPath } from "node:url"
// generateIpcMockScript is a public export of @srsholmes/tauri-playwright
// (see node_modules/.../dist/index.d.ts line 881).
import { generateIpcMockScript } from "@srsholmes/tauri-playwright"

/**
 * Phase 52F — base64url-encode a directory path exactly as the app's
 * `base64Encode` (@librecode/util/encode) does, so we can build the
 * `/{encoded}/session` route for ANY machine/CI runner rather than
 * hardcoding a developer's home-dir path (the v0.10.0-.2 failure).
 */
function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

// Repo root resolved from this file: fixtures/ → e2e/ → app/ → packages/ → root
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url)).replace(/\/$/, "")

/**
 * Session route for the repo checkout, computed at runtime. The librecode
 * backend serves `/session?directory=<REPO_ROOT>` for any readable dir, so
 * this works on a fresh CI runner where there are no "recent projects" to
 * click on the splash.
 */
export const SESSION_PATH = `/${base64UrlEncode(REPO_ROOT)}/session`

/** Onboarding route for the repo checkout (provider-scan-auth spec). */
export const ONBOARDING_PATH = `/${base64UrlEncode(REPO_ROOT)}/onboarding`

/**
 * Tauri IPC mocks injected into every page before navigation.
 *
 * await_initialization must return ServerReadyData = { url, username, password }
 * (see packages/desktop/src/bindings.ts). Returning null crashes the app's
 * initialization path.
 */
const IPC_MOCKS = {
  // Core initialization — returns the backend server URL and optional auth
  await_initialization: () => ({ url: "http://127.0.0.1:4096", username: null, password: null }),
  get_default_server_url: () => "http://127.0.0.1:4096",
  // Display / platform queries
  get_display_backend: () => "auto",
  get_wsl_config: () => ({ enabled: false }),
  // Detached window commands (Phase 49)
  is_detached_app_window_open: () => false,
  open_detached_app_window: () => null,
  close_detached_app_window: () => null,
  focus_detached_app_window: () => null,
} as const

/**
 * Extended Playwright test with a `tauriPage` fixture.
 *
 * The fixture injects IPC mocks before each test's first navigation.
 * It does NOT navigate during setup — each test calls goto() itself, so
 * navigation options (waitUntil, timeout) can vary per test.
 */
export const test = base.extend<{ tauriPage: Page }>({
  tauriPage: async ({ page }, use) => {
    // Inject Tauri IPC mocks as an init script so they are active from the
    // very first page load. addInitScript runs before any page scripts.
    await page.addInitScript(
      generateIpcMockScript(IPC_MOCKS as Record<string, (args?: Record<string, unknown>) => unknown>),
    )
    await use(page)
  },
})

export { expect }
