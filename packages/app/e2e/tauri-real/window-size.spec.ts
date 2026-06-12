/**
 * Layer-3 regression: the harness viewport must be EXACTLY what
 * LIBRECODE_E2E_WINDOW_SIZE requested, even when the profile carries a
 * persisted .window-state.json.
 *
 * The bug (chip task_d9387be1): windows.rs honored LIBRECODE_E2E_WINDOW_SIZE
 * at window creation, but tauri_plugin_window_state restored the dev
 * profile's saved geometry AFTER creation (on_window_ready), silently
 * overriding it — requested 900x700, measured innerWidth 956 (restored from
 * a persisted 1008x949). CI is stateless so it never noticed; local harness
 * runs (scripts/dev-setup.sh isolation keeps state in
 * .dev/config/com.librecode.desktop.dev/) got whatever was last saved.
 * Fixed by skipping the window-state plugin entirely in e2e-testing builds
 * when the env var is set (lib.rs + windows.rs::window_state_enabled).
 *
 * script/e2e-tauri-real.sh seeds a decoy .window-state.json when the profile
 * has none, so this spec exercises the restore-override path on stateless CI
 * runners too, not just on developer machines.
 */

import { test, expect } from "../fixtures/tauri-real"

// The harness exports LIBRECODE_E2E_WINDOW_SIZE (after applying its 1280x800
// default) before launching either the app or Playwright, so both sides see
// the same requested size.
const requested = process.env.LIBRECODE_E2E_WINDOW_SIZE ?? "1280x800"
const [width, height] = requested.split("x").map(Number)

test(`viewport is exactly the requested ${requested} (persisted window-state must not override)`, async ({
  tauriPage,
}) => {
  // A buggy restore fires in on_window_ready, long before the socket bridge
  // is even reachable — by the time any spec runs, the override (if present)
  // has already been applied. A short settle guards in-flight resizes.
  await new Promise((r) => setTimeout(r, 1000))

  const raw = await tauriPage.evaluate(`JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`)
  const size = JSON.parse(String(raw))
  console.log("viewport check:", JSON.stringify(size), "requested:", requested)

  // Exact logical-pixel match: under xvfb there is no WM to resize the window
  // and the scale factor is 1, so inner_size(w, h) is exactly what the page
  // must see. Any drift means something restored or resized after creation.
  expect(size.w).toBe(width)
  expect(size.h).toBe(height)
})
