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
 */

import { defineConfig, devices } from "@playwright/test"

const webPort = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
const webBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${webPort}`

export default defineConfig({
  testDir: "./tauri",
  outputDir: "./test-results-tauri",
  fullyParallel: false, // single Tauri instance per suite
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report-tauri", open: "never" }]]
    : "list",
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
