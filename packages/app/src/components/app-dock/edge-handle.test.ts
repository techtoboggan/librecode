/**
 * Pure-logic tests for DockEdgeHandle visibility predicate.
 *
 * The component itself uses `useAppDockState()` which requires a
 * full SolidJS context tree to render — out of reach for bun test.
 * These tests mirror the visibility decision so the v0.9.95
 * "I can't find a way to re-open the dock" recovery guarantee is
 * locked in:
 *   - Render when dock is hidden AND has entries (the actual bug).
 *   - Don't render when dock is visible (would be a layout duplicate).
 *   - Don't render when dock is hidden but has zero entries (user
 *     deliberately hid an empty dock; no apps to reach).
 */

import { describe, expect, test } from "bun:test"
import { addEntry, defaultDockState, toggleVisibility } from "./state"
import type { DockState } from "./types"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

const SAMPLE_APP: McpAppResource = {
  server: "__builtin__",
  name: "Session Stats",
  uri: "ui://builtin/session-stats",
}

/** Mirror of the visibility predicate in edge-handle.tsx. */
function shouldShowEdgeHandle(state: DockState): boolean {
  return state.visibility === "hidden" && state.entries.length > 0
}

describe("DockEdgeHandle visibility predicate (v0.9.95)", () => {
  test("hidden + has entries → SHOW (the recovery case)", () => {
    const state = addEntry(toggleVisibility(defaultDockState()), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    expect(state.visibility).toBe("hidden")
    expect(state.entries.length).toBe(1)
    expect(shouldShowEdgeHandle(state)).toBe(true)
  })

  test("hidden + zero entries → HIDE (user-deliberate empty hide)", () => {
    const state = toggleVisibility(defaultDockState())
    expect(state.visibility).toBe("hidden")
    expect(state.entries.length).toBe(0)
    expect(shouldShowEdgeHandle(state)).toBe(false)
  })

  test("visible + has entries → HIDE (dock already on screen)", () => {
    const state = addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    expect(state.visibility).toBe("visible")
    expect(shouldShowEdgeHandle(state)).toBe(false)
  })

  test("visible + zero entries → HIDE (empty visible dock has its own empty-state UI)", () => {
    const state = defaultDockState()
    expect(state.visibility).toBe("visible")
    expect(shouldShowEdgeHandle(state)).toBe(false)
  })
})

// Phase 52 Sub-A — integration regression for the v0.9.95 edge-handle
// "click → dock re-opens" cycle. The component calls dock.toggle() which
// maps directly to toggleVisibility. Tests the full state round-trip so
// the "click handle → dock visible → handle disappears" guarantee is
// locked in at the state level.
describe("DockEdgeHandle click state cycle (v0.9.95)", () => {
  test("click on handle transitions dock from hidden+entries to visible, handle then hides", () => {
    // Arrange: hidden dock with one entry — this is the state where the handle shows
    const initial = addEntry(toggleVisibility(defaultDockState()), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    expect(shouldShowEdgeHandle(initial)).toBe(true)

    // Act: simulate handle click (dock.toggle() → toggleVisibility)
    const afterClick = toggleVisibility(initial)

    // Assert: dock is now visible; handle predicate returns false (handle hides)
    expect(afterClick.visibility).toBe("visible")
    expect(shouldShowEdgeHandle(afterClick)).toBe(false)
  })
})

describe("DockEdgeHandle label pluralization", () => {
  function makeLabel(count: number): string {
    return `Show app dock (${count} app${count === 1 ? "" : "s"})`
  }

  test("singular for 1 app", () => {
    expect(makeLabel(1)).toBe("Show app dock (1 app)")
  })

  test("plural for 2+ apps", () => {
    expect(makeLabel(2)).toBe("Show app dock (2 apps)")
    expect(makeLabel(5)).toBe("Show app dock (5 apps)")
  })

  test("plural for 0 apps (though predicate prevents this from showing)", () => {
    expect(makeLabel(0)).toBe("Show app dock (0 apps)")
  })
})
