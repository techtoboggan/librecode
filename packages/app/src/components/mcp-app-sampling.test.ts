/**
 * v0.9.49 + v0.9.53 — tests for the per-app sampling cost-cap policy
 * and the client-side handler.
 *
 * v0.9.53 wired the handler to actually call the server route; these
 * tests use a fake fetchFn so we can assert the request shape + that
 * client-side book-keeping mirrors the server's settled cost.
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
  const sampleParams = {
    messages: [{ role: "user" as const, content: { type: "text" as const, text: "hello" } }],
    maxTokens: 128,
  }

  test("returns isError with no-session text when sessionID is undefined", async () => {
    const handler = createSamplingHandler({
      fetchFn: () => Promise.reject(new Error("unreachable")),
      baseUrl: "http://host.example",
      sessionID: undefined,
      server: "acme",
      uri: "ui://acme/x",
    })
    const result = (await handler(sampleParams)) as { isError?: boolean; content?: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content?.[0]?.text).toContain("active session")
  })

  test("posts to the sample route and returns the unwrapped CreateMessageResult", async () => {
    let capturedUrl = ""
    let capturedBody: unknown
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = input.toString()
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined
      return new Response(
        JSON.stringify({
          model: "anthropic/claude-opus-4-7",
          role: "assistant",
          content: { type: "text", text: "response" },
          stopReason: "endTurn",
          _meta: { costUsd: 0.02, remainingUsd: 0.48, windowUsdTotal: 0.02, capUsd: 0.5 },
        }),
        { status: 200 },
      )
    }
    const handler = createSamplingHandler({
      fetchFn,
      baseUrl: "http://host.example",
      sessionID: "ses_42",
      server: "acme",
      uri: "ui://acme/x",
      capUsd: 0.5,
    })
    const result = (await handler(sampleParams)) as { model?: string; content?: { text: string } }
    expect(result.model).toBe("anthropic/claude-opus-4-7")
    expect(result.content?.text).toBe("response")
    expect(capturedUrl).toBe("http://host.example/session/ses_42/mcp-apps/sample")
    expect(capturedBody).toMatchObject({
      server: "acme",
      uri: "ui://acme/x",
      maxTokens: 128,
      capUsd: 0.5,
    })
    // Client ledger mirrors the settled server cost so the UI can
    // show remaining headroom without a follow-up request.
    expect(totalSamplingCostUsd("acme")).toBeCloseTo(0.02, 6)
  })

  test("server-reported cap breach surfaces as isError with the reason text", async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ isError: true, error: "Sampling cap exceeded for acme: ..." }), { status: 200 })
    const handler = createSamplingHandler({
      fetchFn,
      baseUrl: "http://host.example",
      sessionID: "ses_42",
      server: "acme",
      uri: "ui://acme/x",
    })
    const result = (await handler(sampleParams)) as { isError?: boolean; content?: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content?.[0]?.text).toContain("Sampling cap exceeded")
  })

  test("transport / fetch failure is wrapped in a deterministic isError", async () => {
    const fetchFn = async () => {
      throw new Error("ECONNRESET")
    }
    const handler = createSamplingHandler({
      fetchFn,
      baseUrl: "http://host.example",
      sessionID: "ses_42",
      server: "acme",
      uri: "ui://acme/x",
    })
    const result = (await handler(sampleParams)) as { isError?: boolean; content?: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content?.[0]?.text).toContain("network failure")
  })
})
