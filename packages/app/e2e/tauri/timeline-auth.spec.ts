/**
 * Phase 52 Sub-C — Timeline tab loads without "TypeError: Load failed" (v0.9.94).
 *
 * Root cause: fetchActivity used raw fetch() instead of globalSDK.fetch.
 * In Tauri desktop mode with LIBRECODE_SERVER_PASSWORD set, all raw fetch()
 * calls to the API return 401 whose response lacks ACAO headers → surfaces
 * as "TypeError: Load failed" (Pitfall 11 — the CORS-looking error).
 *
 * In browser mode, the test simply verifies no "TypeError: Load failed"
 * errors appear in the console when the activity tab is clicked.
 * In tauri mode, run with LIBRECODE_SERVER_PASSWORD set in the dev server
 * environment to exercise the auth path.
 */

import { test, expect, SESSION_PATH } from "../fixtures/tauri"

test("Timeline tab loads without TypeError: Load failed (v0.9.94)", async ({ tauriPage }) => {
  await tauriPage.goto(SESSION_PATH)
  await tauriPage.waitForLoadState("load")

  const consoleErrors: string[] = []
  tauriPage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })

  // Click the activity / timeline tab
  const activityTab = tauriPage.locator('[role="tab"][value="activity"], [data-value="activity"]').first()
  if (await activityTab.isVisible()) {
    await activityTab.click()
    await tauriPage.waitForTimeout(2_000)
  }

  // No "TypeError: Load failed" errors from the Timeline fetch
  const loadFailedErrors = consoleErrors.filter((e) => /TypeError: Load failed/i.test(e))
  expect(loadFailedErrors, `Got unexpected "Load failed" errors: ${loadFailedErrors.join(", ")}`).toHaveLength(0)
})
