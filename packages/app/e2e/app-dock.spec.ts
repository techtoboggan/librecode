/**
 * App Dock E2E tests (Phase 42 prototype + Phase 43 multi-pane + Phase 44 migration)
 *
 * These tests require `experimental.app_dock = true` in the session config.
 * The `withProject` fixture accepts `extraConfig` which is merged into the
 * session's librecode.jsonc, so all tests in this file use the BDD helper
 * pattern to seed the flag before navigating.
 *
 * Selectors use data-testid attributes:
 *
 * Phase 42:
 *   data-testid="app-dock"           — the outer dock wrapper (always in DOM)
 *   data-testid="dock-empty-state"   — shown when no app is docked
 *   data-testid="dock-try-button"    — "Try it: Add Session Stats" CTA
 *   data-testid="dock-remove-button" — remove the docked app (Phase 42 single-pane)
 *
 * Phase 43:
 *   data-testid="dock-add-trigger"          — "+ Add app to dock" popover trigger
 *   data-testid="dock-add-{uri}"            — app entry in the add popover
 *   data-testid="pane-header-{uri}"         — per-pane header
 *   data-testid="pane-collapse-{uri}"       — collapse/expand chevron button
 *   data-testid="pane-remove-{uri}"         — remove button in pane header
 *   data-testid="pane-divider"              — horizontal divider between panes
 *   data-testid="dock-pane-{uri}"           — pane outer container
 *
 * The toggle button is located by its aria-label ("Show/Hide app dock").
 */

import { test, expect } from "./fixtures"
import { Given } from "./bdd/given"

const DOCK_SELECTOR = '[data-testid="app-dock"]'
const DOCK_EMPTY_SELECTOR = '[data-testid="dock-empty-state"]'
const DOCK_TRY_BUTTON_SELECTOR = '[data-testid="dock-try-button"]'
const DOCK_REMOVE_BUTTON_SELECTOR = '[data-testid="dock-remove-button"]'
const TOGGLE_BUTTON_LABEL_SHOW = "Show app dock"
const TOGGLE_BUTTON_LABEL_HIDE = "Hide app dock"

const appDockConfig = { experimental: { app_dock: true } }

// All tests use the withProject fixture so the flag is seeded before navigation.
// Each scenario is self-contained.

test("dock starts hidden with flag enabled", { tag: "@smoke" }, async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      // The dock element is in the DOM (it uses display:none, not unmount)
      // but should not be visible.
      const dock = page.locator(DOCK_SELECTOR)
      await expect(dock).toBeAttached({ timeout: 5000 })
      await expect(dock).toBeHidden()
    },
    { extraConfig: appDockConfig },
  )
})

test("toggle button opens the dock and shows empty state", { tag: "@smoke" }, async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()

      const toggleBtn = page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW })
      await expect(toggleBtn).toBeVisible({ timeout: 5000 })
      await toggleBtn.click()

      const dock = page.locator(DOCK_SELECTOR)
      await expect(dock).toBeVisible({ timeout: 3000 })

      const emptyState = page.locator(DOCK_EMPTY_SELECTOR)
      await expect(emptyState).toBeVisible()
      await expect(emptyState).toContainText("Add an app to your dock")
    },
    { extraConfig: appDockConfig },
  )
})

test("toggle button hides the dock again", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()

      // Open
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      const dock = page.locator(DOCK_SELECTOR)
      await expect(dock).toBeVisible({ timeout: 3000 })

      // Hide
      const hideBtn = page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_HIDE })
      await expect(hideBtn).toBeVisible()
      await hideBtn.click()
      await expect(dock).toBeHidden({ timeout: 3000 })
    },
    { extraConfig: appDockConfig },
  )
})

test("keyboard shortcut Ctrl+\\ toggles the dock", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()

      const dock = page.locator(DOCK_SELECTOR)
      await expect(dock).toBeHidden()

      // Open via keyboard
      await page.keyboard.press("Control+\\")
      await expect(dock).toBeVisible({ timeout: 3000 })

      // Close via keyboard
      await page.keyboard.press("Control+\\")
      await expect(dock).toBeHidden({ timeout: 3000 })
    },
    { extraConfig: appDockConfig },
  )
})

test("clicking Try it: Add Session Stats adds app to dock", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()

      // Open dock
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      await expect(page.locator(DOCK_EMPTY_SELECTOR)).toBeVisible({ timeout: 3000 })

      // Click the example app CTA
      const tryBtn = page.locator(DOCK_TRY_BUTTON_SELECTOR)
      await expect(tryBtn).toBeVisible()
      await expect(tryBtn).toContainText("Session Stats")
      await tryBtn.click()

      // Empty state goes away, app pane appears with the app name
      await expect(page.locator(DOCK_EMPTY_SELECTOR)).not.toBeAttached({ timeout: 3000 })
      await expect(page.locator(DOCK_SELECTOR)).toContainText("Session Stats")
    },
    { extraConfig: appDockConfig },
  )
})

test("remove button returns dock to empty state", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()

      // Open dock and add example app
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      await page.locator(DOCK_TRY_BUTTON_SELECTOR).click()
      await expect(page.locator(DOCK_SELECTOR)).toContainText("Session Stats", { timeout: 3000 })

      // Remove it
      const removeBtn = page.locator(DOCK_REMOVE_BUTTON_SELECTOR)
      await expect(removeBtn).toBeVisible()
      await removeBtn.click()

      // Empty state should reappear
      await expect(page.locator(DOCK_EMPTY_SELECTOR)).toBeVisible({ timeout: 3000 })
    },
    { extraConfig: appDockConfig },
  )
})

test("dock state persists after page reload", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()

      // Open dock and add Session Stats
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      await page.locator(DOCK_TRY_BUTTON_SELECTOR).click()
      await expect(page.locator(DOCK_SELECTOR)).toContainText("Session Stats", { timeout: 3000 })

      // Reload
      await page.reload({ waitUntil: "networkidle" })

      // Dock should still be visible with Session Stats
      const dock = page.locator(DOCK_SELECTOR)
      await expect(dock).toBeVisible({ timeout: 5000 })
      await expect(dock).toContainText("Session Stats")
    },
    { extraConfig: appDockConfig },
  )
})

test("dock is absent when flag is off", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      // No dock element at all — feature is gated
      await expect(page.locator(DOCK_SELECTOR)).not.toBeAttached({ timeout: 5000 })
      await expect(page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW })).not.toBeAttached()
    },
    // No extraConfig → flag defaults to off
  )
})

// ── Phase 43: multi-pane scenarios ────────────────────────────────────────────

const ADD_TRIGGER_SELECTOR = '[data-testid="dock-add-trigger"]'
const STATS_URI = "ui://builtin/session-stats"
const GRAPH_URI = "ui://builtin/activity-graph"

test("Phase 43: add-app popover trigger is always visible", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      const dock = page.locator(DOCK_SELECTOR)
      await expect(dock).toBeVisible({ timeout: 3000 })
      // + Add button visible even when dock is empty
      await expect(page.locator(ADD_TRIGGER_SELECTOR)).toBeVisible({ timeout: 3000 })
    },
    { extraConfig: appDockConfig },
  )
})

test("Phase 43: add multiple apps via popover — two panes render", { tag: "@smoke" }, async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      await expect(page.locator(DOCK_SELECTOR)).toBeVisible({ timeout: 3000 })

      // Add Session Stats
      await page.locator(ADD_TRIGGER_SELECTOR).click()
      const statsTrigger = page.locator(`[data-testid="dock-add-${STATS_URI}"]`)
      await expect(statsTrigger).toBeVisible({ timeout: 3000 })
      await statsTrigger.click()

      // Add Activity Graph
      await page.locator(ADD_TRIGGER_SELECTOR).click()
      const graphTrigger = page.locator(`[data-testid="dock-add-${GRAPH_URI}"]`)
      await expect(graphTrigger).toBeVisible({ timeout: 3000 })
      await graphTrigger.click()

      // Both pane headers visible
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })
      await expect(page.locator(`[data-testid="pane-header-${GRAPH_URI}"]`)).toBeVisible({ timeout: 3000 })
      // One divider between two panes
      await expect(page.locator('[data-testid="pane-divider"]')).toHaveCount(1)
    },
    { extraConfig: appDockConfig },
  )
})

test("Phase 43: collapse a pane preserves its iframe (display:none, not unmount)", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()

      // Add Session Stats via try-it button (faster than popover in single-app test)
      await page.locator(DOCK_TRY_BUTTON_SELECTOR).click()
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })

      // Collapse the pane
      const collapseBtn = page.locator(`[data-testid="pane-collapse-${STATS_URI}"]`)
      await expect(collapseBtn).toBeVisible()
      await collapseBtn.click()

      // Header still present; pane content hidden (display:none) but not removed
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible()
      const pane = page.locator(`[data-testid="dock-pane-${STATS_URI}"]`)
      // The iframe container div has display:none but the pane stays in DOM
      await expect(pane).toBeAttached()

      // Expand again — header still there
      await collapseBtn.click()
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible()
    },
    { extraConfig: appDockConfig },
  )
})

test("Phase 43: remove pane via × button returns to empty state", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      await page.locator(DOCK_TRY_BUTTON_SELECTOR).click()
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })

      const removeBtn = page.locator(`[data-testid="pane-remove-${STATS_URI}"]`)
      await expect(removeBtn).toBeVisible()
      await removeBtn.click()

      await expect(page.locator(DOCK_EMPTY_SELECTOR)).toBeVisible({ timeout: 3000 })
    },
    { extraConfig: appDockConfig },
  )
})

test("Phase 43: already-added app is disabled in popover", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()

      // Add Session Stats via try-it
      await page.locator(DOCK_TRY_BUTTON_SELECTOR).click()
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })

      // Open add popover — Session Stats should be disabled
      await page.locator(ADD_TRIGGER_SELECTOR).click()
      const statsBtn = page.locator(`[data-testid="dock-add-${STATS_URI}"]`)
      await expect(statsBtn).toBeVisible({ timeout: 3000 })
      await expect(statsBtn).toBeDisabled()
      await expect(statsBtn).toContainText("in dock")
    },
    { extraConfig: appDockConfig },
  )
})

test("Phase 43: multi-pane state persists after reload", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      await expect(page.locator(DOCK_SELECTOR)).toBeVisible({ timeout: 3000 })

      // Add Session Stats
      await page.locator(ADD_TRIGGER_SELECTOR).click()
      const statsBtn = page.locator(`[data-testid="dock-add-${STATS_URI}"]`)
      await expect(statsBtn).toBeVisible({ timeout: 3000 })
      await statsBtn.click()

      // Add Activity Graph
      await page.locator(ADD_TRIGGER_SELECTOR).click()
      const graphBtn = page.locator(`[data-testid="dock-add-${GRAPH_URI}"]`)
      await expect(graphBtn).toBeVisible({ timeout: 3000 })
      await graphBtn.click()

      // Two panes visible
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })
      await expect(page.locator(`[data-testid="pane-header-${GRAPH_URI}"]`)).toBeVisible()

      // Reload
      await page.reload({ waitUntil: "networkidle" })

      // Both panes survive reload
      const dock = page.locator(DOCK_SELECTOR)
      await expect(dock).toBeVisible({ timeout: 5000 })
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })
      await expect(page.locator(`[data-testid="pane-header-${GRAPH_URI}"]`)).toBeVisible()
    },
    { extraConfig: appDockConfig },
  )
})

// ── Phase 44: legacy pinned-apps migration scenarios ──────────────────────────

test("Phase 44: legacy pinned apps migrate to dock on first open", { tag: "@smoke" }, async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession, directory }) => {
      // Seed 2 legacy pinned apps and clear the migration flag so the
      // migration runs on next page load.
      await Given.workspaceHasLegacyPinnedApps(page, directory, [
        { server: "__builtin__", name: "Session Stats", uri: STATS_URI },
        { server: "__builtin__", name: "Activity Graph", uri: GRAPH_URI },
      ])

      // Navigate again — migration runs on AppDockProvider mount.
      await gotoSession()

      // Dock should auto-open with both apps in pin order.
      const dock = page.locator(DOCK_SELECTOR)
      await expect(dock).toBeVisible({ timeout: 5000 })
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })
      await expect(page.locator(`[data-testid="pane-header-${GRAPH_URI}"]`)).toBeVisible()

      // Toast confirms the restoration.
      await expect(page.getByText("Restored 2 apps from your tab pins")).toBeVisible({ timeout: 3000 })
    },
    { extraConfig: appDockConfig },
  )
})

test("Phase 44: migration runs at most once per workspace", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession, directory }) => {
      // Seed legacy pins so migration fires.
      await Given.workspaceHasLegacyPinnedApps(page, directory, [
        { server: "__builtin__", name: "Session Stats", uri: STATS_URI },
        { server: "__builtin__", name: "Activity Graph", uri: GRAPH_URI },
      ])

      // First load — migration seeds both apps.
      await gotoSession()
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })
      await expect(page.locator(`[data-testid="pane-header-${GRAPH_URI}"]`)).toBeVisible()

      // Remove Session Stats.
      await page.locator(`[data-testid="pane-remove-${STATS_URI}"]`).click()
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).not.toBeAttached({ timeout: 3000 })

      // Reload — migration must NOT re-add the removed app.
      await gotoSession()
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).not.toBeAttached({ timeout: 3000 })
      // Activity Graph was not removed, so it should still be present.
      await expect(page.locator(`[data-testid="pane-header-${GRAPH_URI}"]`)).toBeVisible({ timeout: 3000 })
    },
    { extraConfig: appDockConfig },
  )
})

// ── Phase 45: Discovery consolidation scenarios ──────────────────────────────
//
// These tests validate the "single canonical discovery path" that Phase 45
// introduces: when the dock is enabled the session strip's Apps tab is hidden
// and Start-menu launches go to dock.add() instead of pinnedApps.pin().

test("Phase 45: Apps tab hidden when dock is enabled", { tag: "@smoke" }, async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      // When dock flag is on, the "Apps" tab trigger must not be present in
      // the session side panel strip.
      const appsTab = page.getByRole("tab", { name: "Apps" })
      await expect(appsTab).not.toBeAttached({ timeout: 5000 })
    },
    { extraConfig: appDockConfig },
  )
})

test("Phase 45: Apps tab visible when dock is disabled (regression)", async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()
      // With the flag off the Apps tab must still appear — no regression from v0.9.84.
      // Open the review panel first so the side panel is visible.
      await page
        .getByRole("button", { name: /review/i })
        .first()
        .click()
      const appsTab = page.getByRole("tab", { name: "Apps" })
      await expect(appsTab).toBeVisible({ timeout: 5000 })
    },
    // No extraConfig — flag defaults to false
  )
})

test(
  "Phase 45: Start menu launches go to the dock when flag is on",
  { tag: "@smoke" },
  async ({ page, withProject }) => {
    await withProject(
      async ({ gotoSession }) => {
        await gotoSession()

        // Open the Start menu
        const startBtn = page.getByRole("button", { name: /start/i })
        await expect(startBtn).toBeVisible({ timeout: 5000 })
        await startBtn.click()

        // Click Session Stats — should add it to the dock, NOT create a new
        // tab in the session strip.
        const statsEntry = page.getByRole("button", { name: "Session Stats" }).first()
        await expect(statsEntry).toBeVisible({ timeout: 3000 })
        await statsEntry.click()

        // Dock should open automatically and contain Session Stats.
        const dock = page.locator(DOCK_SELECTOR)
        await expect(dock).toBeVisible({ timeout: 3000 })
        await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })

        // No new "Session Stats" tab in the session strip (the review panel
        // strip only contains Review / Activity / file tabs in dock mode).
        const sessionStatsTab = page.getByRole("tab", { name: "Session Stats" })
        await expect(sessionStatsTab).not.toBeAttached({ timeout: 2000 })
      },
      { extraConfig: appDockConfig },
    )
  },
)

test('Phase 45: "in dock" badge prevents re-adding from Start menu', async ({ page, withProject }) => {
  await withProject(
    async ({ gotoSession }) => {
      await gotoSession()

      // Add Session Stats via the dock's Try-it button.
      await page.getByRole("button", { name: TOGGLE_BUTTON_LABEL_SHOW }).click()
      await page.locator(DOCK_TRY_BUTTON_SELECTOR).click()
      await expect(page.locator(`[data-testid="pane-header-${STATS_URI}"]`)).toBeVisible({ timeout: 3000 })

      // Open the Start menu.
      const startBtn = page.getByRole("button", { name: /start/i })
      await startBtn.click()

      // Session Stats row should show the "in dock" badge and be disabled.
      const statsRow = page.getByRole("button", { name: "Session Stats" }).first()
      await expect(statsRow).toBeVisible({ timeout: 3000 })
      await expect(statsRow).toBeDisabled()
      await expect(statsRow).toContainText("in dock")
    },
    { extraConfig: appDockConfig },
  )
})
