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

import type { Page } from "@playwright/test"
import { test, expect, SESSION_PATH } from "../fixtures/tauri"

/** Shared invariant: the dock renders fully inside the viewport. */
async function expectDockFits(tauriPage: Page): Promise<void> {
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
}

test("dock fits inside 1280×800 viewport — no horizontal overflow (v0.9.95)", async ({ tauriPage }) => {
  await expectDockFits(tauriPage)
})

/**
 * v0.10.18 — narrow-window regression. At widths just above the 768px
 * isDesktop() breakpoint the review panel (open by default on fresh state)
 * put the session panel in fixed-width mode: `md:flex-none` + width 600px
 * (DEFAULT_SESSION_WIDTH). flex-none can't shrink, the side panel clamps at
 * 0, and the 320px dock got pushed past the right edge (observed at wry's
 * default 800×600 window in the real-WebKitGTK harness: dock x=600, right
 * edge 920 in an 800px window). Fixed by `md:flex-initial` + `md:min-w-0`
 * in session.tsx — the review width is a target, not a floor.
 *
 * Both widths sit in the 768–1100px degradation band; 800 is the concrete
 * CI failure, 900 matches the LIBRECODE_E2E_WINDOW_SIZE=900x700 repro.
 */
for (const viewport of [
  { width: 800, height: 600 },
  { width: 900, height: 700 },
]) {
  test.describe(`narrow viewport ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    test(`dock fits at ${viewport.width}px — review-open fixed-width session panel (v0.10.18)`, async ({
      tauriPage,
    }) => {
      await expectDockFits(tauriPage)

      // Precondition guard: this regression only bites while the review
      // panel is OPEN (fresh-state default). If that default ever flips,
      // this assertion fails loudly instead of the test silently passing
      // without exercising the fixed-width session-panel mode.
      await expect(tauriPage.locator("#review-panel")).toHaveAttribute("aria-hidden", "false")
    })
  })
}
