/**
 * Phase 52 Sub-C — Dock hide/show cycle with edge-handle recovery (v0.9.95).
 *
 * Tests the full user-visible state machine:
 *   1. Dock is visible at load
 *   2. Click "Hide app dock" → dock hides
 *   3. Edge handle appears (recoverable state)
 *   4. Click edge handle → dock returns, handle hides
 *
 * NOTE (Pitfall 6): In tauri mode this test needs a pinned app entry to
 * be present in localStorage; the browser mode ipcMocks don't pre-seed
 * localStorage. Skip tauri mode until the fixture supports state setup.
 */

import { test, expect, SESSION_PATH } from "../fixtures/tauri"

test("dock toggle cycle: visible → hide → edge-handle → visible (v0.9.95)", async ({ tauriPage }) => {
  await tauriPage.goto(SESSION_PATH)
  await tauriPage.waitForLoadState("load")

  const dock = tauriPage.locator('[data-testid="app-dock"]')
  await expect(dock).toBeVisible({ timeout: 10_000 })

  // Seed a dock entry so the edge handle will appear after hiding
  await tauriPage.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("app-dock-state"))
    if (!key) return
    const state = JSON.parse(localStorage.getItem(key)!)
    if (state.entries.length === 0) {
      state.entries.push({
        uri: "ui://builtin/session-stats",
        addedAt: Date.now(),
        app: { server: "__builtin__", name: "Session Stats", uri: "ui://builtin/session-stats" },
        collapsed: false,
        detached: false,
      })
      localStorage.setItem(key, JSON.stringify(state))
    }
  })
  await tauriPage.reload()
  await tauriPage.waitForLoadState("load")
  await expect(dock).toBeVisible({ timeout: 10_000 })

  // Hide the dock
  const hideButton = tauriPage.locator('[aria-label="Hide app dock"]')
  await hideButton.click()
  await expect(dock).toBeHidden({ timeout: 5_000 })

  // Edge handle should be visible (entries > 0 + hidden)
  const handle = tauriPage.locator('[data-testid="dock-edge-handle"]')
  await expect(handle).toBeVisible({ timeout: 5_000 })

  // Click handle → dock re-opens
  await handle.click()
  await expect(dock).toBeVisible({ timeout: 5_000 })
  await expect(handle).toBeHidden({ timeout: 3_000 })
})
