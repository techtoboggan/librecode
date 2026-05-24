import { describe, expect, test } from "bun:test"
import {
  addEntry,
  clampWidth,
  defaultDockState,
  migrateDockState,
  removeEntry,
  setEntryCollapsed,
  setEntryHeight,
  setWidth,
  toggleVisibility,
} from "./state"
import { DOCK_DEFAULT_WIDTH, DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "./types"

const SAMPLE_APP = { server: "__builtin__", name: "Session Stats", uri: "ui://builtin/session-stats" }

describe("clampWidth", () => {
  test("returns value unchanged when in range", () => {
    expect(clampWidth(400)).toBe(400)
  })

  test("clamps to MIN when below minimum", () => {
    expect(clampWidth(100)).toBe(DOCK_MIN_WIDTH)
  })

  test("clamps to MAX when above maximum", () => {
    expect(clampWidth(900)).toBe(DOCK_MAX_WIDTH)
  })

  test("clamps negative to MIN", () => {
    expect(clampWidth(-50)).toBe(DOCK_MIN_WIDTH)
  })

  test("returns DEFAULT for NaN", () => {
    expect(clampWidth(NaN)).toBe(DOCK_DEFAULT_WIDTH)
  })

  test("accepts boundary values exactly", () => {
    expect(clampWidth(DOCK_MIN_WIDTH)).toBe(DOCK_MIN_WIDTH)
    expect(clampWidth(DOCK_MAX_WIDTH)).toBe(DOCK_MAX_WIDTH)
  })
})

describe("defaultDockState", () => {
  test("visibility is hidden", () => {
    expect(defaultDockState().visibility).toBe("hidden")
  })

  test("width is the default width", () => {
    expect(defaultDockState().width).toBe(DOCK_DEFAULT_WIDTH)
  })

  test("entries is empty", () => {
    expect(defaultDockState().entries).toHaveLength(0)
  })
})

describe("migrateDockState", () => {
  test("undefined returns default state", () => {
    expect(migrateDockState(undefined)).toEqual(defaultDockState())
  })

  test("null returns default state", () => {
    expect(migrateDockState(null)).toEqual(defaultDockState())
  })

  test("empty object returns default state", () => {
    expect(migrateDockState({})).toEqual(defaultDockState())
  })

  test("valid state passes through unchanged", () => {
    const state = { visibility: "visible" as const, width: 350, entries: [] }
    const result = migrateDockState(state)
    expect(result.visibility).toBe("visible")
    expect(result.width).toBe(350)
    expect(result.entries).toHaveLength(0)
  })

  test("invalid visibility falls back to hidden", () => {
    const result = migrateDockState({ visibility: "open", width: 320, entries: [] })
    expect(result.visibility).toBe("hidden")
  })

  test("invalid width falls back to default clamped", () => {
    const result = migrateDockState({ visibility: "hidden", width: "wide", entries: [] })
    expect(result.width).toBe(DOCK_DEFAULT_WIDTH)
  })

  test("out-of-range width is clamped", () => {
    const result = migrateDockState({ visibility: "hidden", width: 10, entries: [] })
    expect(result.width).toBe(DOCK_MIN_WIDTH)
  })

  test("non-array entries becomes empty array", () => {
    const result = migrateDockState({ visibility: "hidden", width: 320, entries: "bad" })
    expect(result.entries).toHaveLength(0)
  })

  test("malformed entry items are dropped", () => {
    const result = migrateDockState({
      visibility: "hidden",
      width: 320,
      entries: [null, 42, "str", { missing: "fields" }],
    })
    expect(result.entries).toHaveLength(0)
  })

  test("entry missing server field is dropped", () => {
    const result = migrateDockState({
      visibility: "hidden",
      width: 320,
      entries: [{ uri: "ui://x", addedAt: 1, app: { name: "X", uri: "ui://x" } }],
    })
    expect(result.entries).toHaveLength(0)
  })

  test("valid entry survives migration", () => {
    const result = migrateDockState({
      visibility: "visible",
      width: 340,
      entries: [{ uri: SAMPLE_APP.uri, addedAt: 999, app: SAMPLE_APP }],
    })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].uri).toBe(SAMPLE_APP.uri)
    expect(result.entries[0].app.name).toBe("Session Stats")
  })
})

describe("addEntry", () => {
  const base = defaultDockState()

  test("appends a new entry", () => {
    const next = addEntry(base, { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0].uri).toBe(SAMPLE_APP.uri)
  })

  test("duplicate URI is a no-op (same reference returned)", () => {
    const with1 = addEntry(base, { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    const with2 = addEntry(with1, { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    expect(with2).toBe(with1)
    expect(with2.entries).toHaveLength(1)
  })

  test("multiple different entries are ordered by insertion", () => {
    const app2 = { server: "__builtin__", name: "Activity Graph", uri: "ui://builtin/activity-graph" }
    const s1 = addEntry(base, { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    const s2 = addEntry(s1, { uri: app2.uri, app: app2 })
    expect(s2.entries[0].uri).toBe(SAMPLE_APP.uri)
    expect(s2.entries[1].uri).toBe(app2.uri)
  })

  test("entry has addedAt timestamp set", () => {
    const before = Date.now()
    const next = addEntry(base, { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    const after = Date.now()
    expect(next.entries[0].addedAt).toBeGreaterThanOrEqual(before)
    expect(next.entries[0].addedAt).toBeLessThanOrEqual(after)
  })
})

describe("removeEntry", () => {
  const withEntry = addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })

  test("drops entry by URI", () => {
    const next = removeEntry(withEntry, SAMPLE_APP.uri)
    expect(next.entries).toHaveLength(0)
  })

  test("missing URI is a no-op (same reference returned)", () => {
    const next = removeEntry(withEntry, "ui://does/not/exist")
    expect(next).toBe(withEntry)
  })
})

describe("toggleVisibility", () => {
  test("hidden → visible", () => {
    const s = { ...defaultDockState(), visibility: "hidden" as const }
    expect(toggleVisibility(s).visibility).toBe("visible")
  })

  test("visible → hidden", () => {
    const s = { ...defaultDockState(), visibility: "visible" as const }
    expect(toggleVisibility(s).visibility).toBe("hidden")
  })
})

describe("setWidth", () => {
  test("passes through a valid value", () => {
    expect(setWidth(defaultDockState(), 400).width).toBe(400)
  })

  test("clamps below MIN", () => {
    expect(setWidth(defaultDockState(), 10).width).toBe(DOCK_MIN_WIDTH)
  })

  test("clamps above MAX", () => {
    expect(setWidth(defaultDockState(), 9999).width).toBe(DOCK_MAX_WIDTH)
  })
})

describe("setEntryCollapsed", () => {
  test("sets collapsed to true", () => {
    const s = addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    const next = setEntryCollapsed(s, SAMPLE_APP.uri, true)
    expect(next.entries[0].collapsed).toBe(true)
  })

  test("sets collapsed to false", () => {
    const s = addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    const with1 = setEntryCollapsed(s, SAMPLE_APP.uri, true)
    const with2 = setEntryCollapsed(with1, SAMPLE_APP.uri, false)
    expect(with2.entries[0].collapsed).toBe(false)
  })

  test("missing URI returns identity", () => {
    const s = addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    const next = setEntryCollapsed(s, "ui://does/not/exist", true)
    expect(next).toBe(s)
  })
})

describe("setEntryHeight", () => {
  test("sets heightPx on the entry", () => {
    const s = addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    const next = setEntryHeight(s, SAMPLE_APP.uri, 200)
    expect(next.entries[0].heightPx).toBe(200)
  })

  test("missing URI returns identity", () => {
    const s = addEntry(defaultDockState(), { uri: SAMPLE_APP.uri, app: SAMPLE_APP })
    const next = setEntryHeight(s, "ui://does/not/exist", 200)
    expect(next).toBe(s)
  })
})

describe("migrateDockState Phase 44 fields", () => {
  test("reads migratedFromPinnedAt: 1700000000 from raw input", () => {
    const result = migrateDockState({
      visibility: "hidden",
      width: 320,
      entries: [],
      migratedFromPinnedAt: 1700000000,
    })
    expect(result.migratedFromPinnedAt).toBe(1700000000)
  })

  test("defaults migratedFromPinnedAt to undefined when field is missing", () => {
    const result = migrateDockState({ visibility: "hidden", width: 320, entries: [] })
    expect(result.migratedFromPinnedAt).toBeUndefined()
  })

  test("defaults migratedFromPinnedAt to undefined when value is 0 or negative (defensive)", () => {
    const result0 = migrateDockState({ visibility: "hidden", width: 320, entries: [], migratedFromPinnedAt: 0 })
    expect(result0.migratedFromPinnedAt).toBeUndefined()

    const resultNeg = migrateDockState({
      visibility: "hidden",
      width: 320,
      entries: [],
      migratedFromPinnedAt: -1,
    })
    expect(resultNeg.migratedFromPinnedAt).toBeUndefined()
  })
})

describe("migrateDockState Phase 43 fields", () => {
  test("reads collapsed: true from raw input", () => {
    const result = migrateDockState({
      visibility: "visible",
      width: 340,
      entries: [{ uri: SAMPLE_APP.uri, addedAt: 999, app: SAMPLE_APP, collapsed: true }],
    })
    expect(result.entries[0].collapsed).toBe(true)
  })

  test("reads heightPx: 200 from raw input", () => {
    const result = migrateDockState({
      visibility: "visible",
      width: 340,
      entries: [{ uri: SAMPLE_APP.uri, addedAt: 999, app: SAMPLE_APP, heightPx: 200 }],
    })
    expect(result.entries[0].heightPx).toBe(200)
  })

  test("defaults collapsed to false when missing", () => {
    const result = migrateDockState({
      visibility: "visible",
      width: 340,
      entries: [{ uri: SAMPLE_APP.uri, addedAt: 999, app: SAMPLE_APP }],
    })
    expect(result.entries[0].collapsed).toBe(false)
  })

  test("defaults heightPx to undefined when missing", () => {
    const result = migrateDockState({
      visibility: "visible",
      width: 340,
      entries: [{ uri: SAMPLE_APP.uri, addedAt: 999, app: SAMPLE_APP }],
    })
    expect(result.entries[0].heightPx).toBeUndefined()
  })
})
