import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Phase 48 regression guard — ensures the legacy MCP pinned-app rendering
 * that was deleted in Phase 48 does not get re-introduced into
 * session-side-panel.tsx.
 *
 * Using a source-level grep rather than a DOM render because the provider
 * tree required to mount <SessionSidePanel> is prohibitively large for a
 * unit test. See Phase 48 spec §5c / Pitfall 7.
 */

const src = readFileSync(join(import.meta.dir, "session-side-panel.tsx"), "utf8")

test("session-side-panel.tsx contains no mcp-app: tab references (Phase 48)", () => {
  expect(src).not.toMatch(/mcp-app:/)
})

test("session-side-panel.tsx: mcpTabValue helper is gone (Phase 48)", () => {
  expect(src).not.toMatch(/mcpTabValue/)
})

test("session-side-panel.tsx: forceMount overlay hack is gone (Phase 48)", () => {
  expect(src).not.toMatch(/forceMount/)
})

test("session-side-panel.tsx: McpAppPanel import is gone (Phase 48)", () => {
  expect(src).not.toMatch(/McpAppPanel/)
})

test("session-side-panel.tsx: McpAppsTab import is gone (Phase 48)", () => {
  expect(src).not.toMatch(/MccAppsTab|McpAppsTab/)
})

test("session-side-panel.tsx: usePinnedApps import is gone (Phase 48)", () => {
  expect(src).not.toMatch(/usePinnedApps/)
})

test("session-side-panel.tsx is ≤500 lines (Phase 48 file-size target)", () => {
  const lineCount = src.split("\n").length
  // Trailing newline may add 1; be generous but strict
  expect(lineCount).toBeLessThanOrEqual(501)
})

test("session-side-panel.tsx delegates to SessionFileTreePanel (Phase 48)", () => {
  expect(src).toMatch(/SessionFileTreePanel/)
})
