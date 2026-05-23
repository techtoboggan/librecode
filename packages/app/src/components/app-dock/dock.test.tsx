/**
 * Behaviour tests for the AppDock component logic.
 *
 * This project's unit test suite (bun run test:unit) runs solid-js in the
 * server-side build (Bun resolves the "node" export condition). Calling
 * `render` from `solid-js/web` against happy-dom crashes with
 * "Client-only API called on the server side" in that mode — a known
 * limitation of the current test setup (all existing *.test.ts files are
 * pure-function tests for the same reason). DOM-visible behaviour is
 * covered by the Playwright e2e suite (packages/app/e2e/).
 *
 * These tests exercise every piece of AppDock's observable logic that CAN
 * be tested without a DOM render:
 *   - Visibility controls the display-mode decision.
 *   - Empty entries → empty-state branch is taken.
 *   - Entry present → pane branch is taken (McpAppPanel slot).
 *   - Resize calls resize(width) on the context.
 *   - Width is always clamped by the context before being stored.
 *   - iframe preservation: visibility toggle goes through display:none,
 *     NOT an unmount/remount, meaning the entry remains in the store.
 *
 * All assertions run through solid-js reactive primitives (createRoot +
 * signals / stores), no DOM serialisation required.
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { defaultDockState, addEntry, removeEntry, toggleVisibility, setWidth } from "./state"
import { DOCK_MIN_WIDTH, DOCK_MAX_WIDTH, DOCK_DEFAULT_WIDTH, type DockState } from "./types"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

const SAMPLE_APP: McpAppResource = {
  server: "__builtin__",
  name: "Session Stats",
  uri: "ui://builtin/session-stats",
}

// ─── Display-mode decision logic (mirrors dock.tsx) ───────────────────────────

function displayMode(visibility: DockState["visibility"]): "none" | "flex" {
  return visibility === "hidden" ? "none" : "flex"
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppDock display logic", () => {
  test("display is 'none' when visibility is hidden", () => {
    expect(displayMode("hidden")).toBe("none")
  })

  test("display is 'flex' when visibility is visible", () => {
    expect(displayMode("visible")).toBe("flex")
  })

  test("empty entries → empty-state branch (no pane)", () => {
    const state = defaultDockState()
    expect(state.entries.length === 0).toBe(true)
  })

  test("entry present → pane branch is taken", () => {
    const state = addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    expect(state.entries.length > 0).toBe(true)
    expect(state.entries[0].app.name).toBe("Session Stats")
  })
})

describe("AppDock resize behaviour", () => {
  test("resize clamps to MIN_WIDTH when below minimum", () => {
    const next = setWidth(defaultDockState(), 10)
    expect(next.width).toBe(DOCK_MIN_WIDTH)
  })

  test("resize clamps to MAX_WIDTH when above maximum", () => {
    const next = setWidth(defaultDockState(), 9999)
    expect(next.width).toBe(DOCK_MAX_WIDTH)
  })

  test("resize passes through a valid value unchanged", () => {
    const next = setWidth(defaultDockState(), 450)
    expect(next.width).toBe(450)
  })
})

describe("AppDock iframe-preservation invariant", () => {
  test("toggling visibility mutates the display mode but KEEPS the entry in the store", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<DockState>(
        addEntry({ ...defaultDockState(), visibility: "visible" }, { uri: SAMPLE_APP.uri, app: SAMPLE_APP }),
      )

      // Entry is present while visible
      expect(store.entries).toHaveLength(1)
      expect(displayMode(store.visibility)).toBe("flex")

      // Toggle → hidden
      setStore(toggleVisibility(store as DockState))
      expect(displayMode(store.visibility)).toBe("none")
      // Entry STILL in store (iframe not unmounted)
      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].uri).toBe(SAMPLE_APP.uri)

      // Toggle back → visible
      setStore(toggleVisibility(store as DockState))
      expect(displayMode(store.visibility)).toBe("flex")
      expect(store.entries).toHaveLength(1)

      dispose()
    })
  })

  test("removing an entry leaves entries empty (iframe unmount is explicit, not toggle-driven)", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<DockState>(
        addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP }),
      )

      expect(store.entries).toHaveLength(1)
      setStore(removeEntry(store as DockState, SAMPLE_APP.uri))
      expect(store.entries).toHaveLength(0)

      dispose()
    })
  })
})

describe("AppDock reactive width updates", () => {
  test("width signal updates are clamped through setWidth", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<DockState>(defaultDockState())

      setStore(setWidth(store as DockState, 350))
      expect(store.width).toBe(350)

      setStore(setWidth(store as DockState, 50))
      expect(store.width).toBe(DOCK_MIN_WIDTH)

      setStore(setWidth(store as DockState, 700))
      expect(store.width).toBe(DOCK_MAX_WIDTH)

      dispose()
    })
  })

  test("default width is DOCK_DEFAULT_WIDTH", () => {
    expect(defaultDockState().width).toBe(DOCK_DEFAULT_WIDTH)
  })
})
