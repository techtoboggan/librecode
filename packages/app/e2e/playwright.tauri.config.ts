/**
 * Phase 52 Sub-C — Playwright config for Tauri-specific E2E tests.
 *
 * Separate from the existing playwright.config.ts (which drives the web
 * preview E2E suite). This config points exclusively at e2e/tauri/ tests
 * and supports three execution modes:
 *
 *   browser  — headless Chromium + mocked Tauri IPC (fast, CI default)
 *   tauri    — real native webview via socket bridge (pre-release)
 *   cdp      — direct CDP to WebView2 (Windows only, future)
 *
 * Run:
 *   bun run test:e2e:tauri:browser   # fast iteration
 *   bun run test:e2e:tauri:tauri     # real webview pre-release
 *
 * webServer (Phase 52D):
 *   reuseExistingServer is true locally (dev server must already be running)
 *   and false in CI (Playwright starts + stops the server for the test run).
 *   Uses VITE_LIBRECODE_SERVER_HOST=127.0.0.1 to prevent the app from
 *   hanging on an unavailable backend in CI.
 */

import { defineConfig, devices } from "@playwright/test"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const webPort = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
const webBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${webPort}`

// Root of packages/app/ (parent of this config file's directory)
const appRoot = fileURLToPath(new URL("..", import.meta.url))

export default defineConfig({
  testDir: "./tauri",
  outputDir: "./test-results-tauri",
  fullyParallel: false, // single Tauri instance per suite
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: join(appRoot, "e2e/playwright-report-tauri"), open: "never" }]]
    : "list",

  // Auto-start the Vite dev server in CI; reuse existing server locally.
  // In CI there is no running backend at :4096 — browser-mode tests
  // do not require it because they navigate to UI-only routes and check
  // DOM structure / console errors, not live data.
  webServer: {
    command: "bun run dev",
    cwd: appRoot,
    url: webBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // Suppress Vite from auto-opening a browser tab in CI
      BROWSER: "none",
    },
  },

  use: {
    baseURL: webBaseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      // browser: headless Chromium with mocked Tauri IPC — default for CI
      name: "browser",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // tauri: real native webview via socket bridge — pre-release only
      name: "tauri",
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
})
