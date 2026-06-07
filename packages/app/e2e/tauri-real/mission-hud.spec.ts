/**
 * Phase 55 H0 — real-WebKitGTK verification of the Agent HUD slice.
 *
 * Adds the Mission HUD via the dock's real add flow, confirms it mounts (a
 * channel-driven builtin) with no sandbox/console errors, then promotes it to
 * `overlay` via the host header toggle and asserts the WebKit-specific
 * behavior: the panel renders fixed + above the session (z-40) inside the
 * viewport, and is click-through (a point over the HUD body resolves to the
 * session beneath, because the container is pointer-events:none).
 *
 * Run headless under xvfb (see WebKit-divergence playbook).
 */

import { test, expect } from "../fixtures/tauri-real"

const HUD_URI = "ui://builtin/mission-hud"

test("Mission HUD mounts + promotes to a click-through overlay (real WebKit)", async ({ tauriPage }) => {
  // Capture console + window errors for the regression check (no SecurityError).
  await tauriPage.evaluate(`
    (() => {
      if (window.__hud) return "already"
      window.__hud = { errors: [] }
      addEventListener('error', e => window.__hud.errors.push('error: ' + (e.message || 'unknown')))
      const oce = console.error.bind(console)
      console.error = (...a) => { try { window.__hud.errors.push('console.error: ' + a.map(String).join(' ')) } catch {} ; oce(...a) }
      return "ok"
    })()
  `)
  await new Promise((r) => setTimeout(r, 6000))

  // Open the dock's add popover and add the Mission HUD (the real user flow —
  // no localStorage/session-id assumptions).
  await tauriPage.locator('[data-testid="dock-add-trigger"]').click()
  await new Promise((r) => setTimeout(r, 600))
  await tauriPage.locator(`[data-testid="dock-add-${HUD_URI}"]`).click()
  await new Promise((r) => setTimeout(r, 4000))

  const mounted = await tauriPage.evaluate(`(() => {
    const dock = document.querySelector('[data-testid="app-dock"]')
    const iframes = Array.from(document.querySelectorAll('iframe'))
    const overlayToggle = document.querySelector('[data-testid="mcp-app-overlay-toggle"]')
    return JSON.stringify({
      dock: !!dock,
      iframeCount: iframes.length,
      hasOverlayToggle: !!overlayToggle,
      errors: (window.__hud && window.__hud.errors || []).slice(0, 20),
    })
  })()`)
  const m = JSON.parse(String(mounted))
  console.log("MOUNTED:", JSON.stringify(m, null, 2))
  expect(m.dock).toBe(true)
  expect(m.iframeCount).toBeGreaterThan(0)
  expect(m.hasOverlayToggle).toBe(true)
  // Regression: the new builtin must not trip a WebKit sandbox SecurityError.
  expect(m.errors.some((e: string) => /sandbox access violation|securityerror/i.test(e))).toBe(false)

  // Promote to overlay via the host-rendered header toggle.
  await tauriPage.locator('[data-testid="mcp-app-overlay-toggle"]').click()
  await new Promise((r) => setTimeout(r, 1200))

  const overlay = await tauriPage.evaluate(`(() => {
    const panel = document.querySelector('[data-component="mcp-app-panel"][data-display-mode="overlay"]')
    if (!panel) return JSON.stringify({ found: false })
    const cs = getComputedStyle(panel)
    const r = panel.getBoundingClientRect()
    // Click-through probe: a point over the HUD body (below the header) must
    // resolve to an element OUTSIDE the overlay panel (the session beneath),
    // because the container is pointer-events:none.
    const px = Math.round(r.x + r.width / 2)
    const py = Math.round(r.y + r.height * 0.7)
    const hit = document.elementFromPoint(px, py)
    return JSON.stringify({
      found: true,
      position: cs.position,
      zIndex: cs.zIndex,
      inViewport: r.x >= 0 && r.x + r.width <= innerWidth + 1 && r.width > 0 && r.height > 0,
      clickThrough: !panel.contains(hit),
    })
  })()`)
  const o = JSON.parse(String(overlay))
  console.log("OVERLAY:", JSON.stringify(o, null, 2))
  expect(o.found).toBe(true)
  expect(o.position).toBe("fixed")
  expect(Number(o.zIndex)).toBeGreaterThanOrEqual(40)
  expect(o.inViewport).toBe(true)
  expect(o.clickThrough).toBe(true)
})
