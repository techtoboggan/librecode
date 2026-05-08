/**
 * v0.9.78 — tests for the local-server-wizard's pure helpers.
 *
 * The full component requires Solid context + the Settings dialog mount; those
 * paths are exercised manually + by the BDD provider suite. Here we lock in
 * the merge semantics that drive the rescan-and-update flow, since that's
 * the part most likely to regress and the easiest to test in isolation.
 */
import { describe, expect, test } from "bun:test"
import { buildModelPickerEntries, makeProviderID } from "./local-server-wizard"

describe("makeProviderID", () => {
  test("strips scheme + non-alphanumerics into a stable slug", () => {
    expect(makeProviderID("http://localhost:4000")).toBe("local-http-localhost-4000")
  })

  test("collapses runs of separators", () => {
    expect(makeProviderID("http://192.168.1.50:11434/")).toBe("local-http-192-168-1-50-11434-")
  })

  test("is case-insensitive on input but lowercases the slug", () => {
    expect(makeProviderID("HTTP://Server.Local:8080")).toBe("local-http-server-local-8080")
  })
})

describe("buildModelPickerEntries", () => {
  const serverModels = [
    { id: "llama3.1:8b", name: "llama3.1:8b" },
    { id: "qwen2:7b", name: "qwen2:7b" },
  ] as const

  test("first-time add — every model is pre-checked, none marked existing", () => {
    const out = buildModelPickerEntries(serverModels, new Set())
    expect(out).toHaveLength(2)
    expect(out.every((m) => m.selected)).toBe(true)
    expect(out.every((m) => !m.existing)).toBe(true)
  })

  test("rescan — existing models are pre-checked AND marked existing", () => {
    const existing = new Set(["llama3.1:8b"])
    const out = buildModelPickerEntries(serverModels, existing)
    const llama = out.find((m) => m.id === "llama3.1:8b")
    const qwen = out.find((m) => m.id === "qwen2:7b")
    expect(llama?.existing).toBe(true)
    expect(llama?.selected).toBe(true)
    expect(qwen?.existing).toBe(false)
    expect(qwen?.selected).toBe(true)
  })

  test("orphaned existing models (in config, not on server) are appended", () => {
    // User pulled `mistral-7b` from Ollama since the last sync. Wizard
    // surfaces it so the user can see it's still in their config.
    const existing = new Set(["llama3.1:8b", "mistral-7b"])
    const out = buildModelPickerEntries(serverModels, existing)
    expect(out).toHaveLength(3)
    const orphan = out.find((m) => m.id === "mistral-7b")
    expect(orphan?.existing).toBe(true)
    expect(orphan?.selected).toBe(true)
  })

  test("ordering: server models first, then orphaned existing", () => {
    const existing = new Set(["mistral-7b", "llama3.1:8b"])
    const out = buildModelPickerEntries(serverModels, existing)
    expect(out.map((m) => m.id)).toEqual(["llama3.1:8b", "qwen2:7b", "mistral-7b"])
  })

  test("server models with the same id as configured ones don't duplicate", () => {
    const existing = new Set(["llama3.1:8b", "qwen2:7b"])
    const out = buildModelPickerEntries(serverModels, existing)
    expect(out).toHaveLength(2)
    expect(out.every((m) => m.existing)).toBe(true)
  })

  test("empty server side + non-empty config — all entries appear as orphaned existing", () => {
    const existing = new Set(["a", "b"])
    const out = buildModelPickerEntries([], existing)
    expect(out.map((m) => m.id).sort()).toEqual(["a", "b"])
    expect(out.every((m) => m.existing && m.selected)).toBe(true)
  })

  test("empty server + empty config — no entries", () => {
    expect(buildModelPickerEntries([], new Set())).toEqual([])
  })
})
