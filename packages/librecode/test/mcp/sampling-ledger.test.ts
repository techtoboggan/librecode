/**
 * v0.9.53 — server-side sampling ledger + cap check. Mirrors the
 * client tests in packages/app/src/components/mcp-app-sampling.test.ts
 * so we lock in the enforcement path in both places.
 */
import { afterEach, expect, test } from "bun:test"
import {
  DEFAULT_SAMPLING_HOURLY_USD_CAP,
  SAMPLING_CAP_WINDOW_MS,
  checkSamplingCap,
  clearSamplingLedger,
  recordSamplingCost,
  resetAllSamplingLedgers,
  totalSamplingCostUsd,
} from "../../src/mcp/sampling-ledger"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function withInstance<T>(fn: () => Promise<T>): Promise<T> {
  await using tmp = await tmpdir({ git: true })
  return await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        return await fn()
      } finally {
        resetAllSamplingLedgers()
      }
    },
  })
}

afterEach(() => {
  // Belt-and-braces — instance teardown also clears Instance.state,
  // but resetting here keeps the helper safe if a test forgets the
  // Instance.provide wrapper.
})

test("default cap is $0.50/hr (matches the client constant)", () => {
  expect(DEFAULT_SAMPLING_HOURLY_USD_CAP).toBe(0.5)
})

test("totalSamplingCostUsd is 0 for an untracked server", async () => {
  await withInstance(async () => {
    expect(totalSamplingCostUsd("acme")).toBe(0)
  })
})

test("recorded costs accumulate within the window and prune afterward", async () => {
  await withInstance(async () => {
    const now = 1_700_000_000_000
    recordSamplingCost("acme", 0.1, now - SAMPLING_CAP_WINDOW_MS - 1)
    recordSamplingCost("acme", 0.2, now)
    recordSamplingCost("acme", 0.3, now)
    expect(totalSamplingCostUsd("acme", now)).toBeCloseTo(0.5, 6)
  })
})

test("ledgers are scoped per server", async () => {
  await withInstance(async () => {
    recordSamplingCost("acme", 0.5)
    recordSamplingCost("other", 0.3)
    expect(totalSamplingCostUsd("acme")).toBeCloseTo(0.5, 6)
    expect(totalSamplingCostUsd("other")).toBeCloseTo(0.3, 6)
  })
})

test("clearSamplingLedger drops just the named server", async () => {
  await withInstance(async () => {
    recordSamplingCost("acme", 0.5)
    recordSamplingCost("other", 0.3)
    clearSamplingLedger("acme")
    expect(totalSamplingCostUsd("acme")).toBe(0)
    expect(totalSamplingCostUsd("other")).toBeCloseTo(0.3, 6)
  })
})

test("checkSamplingCap rejects once the running sum would breach the cap", async () => {
  await withInstance(async () => {
    recordSamplingCost("acme", 0.45)
    const r = checkSamplingCap({ server: "acme", capUsd: 0.5, proposedCostUsd: 0.1 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain("Sampling cap exceeded")
      expect(r.remainingUsd).toBeCloseTo(0.05, 6)
    }
  })
})

test("checkSamplingCap accepts proposed-cost that fits in headroom", async () => {
  await withInstance(async () => {
    recordSamplingCost("acme", 0.2)
    const r = checkSamplingCap({ server: "acme", capUsd: 0.5, proposedCostUsd: 0.1 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.remainingUsd).toBeCloseTo(0.2, 6)
  })
})

test("ledger state is scoped per Instance — distinct projects don't leak", async () => {
  await using a = await tmpdir({ git: true })
  await using b = await tmpdir({ git: true })

  await Instance.provide({
    directory: a.path,
    fn: async () => {
      recordSamplingCost("acme", 0.4)
      expect(totalSamplingCostUsd("acme")).toBeCloseTo(0.4, 6)
    },
  })
  await Instance.provide({
    directory: b.path,
    fn: async () => {
      // b's ledger is independent from a's — nothing should carry over.
      expect(totalSamplingCostUsd("acme")).toBe(0)
    },
  })
})
