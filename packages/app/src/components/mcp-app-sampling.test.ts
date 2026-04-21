/**
 * v0.9.49 — tests for the per-app sampling cost-cap policy.
 *
 * The actual sampling/createMessage handler returns isError today
 * (LLM plumbing deferred), so the test surface is the cap accounting
 * + checkSamplingCap predicate that the future enable-PR will gate
 * with.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  DEFAULT_SAMPLING_HOURLY_USD_CAP,
  SAMPLING_CAP_WINDOW_MS,
  checkSamplingCap,
  clearSamplingLedger,
  createSamplingHandler,
  recordSamplingCost,
  resetAllSamplingLedgers,
  totalSamplingCostUsd,
} from "./mcp-app-sampling"

afterEach(() => {
  resetAllSamplingLedgers()
})

describe("DEFAULT_SAMPLING_HOURLY_USD_CAP", () => {
  test("default cap is $0.50/hr per the v0.9.49 plan", () => {
    expect(DEFAULT_SAMPLING_HOURLY_USD_CAP).toBe(0.5)
  })
})

describe("recordSamplingCost + totalSamplingCostUsd", () => {
  test("totals are 0 for a server that has no entries", () => {
    expect(totalSamplingCostUsd("acme")).toBe(0)
  })

  test("totals accumulate across multiple records in the window", () => {
    recordSamplingCost("acme", 0.1)
    recordSamplingCost("acme", 0.2)
    expect(totalSamplingCostUsd("acme")).toBeCloseTo(0.3, 6)
  })

  test("entries older than the window are pruned on read", () => {
    const now = 1_700_000_000_000
    recordSamplingCost("acme", 0.1, now - SAMPLING_CAP_WINDOW_MS - 1)
    recordSamplingCost("acme", 0.2, now)
    expect(totalSamplingCostUsd("acme", now)).toBeCloseTo(0.2, 6)
  })

  test("ledgers are scoped per server — sibling servers don't pollute each other", () => {
    recordSamplingCost("acme", 0.5)
    recordSamplingCost("other", 0.3)
    expect(totalSamplingCostUsd("acme")).toBeCloseTo(0.5, 6)
    expect(totalSamplingCostUsd("other")).toBeCloseTo(0.3, 6)
  })

  test("clearSamplingLedger drops just the targeted server", () => {
    recordSamplingCost("acme", 0.5)
    recordSamplingCost("other", 0.3)
    clearSamplingLedger("acme")
    expect(totalSamplingCostUsd("acme")).toBe(0)
    expect(totalSamplingCostUsd("other")).toBeCloseTo(0.3, 6)
  })
})

describe("checkSamplingCap", () => {
  test("under cap → ok with remaining headroom reported", () => {
    recordSamplingCost("acme", 0.2)
    const r = checkSamplingCap({ server: "acme", capUsd: 0.5, proposedCostUsd: 0.1 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.remainingUsd).toBeCloseTo(0.2, 6) // 0.5 - 0.2 - 0.1
  })

  test("at-or-over cap → !ok with reason and zero-or-positive remaining", () => {
    recordSamplingCost("acme", 0.45)
    const r = checkSamplingCap({ server: "acme", capUsd: 0.5, proposedCostUsd: 0.1 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain("Sampling cap exceeded")
      expect(r.reason).toContain("acme")
      expect(r.remainingUsd).toBeCloseTo(0.05, 6)
    }
  })

  test("zero proposed cost is always allowed (defensive)", () => {
    recordSamplingCost("acme", 0.5)
    const r = checkSamplingCap({ server: "acme", capUsd: 0.5, proposedCostUsd: 0 })
    expect(r.ok).toBe(true)
  })
})

describe("createSamplingHandler", () => {
  test("returns a deterministic isError until the inference path is wired", async () => {
    const handler = createSamplingHandler({
      fetchFn: () => Promise.reject(new Error("never called in v0.9.49")),
      baseUrl: "http://host.example",
      sessionID: "ses_x",
      server: "acme",
      uri: "ui://acme/x",
    })
    const result = (await handler({})) as { isError?: boolean; content?: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content?.[0]?.text).toContain("not yet enabled")
  })
})
