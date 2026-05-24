/**
 * BDD "Given" step helpers for Playwright E2E tests.
 *
 * Usage:
 *   import { Given } from "./bdd/given"
 *   await Given.appIsLoaded(page)
 *   await Given.noProvidersConfigured(page)
 */

import type { Page } from "@playwright/test"

interface LegacyApp {
  server: string
  name: string
  uri: string
  description?: string
}

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

  /**
   * Phase 44 — Seed legacy pinned-apps into localStorage for the given
   * workspace directory and clear the dock's `migratedFromPinnedAt` flag
   * so the migration runs on the next page load.
   *
   * The workspace storage key mirrors the logic in
   * `packages/app/src/utils/persist.ts` → workspaceStorage(dir).
   */
  async workspaceHasLegacyPinnedApps(page: Page, directory: string, apps: LegacyApp[]) {
    await page.evaluate(
      ({ dir, apps }) => {
        // FNV-1 hash — mirrors checksum() in @librecode/util/encode.
        function checksum(content: string): string {
          if (!content) return "0"
          let hash = 0x811c9dc5
          for (let i = 0; i < content.length; i++) {
            hash ^= content.charCodeAt(i)
            hash = Math.imul(hash, 0x01000193)
          }
          return (hash >>> 0).toString(36)
        }

        const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
        const sum = checksum(dir)
        const storage = `librecode.workspace.${head}.${sum}.dat`

        // Set legacy pinned-apps blob.
        localStorage.setItem(`${storage}:workspace:pinned-apps`, JSON.stringify({ apps }))

        // Clear the migration flag from dock state so the migration runs
        // on the next load (the flag may already be set from a prior session).
        const dockKey = `${storage}:workspace:app-dock-state`
        const raw = localStorage.getItem(dockKey)
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>
            delete parsed.migratedFromPinnedAt
            localStorage.setItem(dockKey, JSON.stringify(parsed))
          } catch {
            // Corrupt blob — safe to leave; migrateDockState will recover.
          }
        }
      },
      { dir: directory, apps },
    )
  },
}
