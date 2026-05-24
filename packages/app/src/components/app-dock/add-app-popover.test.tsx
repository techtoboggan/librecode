/**
 * AddAppPopover logic tests.
 *
 * DOM rendering is not available in bun test (Solid's server-side build
 * blocks client-only APIs). These tests verify the `isInDock` filtering
 * logic and the app list management semantics that underlie the popover.
 *
 * Full interactive behaviour (open popover, click to add) is covered by
 * the Playwright E2E suite in packages/app/e2e/app-dock.spec.ts.
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { addEntry, defaultDockState } from "./state"
import type { DockState } from "./types"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

const STATS_APP: McpAppResource = { server: "__builtin__", name: "Session Stats", uri: "ui://builtin/session-stats" }
const GRAPH_APP: McpAppResource = { server: "__builtin__", name: "Activity Graph", uri: "ui://builtin/activity-graph" }
const MULTICA_APP: McpAppResource = { server: "multica", name: "Multica", uri: "ui://multica" }

// ── isInDock logic ─────────────────────────────────────────────────────────────

/**
 * Mirrors AddAppPopover's `isInDock` predicate.
 */
function isInDock(state: DockState, uri: string): boolean {
  return state.entries.some((e) => e.uri === uri)
}

describe("isInDock predicate", () => {
  test("returns false when dock is empty", () => {
    const s = defaultDockState()
    expect(isInDock(s, STATS_APP.uri)).toBe(false)
  })

  test("returns true when app is in the dock", () => {
    const s = addEntry(defaultDockState(), { uri: STATS_APP.uri, app: STATS_APP })
    expect(isInDock(s, STATS_APP.uri)).toBe(true)
  })

  test("returns false for an app not in the dock", () => {
    const s = addEntry(defaultDockState(), { uri: STATS_APP.uri, app: STATS_APP })
    expect(isInDock(s, GRAPH_APP.uri)).toBe(false)
  })

  test("reflects dock changes reactively via store", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<DockState>(defaultDockState())

      expect(isInDock(store as DockState, STATS_APP.uri)).toBe(false)
      setStore(addEntry(store as DockState, { uri: STATS_APP.uri, app: STATS_APP }))
      expect(isInDock(store as DockState, STATS_APP.uri)).toBe(true)

      dispose()
    })
  })
})

// ── App list filtering ─────────────────────────────────────────────────────────

describe("app list filtering (in-dock apps marked disabled)", () => {
  const allApps = [STATS_APP, GRAPH_APP, MULTICA_APP]

  test("no apps are disabled when dock is empty", () => {
    const s = defaultDockState()
    const disabled = allApps.filter((a) => isInDock(s, a.uri))
    expect(disabled).toHaveLength(0)
  })

  test("one app disabled after adding it to dock", () => {
    const s = addEntry(defaultDockState(), { uri: STATS_APP.uri, app: STATS_APP })
    const disabled = allApps.filter((a) => isInDock(s, a.uri))
    expect(disabled).toHaveLength(1)
    expect(disabled[0].uri).toBe(STATS_APP.uri)
  })

  test("all apps disabled after adding all to dock", () => {
    let s = defaultDockState()
    for (const app of allApps) {
      s = addEntry(s, { uri: app.uri, app })
    }
    const disabled = allApps.filter((a) => isInDock(s, a.uri))
    expect(disabled).toHaveLength(allApps.length)
  })

  test("available (non-disabled) apps decrease as dock fills", () => {
    let s = defaultDockState()
    expect(allApps.filter((a) => !isInDock(s, a.uri))).toHaveLength(3)
    s = addEntry(s, { uri: STATS_APP.uri, app: STATS_APP })
    expect(allApps.filter((a) => !isInDock(s, a.uri))).toHaveLength(2)
    s = addEntry(s, { uri: GRAPH_APP.uri, app: GRAPH_APP })
    expect(allApps.filter((a) => !isInDock(s, a.uri))).toHaveLength(1)
  })
})
