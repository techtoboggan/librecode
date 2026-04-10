/**
 * BDD "When" step helpers for Playwright E2E tests.
 *
 * Usage:
 *   import { When } from "./bdd/when"
 *   await When.clickModelSelector(page)
 *   await When.searchProviders(page, "litellm")
 */

import type { Page } from "@playwright/test"

export const When = {
  /** Click the model selector in the bottom bar */
  async clickModelSelector(page: Page) {
    await page.getByText("Select model", { exact: false }).first().click()
    await page.waitForTimeout(500)
  },

  /** Click "Show more providers" or similar provider list trigger */
  async clickShowProviders(page: Page) {
    const triggers = ["Show more providers", "Add more models", "Connect provider", "Show more"]
    for (const text of triggers) {
      const el = page.getByText(text, { exact: false }).first()
      if ((await el.count()) > 0) {
        await el.click()
        await page.waitForTimeout(500)
        return
      }
    }
    throw new Error("Could not find provider list trigger button")
  },

  /** Search for a provider in the connect dialog */
  async searchProviders(page: Page, query: string) {
    const input = page.locator("input[placeholder*='search' i], input[type='search'], [role='dialog'] input").first()
    await input.fill(query)
    await page.waitForTimeout(500)
  },

  /** Click any text on the page */
  async clickText(page: Page, text: string) {
    await page.getByText(text, { exact: false }).first().click()
    await page.waitForTimeout(300)
  },

  /** Open settings */
  async openSettings(page: Page) {
    await page.locator("[data-action='settings'], [aria-label='Settings']").first().click()
    await page.waitForTimeout(500)
  },
}
