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
// packages/librecode — where the CLI backend lives.
const librecodeRoot = join(appRoot, "..", "librecode")
// Backend readiness endpoint (returns 200 without auth on loopback).
const backendReadyURL = "http://127.0.0.1:4096/config"

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

  // Phase 52F — TWO servers. The browser-mode specs navigate to a real
  // session route, which the SolidJS app can only render if it can reach
  // the librecode-cli backend (the web entry talks HTTP/SSE to :4096
  // directly — Tauri IPC mocks don't apply in web mode). The earlier
  // assumption that browser-mode tests hit "UI-only routes" was wrong and
  // is exactly why v0.10.0-.2 failed in CI: no backend → session view never
  // loads → [data-testid="app-dock"] never found.
  //
  // Playwright starts both, waits for each `url` to respond, then runs the
  // suite. reuseExistingServer is true locally (reuse a running dev setup)
  // and false in CI (Playwright owns the lifecycle).
  webServer: [
    {
      // librecode CLI backend — serves /session, /mcp, /event SSE, /config.
      command: "bun run --conditions=browser src/index.ts serve",
      cwd: librecodeRoot,
      url: backendReadyURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000, // cold bun start + model snapshot load can be slow
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Vite dev server (the UI).
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
  ],

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
