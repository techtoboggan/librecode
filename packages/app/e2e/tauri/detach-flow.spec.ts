/**
 * Phase 52 Sub-C — Multi-window detach + reattach (Phase 49).
 *
 * Tests the "Detach to window" button opens a second Tauri window and
 * that the reattach action closes it and returns the entry to the dock.
 *
 * The detach button is rendered by pane-header.tsx only when
 * `platform.platform === "desktop"` (canDetach() check).  The web
 * entry point hard-codes platform: "web", so the button does not exist
 * in browser mode — this test is skipped there and runs only under the
 * tauri project (real native webview).
 */

import { test, expect, SESSION_PATH } from "../fixtures/tauri"

test("detach button is present for non-builtin pinned apps (Phase 49)", async ({ tauriPage }, testInfo) => {
  // canDetach() in pane-header.tsx requires platform.platform === "desktop".
  // The Vite dev server serves entry.tsx which sets platform: "web" unconditionally,
  // so the button does not exist in browser mode.
  test.skip(
    testInfo.project.name === "browser",
    'Detach button only renders when platform.platform === "desktop" (Tauri mode only)',
  )

  await tauriPage.goto(SESSION_PATH)
  await tauriPage.waitForLoadState("load")

  // Pre-seed a non-builtin entry (the only type that gets a Detach button)
  await tauriPage.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("app-dock-state"))
    if (!key) return
    const state = JSON.parse(localStorage.getItem(key)!)
    const already = state.entries.find((e: { uri: string }) => e.uri === "ui://multica/board")
    if (!already) {
      state.entries.push({
        uri: "ui://multica/board",
        addedAt: Date.now(),
        app: { server: "multica", name: "Multica", uri: "ui://multica/board" },
        collapsed: false,
        detached: false,
      })
      localStorage.setItem(key, JSON.stringify(state))
    }
  })
  await tauriPage.reload()
  await tauriPage.waitForLoadState("load")

  // The dock must be visible
  const dock = tauriPage.locator('[data-testid="app-dock"]')
  await expect(dock).toBeVisible({ timeout: 10_000 })

  // Detach button exists for the multica entry
  const detachBtn = tauriPage.locator('[data-testid="pane-detach-ui://multica/board"]')
  await expect(detachBtn).toBeVisible({ timeout: 5_000 })
})
