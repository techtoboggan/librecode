import { describe, expect, test } from "bun:test"

// Mirror of summarizeActivity() in src/mcp/builtin-apps/fs-activity-graph.html.
// The real function lives in a sandboxed srcdoc <script> and can't be imported,
// so we mirror it here (the established pattern for app-dock pane logic) to lock
// the contract: glanceable counts + the lead active file, never an enumerated
// wall of phases. If you change the HTML's summarizeActivity, change this too.
const ACTIVE_PHASES = new Set(["pending", "running", "thinking", "tool_use", "working"])

interface Agent {
  phase?: string
  file?: string | null
}

function summarizeActivity(map: Record<string, Agent>) {
  let active = 0
  let done = 0
  let error = 0
  let other = 0
  let total = 0
  let activeFile: string | null = null
  for (const a of Object.values(map)) {
    if (!a || !a.phase || a.phase === "exit") continue
    total++
    if (ACTIVE_PHASES.has(a.phase)) {
      active++
      if (!activeFile && a.file) activeFile = a.file
    } else if (a.phase === "error" || a.phase === "cancelled") {
      error++
    } else if (a.phase === "completed") {
      done++
    } else {
      other++
    }
  }
  return { active, done, error, other, total, activeFile }
}

describe("activity graph summarizeActivity (mirror contract)", () => {
  test("empty map → all zeros, no active file", () => {
    expect(summarizeActivity({})).toEqual({ active: 0, done: 0, error: 0, other: 0, total: 0, activeFile: null })
  })

  test("single active agent surfaces its file", () => {
    const s = summarizeActivity({ a1: { phase: "running", file: "src/auth.ts" } })
    expect(s.active).toBe(1)
    expect(s.activeFile).toBe("src/auth.ts")
    expect(s.total).toBe(1)
  })

  test("buckets a large mixed session into done / active / error counts", () => {
    const map: Record<string, Agent> = {}
    for (let i = 0; i < 27; i++) map["d" + i] = { phase: "completed" }
    for (let i = 0; i < 3; i++) map["a" + i] = { phase: "tool_use" }
    for (let i = 0; i < 2; i++) map["e" + i] = { phase: "error" }
    const s = summarizeActivity(map)
    expect(s).toMatchObject({ active: 3, done: 27, error: 2, other: 0, total: 32 })
  })

  test("cancelled counts as error; unknown phase buckets as other", () => {
    const s = summarizeActivity({ c1: { phase: "cancelled" }, u1: { phase: "frobnicating" } })
    expect(s.error).toBe(1)
    expect(s.other).toBe(1)
  })

  test("ignores exit phase and phaseless agents", () => {
    const s = summarizeActivity({ x1: { phase: "exit" }, x2: {}, a1: { phase: "working", file: "a.ts" } })
    expect(s.total).toBe(1)
    expect(s.active).toBe(1)
    expect(s.activeFile).toBe("a.ts")
  })

  test("first active agent that has a file wins activeFile", () => {
    const s = summarizeActivity({ a1: { phase: "running" }, a2: { phase: "running", file: "b.ts" } })
    expect(s.activeFile).toBe("b.ts")
  })
})
