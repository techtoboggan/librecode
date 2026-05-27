/**
 * Phase 54 — REAL tauri-mode regression for the v0.10.12 WebKitGTK dock crash.
 *
 * The bug: the App Dock's MCP-app iframe is `sandbox="allow-scripts"` with NO
 * `allow-same-origin`, so it runs at a null origin. The bridge-setup effect read
 * `iframe.contentDocument.readyState` on it, which throws a SecurityError in
 * WebKitGTK (Tauri's REAL webview):
 *
 *   "Sandbox access violation: Blocked a frame at 'tauri://localhost' from
 *    accessing a frame at 'null'. The frame being accessed is sandboxed and
 *    lacks the 'allow-same-origin' flag."
 *
 * That thrown getter aborted the effect and broke the ENTIRE App Dock on the
 * desktop build. Chromium silently returns `null` for the same access, so
 * browser-mode E2E (Chromium) and the web preview never caught it — only the
 * real WebKitGTK webview does. Fixed in v0.10.12 by tracking load state via a
 * WeakSet instead of touching the frame (packages/app/src/components/mcp-app-panel.tsx).
 *
 * Layer-1 guard: mcp-app-panel.sandbox-guard.test.ts (a source grep — fast, but
 * only catches the exact API strings). THIS spec is the end-to-end proof: it
 * opens the dock in the real native webview, adds a built-in MCP app (which
 * mounts the exact sandboxed `srcdoc` iframe that crashed), and asserts both
 *   (a) the dock + iframe actually render (the dock didn't break), AND
 *   (b) no sandbox SecurityError surfaced in the host webview console.
 *
 * This regression would have been caught by Layer 3.
 *
 * Advisory: runs in the non-blocking e2e-tauri.yml workflow (~30-min cold cargo
 * build). Keep it advisory until proven green across a few runs.
 */

import { test, expect, SESSION_URL } from "../fixtures/tauri-real"

const DOCK = '[data-testid="app-dock"]'
const TRY_BUTTON = '[data-testid="dock-try-button"]'
const STATS_URI = "ui://builtin/session-stats"
const STATS_PANE = `[data-testid="pane-header-${STATS_URI}"]`
const MCP_IFRAME = 'iframe[title="MCP App"]'

// Patterns that mean the WebKit sandbox cross-frame read regressed. The dock
// also breaks outright when this throws, but we capture the console signal too
// so a failure names the exact error instead of just "iframe never appeared".
const SANDBOX_ERROR = /Sandbox access violation|SecurityError|allow-same-origin/i

// Installs a host-window error sink BEFORE the iframe mounts. The SecurityError
// is thrown in the HOST window (reading into the null-origin frame), so the
// host's console.error / error / unhandledrejection handlers see it. Returns a
// marker so we can assert the hook actually installed.
const INSTALL_ERROR_SINK = `(() => {
  if (window.__DOCK_ERR_HOOK__) return "already"
  window.__DOCK_ERR_HOOK__ = true
  window.__DOCK_ERRORS__ = []
  const push = (s) => { try { window.__DOCK_ERRORS__.push(String(s)) } catch (e) {} }
  const fmt = (a) => (a && a.message) ? a.message : String(a)
  const orig = console.error.bind(console)
  console.error = (...args) => { push(args.map(fmt).join(" ")); orig(...args) }
  window.addEventListener("error", (e) => push((e.error && e.error.message) || e.message || String(e)))
  window.addEventListener("unhandledrejection", (e) => push((e.reason && e.reason.message) || String(e.reason)))
  return "installed"
})()`

const READ_ERRORS = `JSON.stringify(window.__DOCK_ERRORS__ || [])`

test("real webview: opening dock + a sandboxed MCP-app iframe does not crash (v0.10.12)", async ({ tauriPage }) => {
  // The fixture boots the app at the home route (devUrl `/`). Navigate to a
  // session route — the App Dock only lives there. Use the same full-reload
  // pattern the fixture uses for its initial nav, then wait for the plugin to
  // re-inject its instrumentation (`__PW_ACTIVE__`) on the new document.
  await tauriPage.evaluate(`window.location.href = ${JSON.stringify(SESSION_URL)}`)
  await tauriPage.waitForFunction('document.readyState === "complete" && !!window.__PW_ACTIVE__', 30_000)

  // The dock defaults to `visibility: "visible"` (state.ts), so on a fresh
  // launch it renders the empty state with the "Try it" CTA. Wait for it.
  await tauriPage.waitForSelector(DOCK, 15_000)
  expect(await tauriPage.isVisible(DOCK)).toBe(true)

  // Arm the error sink before the iframe mounts.
  const installed = await tauriPage.evaluate<string>(INSTALL_ERROR_SINK)
  expect(installed).toBe("installed")

  // Add the built-in Session Stats app. This is the path that crashed: it
  // mounts McpAppPanel → a `sandbox="allow-scripts"` `srcdoc` iframe → the
  // bridge-setup effect that used to read `iframe.contentDocument`.
  await tauriPage.waitForSelector(TRY_BUTTON, 10_000)
  await tauriPage.click(TRY_BUTTON)

  // (a) The pane + iframe actually render. If the SecurityError regressed, the
  // bridge-setup effect throws and the dock subtree breaks, so neither appears.
  await tauriPage.waitForSelector(STATS_PANE, 15_000)
  await tauriPage.waitForSelector(MCP_IFRAME, 15_000)
  expect(await tauriPage.count(MCP_IFRAME)).toBeGreaterThanOrEqual(1)

  // The iframe carries the exact sandbox attribute that triggers the WebKit
  // cross-frame restriction — confirm we're exercising the real code path.
  expect(await tauriPage.getAttribute(MCP_IFRAME, "sandbox")).toBe("allow-scripts")

  // The dock itself is still alive (the add button / pane still present), not
  // replaced by an ErrorBoundary fallback.
  expect(await tauriPage.isVisible(DOCK)).toBe(true)

  // (b) No sandbox SecurityError reached the host console. Give the bridge
  // handshake (postMessage round-trip after the iframe's `load`) a beat to run
  // — the throw, if it regressed, happens in that window. Sleep on the Node
  // side (the socket `eval` doesn't await in-webview promises).
  await new Promise((r) => setTimeout(r, 1500))
  const errors: string[] = JSON.parse(await tauriPage.evaluate<string>(READ_ERRORS))
  const offenders = errors.filter((e) => SANDBOX_ERROR.test(e))
  expect(offenders, `host webview console errors:\n${errors.join("\n")}`).toEqual([])
})
