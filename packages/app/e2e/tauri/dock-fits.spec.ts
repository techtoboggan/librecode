/**
 * Phase 52 Sub-C — Tauri E2E regression for the v0.9.95 dock-off-screen bug.
 *
 * Root cause: smoke tests ran at 710px (mobile layout). The dock rendered
 * with `display: flex` (passing all assertions) but at x:1279, w:320 in
 * a 1280px viewport — 319px past the right edge. Only visible at the
 * desktop viewport. This test enforces "dock fits inside 1280×800"
 * using bounding-box math, not just a visibility check.
 *
 * Which layer catches it:
 *   Layer 2 (web preview smoke at desktop viewport) — fast catch
 *   Layer 3 (this test) — confirms in real native webview
 */

import { test, expect } from "../fixtures/tauri"

const SESSION_PATH = "/L2hvbWUvdHJpc3Rhbi9Qcm9qZWN0cy9saWJyZWNvZGU/session"

test("dock fits inside 1280×800 viewport — no horizontal overflow (v0.9.95)", async ({ tauriPage }) => {
  await tauriPage.goto(SESSION_PATH)
  await tauriPage.waitForLoadState("load")

  // Verify the dock is rendered and visible
  const dock = tauriPage.locator('[data-testid="app-dock"]')
  await expect(dock).toBeVisible({ timeout: 10_000 })

  // Bounding-box check: dock's right edge must be ≤ viewport width
  const box = await dock.boundingBox()
  expect(box).not.toBeNull()
  const viewport = tauriPage.viewportSize()!
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  expect(box!.x).toBeGreaterThanOrEqual(0)
})
