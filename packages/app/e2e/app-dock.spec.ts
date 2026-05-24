/**
 * App Dock E2E tests (Phase 42 prototype)
 *
 * These tests require `experimental.app_dock = true` in the session config.
 * The `withProject` fixture accepts `extraConfig` which is merged into the
 * session's librecode.jsonc, so all tests in this file use the BDD helper
 * pattern to seed the flag before navigating.
 *
 * Selectors use data-testid attributes added in Phase 42:
 *   data-testid="app-dock"         — the outer dock wrapper (always in DOM)
 *   data-testid="dock-empty-state" — shown when no app is docked
 *   data-testid="dock-try-button"  — "Try it: Add Session Stats" CTA
 *   data-testid="dock-remove-button" — remove the docked app
 *
 * The toggle button is located by its aria-label ("Show/Hide app dock").
 */

import { test, expect } from "./fixtures"

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
