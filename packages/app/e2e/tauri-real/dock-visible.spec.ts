/**
 * Phase 54 — Layer-3 regression: the App Dock must render INSIDE the viewport
 * in the REAL WebKitGTK webview.
 *
 * The v0.10.x "I can't see the dock" report: the dock was present in the DOM
 * (display:flex, visibility:visible) but positioned past the right edge. Root
 * cause: the session panel used `width:100%` / `md:flex-none`, filling the
 * whole flex row and ignoring its flex-none siblings (side panel + the 320px
 * dock), so the dock overflowed off-screen. Fixed by making the session panel
 * `flex-1 min-w-0` in non-review mode (session.tsx) so flexbox leaves room for
 * the dock.
 *
 * Browser-mode dock-fits.spec.ts asserts the same property in Chromium, but
 * this bug's symptom was only ever observed in the real desktop webview — this
 * spec is the real-WebKit guard. Runs headless under xvfb in CI (e2e-tauri.yml).
 */

import { test, expect, SESSION_URL } from "../fixtures/tauri-real"

test("App Dock renders fully inside the viewport (real WebKit)", async ({ tauriPage }) => {
  // Navigate to the checkout's session route — the dock only renders there,
  // and a stateless CI boot lands on Home (locally the restored last-session
  // masked this). Then give the layout a beat to settle (flex reflow + mount).
  await new Promise((r) => setTimeout(r, 4000))
  await tauriPage.goto(SESSION_URL)
  await new Promise((r) => setTimeout(r, 6000))

  const raw = await tauriPage.evaluate(`(function(){
    var dock = document.querySelector('[data-testid="app-dock"]');
    if (!dock) return JSON.stringify({ found: false });
    var r = dock.getBoundingClientRect();
    return JSON.stringify({
      found: true,
      innerWidth: innerWidth,
      x: Math.round(r.x),
      width: Math.round(r.width),
      right: Math.round(r.x + r.width),
    });
  })()`)

  const info = JSON.parse(String(raw))
  console.log("dock viewport check:", JSON.stringify(info))

  expect(info.found).toBe(true)
  // Left edge on-screen, right edge within the viewport (±1px rounding), and a
  // real width — i.e. the panel is actually visible, not pushed off the right.
  expect(info.x).toBeGreaterThanOrEqual(0)
  expect(info.width).toBeGreaterThan(0)
  expect(info.right).toBeLessThanOrEqual(info.innerWidth + 1)
})
