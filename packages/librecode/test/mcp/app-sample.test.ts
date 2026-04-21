/**
 * v0.9.53 — pure-helper tests for the sampling executor. The full
 * `performSampling` path needs a live Provider + LLM so it's covered
 * separately; this file locks in the bits that don't need IO.
 */
import { describe, expect, test } from "bun:test"
import { _testing, guardCapBeforeCall } from "../../src/mcp/app-sample"
import type { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { recordSamplingCost, resetAllSamplingLedgers } from "../../src/mcp/sampling-ledger"
import { tmpdir } from "../fixture/fixture"

const { mapFinishReason, estimatePreCallCost, toModelMessages } = _testing

describe("mapFinishReason", () => {
  test("maps the AI-SDK vocabulary to MCP stopReason values", () => {
    expect(mapFinishReason("stop")).toBe("endTurn")
    expect(mapFinishReason("length")).toBe("maxTokens")
    expect(mapFinishReason("stop-sequence")).toBe("stopSequence")
  })

  test("passes through unknown reasons so provider-specific values survive", () => {
    expect(mapFinishReason("tool-calls")).toBe("tool-calls")
    expect(mapFinishReason("content-filter")).toBe("content-filter")
  })

  test("undefined stays undefined (stopReason is optional in the spec)", () => {
    expect(mapFinishReason(undefined)).toBeUndefined()
  })
})

describe("toModelMessages", () => {
  test("flattens single + array content into the AI-SDK ModelMessage shape", () => {
    const out = toModelMessages([
      { role: "user", content: { type: "text", text: "hi" } },
      {
        role: "assistant",
        content: [
          { type: "text", text: "line 1" },
          { type: "text", text: "line 2" },
        ],
      },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].role).toBe("user")
    expect(out[0].content).toBe("hi")
    expect(out[1].role).toBe("assistant")
    expect(out[1].content).toBe("line 1\nline 2")
  })
})

describe("estimatePreCallCost", () => {
  // Minimal Provider.Model shape — only cost fields matter for this helper.
  const model = {
    cost: { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
  } as unknown as Provider.Model

  test("returns 0 for a zero-cost model (defensive — some local providers expose cost:0)", () => {
    const zero = { cost: { input: 0, output: 0 } } as unknown as Provider.Model
    expect(
      estimatePreCallCost(zero, {
        maxTokens: 1000,
        messages: [{ role: "user", content: { type: "text", text: "hi" } }],
      }),
    ).toBe(0)
  })

  test("scales with maxTokens × output price", () => {
    const lo = estimatePreCallCost(model, {
      maxTokens: 100,
      messages: [{ role: "user", content: { type: "text", text: "" } }],
    })
    const hi = estimatePreCallCost(model, {
      maxTokens: 1000,
      messages: [{ role: "user", content: { type: "text", text: "" } }],
    })
    expect(hi).toBeGreaterThan(lo * 9) // roughly 10× for a 10× maxTokens
  })

  test("scales with input-message size", () => {
    const short = estimatePreCallCost(model, {
      maxTokens: 100,
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
    })
    const long = estimatePreCallCost(model, {
      maxTokens: 100,
      messages: [{ role: "user", content: { type: "text", text: "x".repeat(10_000) } }],
    })
    expect(long).toBeGreaterThan(short)
  })
})

describe("guardCapBeforeCall", () => {
  test("rejects when estimated cost exceeds remaining headroom", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        resetAllSamplingLedgers()
        recordSamplingCost("acme", 0.45)
        const res = guardCapBeforeCall({ server: "acme", capUsd: 0.5, proposedCostUsd: 0.1 })
        expect(res.ok).toBe(false)
      },
    })
  })

  test("accepts when cost fits, using the default cap when none is passed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        resetAllSamplingLedgers()
        const res = guardCapBeforeCall({ server: "acme", capUsd: undefined, proposedCostUsd: 0.05 })
        expect(res.ok).toBe(true)
      },
    })
  })
})
