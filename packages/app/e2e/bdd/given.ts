/**
 * BDD "Given" step helpers for Playwright E2E tests.
 *
 * Usage:
 *   import { Given } from "./bdd/given"
 *   await Given.appIsLoaded(page)
 *   await Given.noProvidersConfigured(page)
 */

import type { Page } from "@playwright/test"

export const Given = {
  /** The app is loaded and interactive */
  async appIsLoaded(page: Page, url = "http://localhost:3000") {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })
    await page.waitForSelector("[data-component='prompt-input'], input, textarea, button", { timeout: 15000 })
  },

  /** No providers are configured (default dev state) */
  async noProvidersConfigured(_page: Page) {
    // Default state — no API keys in env
  },

  /** A specific provider is configured via localStorage seeding */
  async providerConfigured(page: Page, providerID: string, apiKey: string) {
    await page.evaluate(
      ({ providerID, apiKey }) => {
        // Seed localStorage with provider config
        const key = `librecode.provider.${providerID}`
        localStorage.setItem(key, JSON.stringify({ apiKey }))
      },
      { providerID, apiKey },
    )
  },
}
