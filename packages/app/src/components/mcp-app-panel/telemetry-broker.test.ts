import { describe, expect, test } from "bun:test"
import { CHANNELS, CHANNEL_NAMES, isChannelName } from "./channels"
import { createCostAccumulator, shapeAgents, shapeTasks } from "./telemetry-broker"

describe("shapeTasks", () => {
  test("counts cleared (completed + cancelled) and total", () => {
    const out = shapeTasks([
      { content: "a", status: "completed", priority: "high" },
      { content: "b", status: "in_progress", priority: "medium" },
      { content: "c", status: "cancelled", priority: "low" },
      { content: "d", status: "pending", priority: "high" },
    ])
    expect(out.total).toBe(4)
    expect(out.cleared).toBe(2)
    expect(out.items).toHaveLength(4)
  })

  test("normalizes unknown status/priority to safe defaults", () => {
    const out = shapeTasks([{ content: "x", status: "weird", priority: "urgent" }])
    expect(out.items[0]).toEqual({ content: "x", status: "pending", priority: "medium" })
  })

  test("empty list → zeroed snapshot", () => {
    expect(shapeTasks([])).toEqual({ items: [], cleared: 0, total: 0 })
  })
})

describe("shapeAgents (redaction: derived fields only)", () => {
  test("maps the agent record to a list with only allowed fields", () => {
    const out = shapeAgents({
      "agent-0": { agentID: "agent-0", phase: "running", tool: "edit", file: "src/x.ts", updatedAt: 123 },
    })
    expect(out.agents).toHaveLength(1)
    expect(out.agents[0]).toEqual({ agentID: "agent-0", phase: "running", tool: "edit", file: "src/x.ts", at: 123 })
  })

  test("never leaks unexpected fields (e.g. file contents) — only the channel shape survives", () => {
    const out = shapeAgents({
      a: { agentID: "a", phase: "p", updatedAt: 1, ...({ contents: "SECRET", apiKey: "sk-..." } as object) } as never,
    })
    expect(Object.keys(out.agents[0]).sort()).toEqual(["agentID", "at", "file", "phase", "tool"].sort())
    expect(JSON.stringify(out)).not.toContain("SECRET")
    expect(JSON.stringify(out)).not.toContain("sk-")
  })

  test("falls back to the record key + 'idle' when fields are missing", () => {
    const out = shapeAgents({ "agent-9": {} as never })
    expect(out.agents[0].agentID).toBe("agent-9")
    expect(out.agents[0].phase).toBe("idle")
    expect(out.agents[0].at).toBe(0)
  })
})

describe("createCostAccumulator", () => {
  test("sums cost + tokens across distinct messages", () => {
    const acc = createCostAccumulator()
    acc.ingest({ id: "m1", cost: 0.01, tokens: { input: 100, output: 20 } })
    acc.ingest({ id: "m2", cost: 0.02, tokens: { input: 50, output: 10 } })
    expect(acc.snapshot()).toEqual({ usd: 0.03, tokensIn: 150, tokensOut: 30, messages: 2 })
  })

  test("re-emit for the same id REPLACES (no double-count)", () => {
    const acc = createCostAccumulator()
    acc.ingest({ id: "m1", cost: 0.01, tokens: { input: 100, output: 20 } })
    acc.ingest({ id: "m1", cost: 0.05, tokens: { input: 300, output: 80 } }) // updated final cost
    expect(acc.snapshot()).toEqual({ usd: 0.05, tokensIn: 300, tokensOut: 80, messages: 1 })
  })

  test("ignores info without a string id; coerces non-numbers to 0", () => {
    const acc = createCostAccumulator()
    acc.ingest(undefined)
    acc.ingest({ cost: 1 } as never)
    acc.ingest({ id: "m1", cost: "oops" as never, tokens: { input: undefined, output: 5 } })
    expect(acc.snapshot()).toEqual({ usd: 0, tokensIn: 0, tokensOut: 5, messages: 1 })
  })
})

describe("channel registry", () => {
  test("every channel has a throttleMs + snapshot/delta schema", () => {
    for (const name of CHANNEL_NAMES) {
      expect(typeof CHANNELS[name].throttleMs).toBe("number")
      expect(CHANNELS[name].snapshot).toBeDefined()
      expect(CHANNELS[name].delta).toBeDefined()
    }
  })

  test("isChannelName guards the union", () => {
    expect(isChannelName("tasks")).toBe(true)
    expect(isChannelName("nope")).toBe(false)
    expect(isChannelName(undefined)).toBe(false)
  })
})
