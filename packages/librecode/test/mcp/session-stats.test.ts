/**
 * v0.9.56 — reducer tests for the built-in `session-stats.html` MCP app.
 *
 * The reducer lives inside the HTML as an inline <script>. In
 * production it runs in a sandboxed iframe; for the unit path we
 * extract the script source and eval it inside a Function with a
 * minimal DOM shim, then exercise the reducer via the
 * `__mcpAppSessionStats` test hook the script exposes.
 *
 * Goal: pin the dedup behaviour that a naive listener would trip over
 * (`message.part.updated` fires multiple times per part — once per
 * state transition + once per streaming delta) and the seed-wins
 * semantics for canonical per-message totals.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const HTML_PATH = path.join(import.meta.dir, "..", "..", "src", "mcp", "builtin-apps", "session-stats.html")

interface StatsAPI {
  ingestPart: (part: unknown, messageID?: string) => void
  ingestSeedMessage: (m: unknown) => void
  computeTotals: () => {
    messageCount: number
    totalCost: number
    totalInput: number
    totalOutput: number
    requests: Array<{ id: string; input: number; output: number; cost: number; ms: number }>
    toolCounts: Record<string, number>
    avgTokPerSec: number
  }
  setView: (v: "totals" | "avg-rate" | "history") => void
  getView: () => string
}

function extractScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error("no <script> block in session-stats.html")
  return match[1]
}

/**
 * Minimal DOM stand-in for the reducer. We don't care about rendering
 * in unit tests; the script's render() path reads DOM nodes and
 * assigns innerHTML. Providing no-op nodes lets the script run end-
 * to-end without a real document.
 */
function stubElement() {
  const el = {
    style: { display: "" },
    innerHTML: "",
    textContent: "",
    childElementCount: 0,
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  return el
}

function loadStats(): StatsAPI {
  const source = extractScript(readFileSync(HTML_PATH, "utf8"))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win: any = {
    addEventListener: () => {},
    postMessage: () => {},
    parent: undefined,
  }
  win.parent = win
  const doc = {
    getElementById: (_id: string) => stubElement(),
  }
  // Evaluate the script in a scope where `window`, `document` and the
  // referenced globals are our shims. Return the test hook.
  // biome-ignore lint/security/noGlobalEval: intentional — controlled internal HTML source
  new Function("window", "document", source)(win, doc)
  const api = win.__mcpAppSessionStats as StatsAPI | undefined
  if (!api) throw new Error("session-stats.html did not install __mcpAppSessionStats")
  return api
}

describe("session-stats reducer — part dedup", () => {
  test("a single step-finish part counted once — latest snapshot wins when the same part updates multiple times", () => {
    const api = loadStats()
    api.ingestPart({
      id: "prt_a",
      messageID: "m_1",
      type: "step-finish",
      cost: 0.01,
      tokens: { input: 100, output: 50 },
    })
    api.ingestPart({
      id: "prt_a",
      messageID: "m_1",
      type: "step-finish",
      cost: 0.02,
      tokens: { input: 200, output: 80 },
    })
    api.ingestPart({
      id: "prt_a",
      messageID: "m_1",
      type: "step-finish",
      cost: 0.03,
      tokens: { input: 300, output: 120 },
    })
    const totals = api.computeTotals()
    expect(totals.totalCost).toBeCloseTo(0.03, 6)
    expect(totals.totalInput).toBe(300)
    expect(totals.totalOutput).toBe(120)
    expect(totals.messageCount).toBe(1)
  })

  test("a tool part counted once across pending → running → completed state transitions", () => {
    const api = loadStats()
    for (const status of ["pending", "running", "completed"]) {
      api.ingestPart({
        id: "prt_tool_1",
        messageID: "m_1",
        type: "tool",
        tool: "read",
        callID: "call_1",
        state: { status },
      })
    }
    const totals = api.computeTotals()
    expect(totals.toolCounts.read).toBe(1)
  })

  test("two distinct callIDs each count (dedup is by callID, not by seen part)", () => {
    const api = loadStats()
    api.ingestPart({
      id: "p1",
      messageID: "m_1",
      type: "tool",
      tool: "read",
      callID: "call_1",
      state: { status: "completed" },
    })
    api.ingestPart({
      id: "p2",
      messageID: "m_1",
      type: "tool",
      tool: "read",
      callID: "call_2",
      state: { status: "completed" },
    })
    const totals = api.computeTotals()
    expect(totals.toolCounts.read).toBe(2)
  })
})

describe("session-stats reducer — aggregation", () => {
  test("step-finish parts across distinct messages sum into one total", () => {
    const api = loadStats()
    api.ingestPart({
      id: "p1",
      messageID: "m_1",
      type: "step-finish",
      cost: 0.01,
      tokens: { input: 100, output: 20 },
    })
    api.ingestPart({
      id: "p2",
      messageID: "m_2",
      type: "step-finish",
      cost: 0.02,
      tokens: { input: 200, output: 30 },
    })
    const totals = api.computeTotals()
    expect(totals.messageCount).toBe(2)
    expect(totals.totalInput).toBe(300)
    expect(totals.totalOutput).toBe(50)
    expect(totals.totalCost).toBeCloseTo(0.03, 6)
    expect(totals.requests).toHaveLength(2)
  })

  test("seed snapshot wins over mid-stream step-finish values for the same message", () => {
    const api = loadStats()
    api.ingestSeedMessage({
      id: "m_seed",
      role: "assistant",
      cost: 0.1,
      tokens: { input: 1000, output: 500 },
      parts: [],
    })
    api.ingestPart({
      id: "p_late",
      messageID: "m_seed",
      type: "step-finish",
      cost: 0.99,
      tokens: { input: 9999, output: 9999 },
    })
    const totals = api.computeTotals()
    expect(totals.totalInput).toBe(1000)
    expect(totals.totalOutput).toBe(500)
    expect(totals.totalCost).toBeCloseTo(0.1, 6)
  })
})

describe("session-stats reducer — view toggle", () => {
  test("setView round-trips through the three card states", () => {
    const api = loadStats()
    expect(api.getView()).toBe("totals")
    api.setView("avg-rate")
    expect(api.getView()).toBe("avg-rate")
    api.setView("history")
    expect(api.getView()).toBe("history")
    api.setView("totals")
    expect(api.getView()).toBe("totals")
  })
})
