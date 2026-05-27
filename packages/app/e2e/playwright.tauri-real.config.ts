/**
 * Phase 54 — Playwright config for REAL tauri-mode E2E (socket bridge).
 *
 * Isolated from playwright.tauri.config.ts (browser-mode) so the working
 * browser hard gate is never at risk. One project, `tauri`, with the
 * `mode: "tauri"` fixture option that switches createTauriTest into
 * socket-bridge mode (see fixtures/tauri-real.ts).
 *
 * No webServer here: `bun tauri dev` (launched by TauriProcessManager
 * via the fixture's tauriCommand) starts Vite + the app + its own
 * sidecar. CI runs this under xvfb-run on a headless runner.
 */

import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const appRoot = fileURLToPath(new URL("..", import.meta.url))

export default defineConfig({
  testDir: "./tauri-real",
  outputDir: "./test-results-tauri-real",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // The whole suite shares one launched app; give the cold build room.
  timeout: 15 * 60 * 1000,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: join(appRoot, "e2e/playwright-report-tauri-real"), open: "never" }]]
    : "list",
  projects: [
    {
      name: "tauri",
      // Switches createTauriTest (fixtures/tauri-real.ts) into socket-bridge mode.
      use: { mode: "tauri" } as Record<string, unknown>,
    },
  ],
})
