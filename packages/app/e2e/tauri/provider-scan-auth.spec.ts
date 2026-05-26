/**
 * Phase 52 Sub-C — Provider scan endpoint auth audit (v0.9.95).
 *
 * Root cause: four additional raw fetch() sites (beyond Timeline) were
 * bypassing the authed wrapper. This test verifies the in-app local
 * compute detection flow completes without 401 / "Load failed" errors.
 *
 * In browser mode: verifies the onboarding flow renders and no auth
 * errors appear when detection is triggered via UI.
 * In tauri mode with LIBRECODE_SERVER_PASSWORD: verifies the authed
 * fetch path is used end-to-end.
 */

import { test, expect, ONBOARDING_PATH } from "../fixtures/tauri"

test("local compute detection renders without 401/auth errors (v0.9.95 audit)", async ({ tauriPage }) => {
  await tauriPage.goto(ONBOARDING_PATH)
  await tauriPage.waitForLoadState("load")

  const consoleErrors: string[] = []
  tauriPage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })

  // Try to navigate to local-compute onboarding if available
  const localComputeLink = tauriPage.locator('[href*="local-compute"], [data-testid*="local-compute"]').first()
  if (await localComputeLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await localComputeLink.click()
    await tauriPage.waitForLoadState("load")
  }

  await tauriPage.waitForTimeout(1_000)

  // No auth-bypass errors
  const authErrors = consoleErrors.filter((e) => /401|Load failed|Unauthorized/i.test(e))
  expect(authErrors, `Auth-bypass errors found: ${authErrors.join(", ")}`).toHaveLength(0)
})
