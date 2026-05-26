/**
 * StartMenu logic tests (Phase 45 — Discovery Consolidation).
 *
 * DOM rendering is not available in bun test (Solid's server-side build
 * blocks client-only APIs). These tests verify the reactive logic that
 * backs the menu's dock-aware behaviour:
 *
 *   1. The `inDock` predicate — gates "in dock" badge visibility and
 *      button disabled state.
 *   2. The `onLaunch` branching — dock-enabled path vs. legacy path.
 *
 * Full interactive behaviour (open menu, click rows, Esc to close,
 * badge renders) is covered by the Playwright E2E suite in
 * packages/app/e2e/app-dock.spec.ts (Phase 45 scenarios).
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { addEntry, defaultDockState } from "@/components/app-dock/state"
import { toggleVisibility } from "@/components/app-dock/state"
import type { DockState } from "@/components/app-dock/types"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

const STATS_APP: McpAppResource = {
  server: "__builtin__",
  name: "Session Stats",
  uri: "ui://builtin/session-stats",
}
const GRAPH_APP: McpAppResource = {
  server: "__builtin__",
  name: "Activity Graph",
  uri: "ui://builtin/activity-graph",
}
const MULTICA_APP: McpAppResource = {
  server: "multica",
  name: "Multica Board",
  uri: "ui://multica/board",
  description: "Kanban board",
}

const ALL_APPS = [STATS_APP, GRAPH_APP, MULTICA_APP]

// ── inDock predicate ──────────────────────────────────────────────────────────
//
// Mirrors the `inDock` accessor inside StartMenu:
//   dockEnabled() && (dockCtx?.state().entries ?? []).some(e => e.uri === app.uri)

function inDockPredicate(dockEnabled: boolean, state: DockState, app: McpAppResource): boolean {
  return dockEnabled && state.entries.some((e) => e.uri === app.uri)
}

describe("inDock predicate", () => {
  test("returns false when dock is disabled regardless of entries", () => {
    const s = addEntry(defaultDockState(), { uri: STATS_APP.uri, app: STATS_APP })
    expect(inDockPredicate(false, s, STATS_APP)).toBe(false)
  })

  test("returns false when dock is enabled but app not in dock", () => {
    expect(inDockPredicate(true, defaultDockState(), STATS_APP)).toBe(false)
  })

  test("returns true when dock is enabled and app is present in dock", () => {
    const s = addEntry(defaultDockState(), { uri: STATS_APP.uri, app: STATS_APP })
    expect(inDockPredicate(true, s, STATS_APP)).toBe(true)
  })

  test("returns false for an app whose URI is not in the dock", () => {
    const s = addEntry(defaultDockState(), { uri: STATS_APP.uri, app: STATS_APP })
    expect(inDockPredicate(true, s, GRAPH_APP)).toBe(false)
  })

  test("reflects reactive store mutations when dock is enabled", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<DockState>(defaultDockState())

      expect(inDockPredicate(true, store as DockState, STATS_APP)).toBe(false)
      setStore(addEntry(store as DockState, { uri: STATS_APP.uri, app: STATS_APP }))
      expect(inDockPredicate(true, store as DockState, STATS_APP)).toBe(true)

      dispose()
    })
  })
})

// ── In-dock filtering across the app list ─────────────────────────────────────

describe("Start menu in-dock row filtering", () => {
  test("no apps are disabled when the dock is empty", () => {
    const disabled = ALL_APPS.filter((a) => inDockPredicate(true, defaultDockState(), a))
    expect(disabled).toHaveLength(0)
  })

  test("one app disabled after it is added to the dock", () => {
    const s = addEntry(defaultDockState(), { uri: STATS_APP.uri, app: STATS_APP })
    const disabled = ALL_APPS.filter((a) => inDockPredicate(true, s, a))
    expect(disabled).toHaveLength(1)
    expect(disabled[0].uri).toBe(STATS_APP.uri)
  })

  test("all apps disabled once every app is in the dock", () => {
    let s = defaultDockState()
    for (const app of ALL_APPS) s = addEntry(s, { uri: app.uri, app })
    const disabled = ALL_APPS.filter((a) => inDockPredicate(true, s, a))
    expect(disabled).toHaveLength(ALL_APPS.length)
  })

  test("no apps disabled with dock flag off — even if dock has entries", () => {
    let s = defaultDockState()
    for (const app of ALL_APPS) s = addEntry(s, { uri: app.uri, app })
    const disabled = ALL_APPS.filter((a) => inDockPredicate(false, s, a))
    expect(disabled).toHaveLength(0)
  })

  test("available apps count decreases as dock fills (dock enabled)", () => {
    let s = defaultDockState()
    expect(ALL_APPS.filter((a) => !inDockPredicate(true, s, a))).toHaveLength(3)
    s = addEntry(s, { uri: STATS_APP.uri, app: STATS_APP })
    expect(ALL_APPS.filter((a) => !inDockPredicate(true, s, a))).toHaveLength(2)
    s = addEntry(s, { uri: GRAPH_APP.uri, app: GRAPH_APP })
    expect(ALL_APPS.filter((a) => !inDockPredicate(true, s, a))).toHaveLength(1)
  })
})

// ── onLaunch branching (session-header.tsx) ───────────────────────────────────
//
// Mirrors the branching added in session-header.tsx's onLaunch callback:
//   if (dockEnabled && dockCtx) → dock.add() + optional toggle
//   else                        → pinnedApps.pin() + tabs.open()

type LaunchResult = {
  branch: "dock" | "legacy"
  dockedUri: string | undefined
  dockAutoOpened: boolean
}

/**
 * Simulate the session-header.tsx onLaunch decision for a given dock state.
 * Returns which branch was taken and the side-effects that would have fired.
 */
function simulateLaunch(dockEnabled: boolean, dockState: DockState, app: McpAppResource): LaunchResult {
  if (dockEnabled) {
    const dockAutoOpened = dockState.visibility === "hidden"
    return { branch: "dock", dockedUri: app.uri, dockAutoOpened }
  }
  return { branch: "legacy", dockedUri: undefined, dockAutoOpened: false }
}

describe("onLaunch branching — dock vs. legacy path", () => {
  test("routes to dock branch when experimental.app_dock is true", () => {
    const { branch } = simulateLaunch(true, defaultDockState(), STATS_APP)
    expect(branch).toBe("dock")
  })

  test("routes to legacy branch when experimental.app_dock is false", () => {
    const { branch } = simulateLaunch(false, defaultDockState(), STATS_APP)
    expect(branch).toBe("legacy")
  })

  test("dock auto-opens when launched into a hidden dock (pitfall #5)", () => {
    // v0.9.91 default is visible — explicitly hide first to drive the auto-open path.
    const hidden = toggleVisibility(defaultDockState()) // "visible" → "hidden"
    const { dockAutoOpened } = simulateLaunch(true, hidden, STATS_APP)
    expect(dockAutoOpened).toBe(true)
  })

  test("dock does NOT auto-toggle when it is already visible (v0.9.91 default)", () => {
    // defaultDockState() now starts visible, so launch should not flip it.
    const { dockAutoOpened } = simulateLaunch(true, defaultDockState(), STATS_APP)
    expect(dockAutoOpened).toBe(false)
  })

  test("dock branch captures the correct app URI", () => {
    const { dockedUri } = simulateLaunch(true, defaultDockState(), MULTICA_APP)
    expect(dockedUri).toBe(MULTICA_APP.uri)
  })

  test("legacy branch produces no dockedUri or dock toggle", () => {
    const { dockedUri, dockAutoOpened } = simulateLaunch(false, defaultDockState(), STATS_APP)
    expect(dockedUri).toBeUndefined()
    expect(dockAutoOpened).toBe(false)
  })
})
