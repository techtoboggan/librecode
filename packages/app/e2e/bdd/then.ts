/**
 * BDD "Then" step helpers for Playwright E2E tests.
 *
 * Usage:
 *   import { Then } from "./bdd/then"
 *   await Then.shouldSeeText(page, "LiteLLM")
 *   await Then.shouldNotSeeText(page, "opencode")
 */

import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

export const Then = {
  /** Assert text is visible on the page */
  async shouldSeeText(page: Page, text: string) {
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 5000 })
  },

  /** Assert text is NOT visible on the page */
  async shouldNotSeeText(page: Page, text: string) {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0, { timeout: 3000 })
  },

  /** Assert page title contains text */
  async titleContains(page: Page, text: string) {
    await expect(page).toHaveTitle(new RegExp(text, "i"), { timeout: 5000 })
  },

  /** Assert a dialog/modal is visible */
  async dialogIsVisible(page: Page) {
    await expect(
      page.locator("[role='dialog'], [data-component='model-selector'], [data-component='dialog']").first(),
    ).toBeVisible({ timeout: 5000 })
  },

  /** Assert page source does NOT contain a string (case-insensitive) */
  async sourceDoesNotContain(page: Page, text: string, exceptions: string[] = []) {
    const content = await page.content()
    const lines = content.split("\n")
    const violations: string[] = []

    for (const [i, line] of lines.entries()) {
      if (line.toLowerCase().includes(text.toLowerCase())) {
        if (exceptions.some((exc) => line.toLowerCase().includes(exc.toLowerCase()))) continue
        violations.push(`Line ${i}: ${line.trim().slice(0, 100)}`)
      }
    }

    expect(violations, `Found "${text}" in page source:\n${violations.slice(0, 5).join("\n")}`).toHaveLength(0)
  },

  /** Assert at least N items are visible matching a selector */
  async hasItems(page: Page, selector: string, minCount = 1) {
    const items = page.locator(selector)
    await expect(items).toHaveCount(minCount, { timeout: 5000 })
  },
}
