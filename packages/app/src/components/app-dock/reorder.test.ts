import { describe, expect, test } from "bun:test"
import { reorderEntries, reorderEntriesByUri } from "./reorder"
import { addEntry, defaultDockState } from "./state"
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

describe("reorderEntries", () => {
  test("move from index 0 to 2 (first → last)", () => {
    const s = makeState("ui://a", "ui://b", "ui://c")
    const next = reorderEntries(s, 0, 2)
    expect(next.entries.map((e) => e.uri)).toEqual(["ui://b", "ui://c", "ui://a"])
  })

  test("move from index 2 to 0 (last → first)", () => {
    const s = makeState("ui://a", "ui://b", "ui://c")
    const next = reorderEntries(s, 2, 0)
    expect(next.entries.map((e) => e.uri)).toEqual(["ui://c", "ui://a", "ui://b"])
  })

  test("move from index 1 to 2 (middle → last)", () => {
    const s = makeState("ui://a", "ui://b", "ui://c")
    const next = reorderEntries(s, 1, 2)
    expect(next.entries.map((e) => e.uri)).toEqual(["ui://a", "ui://c", "ui://b"])
  })

  test("from === to is identity (same reference returned)", () => {
    const s = makeState("ui://a", "ui://b", "ui://c")
    const next = reorderEntries(s, 1, 1)
    expect(next).toBe(s)
  })

  test("from out of range returns identity", () => {
    const s = makeState("ui://a", "ui://b")
    expect(reorderEntries(s, 5, 0)).toBe(s)
    expect(reorderEntries(s, -1, 0)).toBe(s)
  })

  test("to out of range returns identity", () => {
    const s = makeState("ui://a", "ui://b")
    expect(reorderEntries(s, 0, 5)).toBe(s)
    expect(reorderEntries(s, 0, -1)).toBe(s)
  })

  test("empty array returns identity", () => {
    const s = defaultDockState()
    expect(reorderEntries(s, 0, 0)).toBe(s)
  })

  test("two-element swap", () => {
    const s = makeState("ui://a", "ui://b")
    const next = reorderEntries(s, 0, 1)
    expect(next.entries.map((e) => e.uri)).toEqual(["ui://b", "ui://a"])
  })
})

describe("reorderEntriesByUri", () => {
  test("reorders by URI", () => {
    const s = makeState("ui://a", "ui://b", "ui://c")
    const next = reorderEntriesByUri(s, "ui://c", "ui://a")
    expect(next.entries.map((e) => e.uri)).toEqual(["ui://c", "ui://a", "ui://b"])
  })

  test("unknown dragged URI returns identity", () => {
    const s = makeState("ui://a", "ui://b")
    expect(reorderEntriesByUri(s, "ui://x", "ui://a")).toBe(s)
  })

  test("unknown over URI returns identity", () => {
    const s = makeState("ui://a", "ui://b")
    expect(reorderEntriesByUri(s, "ui://a", "ui://x")).toBe(s)
  })

  test("same URI dragged over itself returns identity", () => {
    const s = makeState("ui://a", "ui://b")
    const next = reorderEntriesByUri(s, "ui://a", "ui://a")
    expect(next).toBe(s)
  })
})
