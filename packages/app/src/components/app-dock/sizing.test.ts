import { describe, expect, test } from "bun:test"
import { paneHeight, applyDividerDrag, PANE_MIN_HEIGHT, PANE_HEADER_HEIGHT } from "./sizing"
import { addEntry, defaultDockState, setEntryCollapsed, setEntryHeight } from "./state"
import type { DockState } from "./types"

const APP_A = { server: "s", name: "A", uri: "ui://a" }
const APP_B = { server: "s", name: "B", uri: "ui://b" }
const APP_C = { server: "s", name: "C", uri: "ui://c" }

function makeState(...uris: string[]): DockState {
  const apps = [APP_A, APP_B, APP_C]
  let s = defaultDockState()
  for (const uri of uris) {
    const app = apps.find((a) => a.uri === uri)!
    s = addEntry(s, { uri, app })
  }
  return s
}

describe("paneHeight", () => {
  test("single un-overridden pane gets full available height", () => {
    const s = makeState("ui://a")
    expect(paneHeight(s, "ui://a", 400)).toBe(400)
  })

  test("two un-overridden panes split equally", () => {
    const s = makeState("ui://a", "ui://b")
    expect(paneHeight(s, "ui://a", 400)).toBe(200)
    expect(paneHeight(s, "ui://b", 400)).toBe(200)
  })

  test("three un-overridden panes split into thirds", () => {
    const s = makeState("ui://a", "ui://b", "ui://c")
    const h = paneHeight(s, "ui://a", 300)
    expect(h).toBeCloseTo(100)
  })

  test("collapsed pane returns PANE_HEADER_HEIGHT", () => {
    const s = setEntryCollapsed(makeState("ui://a", "ui://b"), "ui://a", true)
    expect(paneHeight(s, "ui://a", 400)).toBe(PANE_HEADER_HEIGHT)
  })

  test("collapsed pane reduces available height for expanded panes", () => {
    const s = setEntryCollapsed(makeState("ui://a", "ui://b"), "ui://a", true)
    const expandedH = paneHeight(s, "ui://b", 400)
    expect(expandedH).toBe(400 - PANE_HEADER_HEIGHT)
  })

  test("explicit heightPx is respected", () => {
    const s = setEntryHeight(makeState("ui://a"), "ui://a", 250)
    expect(paneHeight(s, "ui://a", 400)).toBe(250)
  })

  test("explicit heightPx is clamped to PANE_MIN_HEIGHT", () => {
    const s = setEntryHeight(makeState("ui://a"), "ui://a", 10)
    expect(paneHeight(s, "ui://a", 400)).toBe(PANE_MIN_HEIGHT)
  })

  test("missing URI returns 0", () => {
    const s = makeState("ui://a")
    expect(paneHeight(s, "ui://x", 400)).toBe(0)
  })
})

describe("applyDividerDrag", () => {
  test("positive delta grows above and shrinks below", () => {
    const s = makeState("ui://a", "ui://b")
    const next = applyDividerDrag(s, "ui://a", "ui://b", 50, 400)
    expect(next.entries[0].heightPx).toBe(250) // 200 + 50
    expect(next.entries[1].heightPx).toBe(150) // 200 - 50
  })

  test("negative delta shrinks above and grows below", () => {
    const s = makeState("ui://a", "ui://b")
    const next = applyDividerDrag(s, "ui://a", "ui://b", -50, 400)
    expect(next.entries[0].heightPx).toBe(150) // 200 - 50
    expect(next.entries[1].heightPx).toBe(250) // 200 + 50
  })

  test("drag that would push below PANE_MIN_HEIGHT clamps to min", () => {
    const s = makeState("ui://a", "ui://b")
    // 200 - 300 = -100, clamped to PANE_MIN_HEIGHT
    const next = applyDividerDrag(s, "ui://a", "ui://b", 300, 400)
    expect(next.entries[1].heightPx).toBe(PANE_MIN_HEIGHT)
  })

  test("drag that would push above below PANE_MIN_HEIGHT clamps to min", () => {
    const s = makeState("ui://a", "ui://b")
    const next = applyDividerDrag(s, "ui://a", "ui://b", -300, 400)
    expect(next.entries[0].heightPx).toBe(PANE_MIN_HEIGHT)
  })

  test("missing above URI returns identity", () => {
    const s = makeState("ui://a", "ui://b")
    expect(applyDividerDrag(s, "ui://x", "ui://b", 50, 400)).toBe(s)
  })

  test("missing below URI returns identity", () => {
    const s = makeState("ui://a", "ui://b")
    expect(applyDividerDrag(s, "ui://a", "ui://x", 50, 400)).toBe(s)
  })

  test("unaffected entries are unchanged", () => {
    const s = makeState("ui://a", "ui://b", "ui://c")
    const next = applyDividerDrag(s, "ui://a", "ui://b", 50, 600)
    // ui://c entry object is the same reference
    expect(next.entries[2]).toBe(s.entries[2])
  })
})
