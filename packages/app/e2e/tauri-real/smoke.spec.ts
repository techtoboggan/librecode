/**
 * Phase 54 — REAL tauri-mode smoke: prove the socket bridge drives the
 * actual native WebKitGTK webview end-to-end.
 *
 * This is the FOUNDATION test. If it passes in CI, it proves:
 *   1. `bun tauri dev --features e2e-testing` launches the real app
 *   2. tauri-plugin-playwright opens its socket (verified locally too)
 *   3. PluginClient connects + the runtime e2e capability grants pw_result
 *   4. tauriPage.evaluate round-trips through the real webview
 *
 * Dock / detach assertions build on this once the foundation is green
 * (the realistic next step: assert the detach button EXISTS in real
 * desktop mode — it's hidden in web mode — and clicking it fires real
 * Tauri IPC). Kept minimal here to maximize first-run signal.
 */

import { test, expect } from "../fixtures/tauri-real"

test("real app boots + webview renders via socket bridge (Phase 54)", async ({ tauriPage }) => {
  // The fixture has already launched the app, connected the socket, and
  // navigated to devUrl. A round-tripped evaluate proves the bridge works.
  const title = await tauriPage.evaluate("document.title")
  expect(title).toBe("LibreCode")

  // The app shell mounted (real desktop platform). The splash/home renders
  // a recognizable control; assert the document has real content, not a
  // blank/error page.
  const bodyLen = await tauriPage.evaluate("document.body.innerHTML.length")
  expect(Number(bodyLen)).toBeGreaterThan(500)

  // Confirm we are in DESKTOP platform (not web) — this is what unlocks
  // the detach button and other Tauri-only UI that browser mode can't test.
  const isTauri = await tauriPage.evaluate("typeof window.__TAURI_INTERNALS__ !== 'undefined'")
  expect(isTauri).toBe(true)
})
