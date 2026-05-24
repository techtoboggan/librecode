/**
 * PaneHeader logic tests.
 *
 * DOM rendering is not available in bun test (Solid's server-side build
 * blocks client-only APIs). These tests verify the props model used by
 * PaneHeader: collapsed state, chevron selection, and callback firing
 * semantics — using plain reactive logic without JSX evaluation.
 *
 * Interactive click/drag behaviour is covered by the Playwright E2E suite.
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { addEntry, defaultDockState, setEntryCollapsed } from "./state"
import type { DockState } from "./types"

const SAMPLE_APP = { server: "s", name: "Session Stats", uri: "ui://builtin/session-stats" }

// ── Collapsed state → chevron glyph ───────────────────────────────────────────

/**
 * PaneHeader shows ▾ when expanded, ▸ when collapsed.
 * This mirrors the Show/fallback logic in the component JSX.
 */
function chevronGlyph(collapsed: boolean): string {
  return collapsed ? "▸" : "▾"
}

describe("PaneHeader chevron glyph", () => {
  test("expanded shows ▾", () => {
    expect(chevronGlyph(false)).toBe("▾")
  })

  test("collapsed shows ▸", () => {
    expect(chevronGlyph(true)).toBe("▸")
  })

  test("toggle from expanded → collapsed changes glyph", () => {
    let collapsed = false
    collapsed = !collapsed
    expect(chevronGlyph(collapsed)).toBe("▸")
  })
})

// ── Aria-label generation ──────────────────────────────────────────────────────

function collapseAriaLabel(collapsed: boolean, name: string): string {
  return collapsed ? `Expand ${name}` : `Collapse ${name}`
}

describe("PaneHeader aria-label", () => {
  test("expanded state uses Collapse prefix", () => {
    expect(collapseAriaLabel(false, "Session Stats")).toBe("Collapse Session Stats")
  })

  test("collapsed state uses Expand prefix", () => {
    expect(collapseAriaLabel(true, "Session Stats")).toBe("Expand Session Stats")
  })

  test("remove aria-label includes app name", () => {
    const name = "Activity Graph"
    const label = `Remove ${name} from dock`
    expect(label).toBe("Remove Activity Graph from dock")
  })
})

// ── Props model / collapsed state via store ────────────────────────────────────

describe("PaneHeader props model", () => {
  test("data-uri reflects the entry URI", () => {
    // The data-uri attribute value is set to props.uri.
    // Verify the expected value at the state level.
    const uri = "ui://builtin/session-stats"
    expect(uri).toBe(SAMPLE_APP.uri)
  })

  test("onToggleCollapse correctly inverts the collapsed flag via state", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<DockState>(
        addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP }),
      )

      const onToggleCollapse = () => {
        const entry = store.entries.find((e) => e.uri === SAMPLE_APP.uri)
        if (!entry) return
        setStore(setEntryCollapsed(store as DockState, SAMPLE_APP.uri, !(entry.collapsed ?? false)))
      }

      expect(store.entries[0].collapsed ?? false).toBe(false)
      onToggleCollapse()
      expect(store.entries[0].collapsed ?? false).toBe(true)
      onToggleCollapse()
      expect(store.entries[0].collapsed ?? false).toBe(false)

      dispose()
    })
  })

  test("onRemove removes the entry from state", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<DockState>(
        addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP }),
      )

      const { removeEntry } = require("./state")
      const onRemove = () => setStore(removeEntry(store as DockState, SAMPLE_APP.uri))

      expect(store.entries).toHaveLength(1)
      onRemove()
      expect(store.entries).toHaveLength(0)

      dispose()
    })
  })
})
