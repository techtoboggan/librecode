/**
 * Phase 40 / upstream #20503 — tests for the single-flight coalescer.
 *
 * The helper exists to fix the OAuth-refresh race. Tests focus on the
 * three behaviors that matter for that use case:
 *   1. Concurrent calls share one inflight promise (fn invoked once).
 *   2. Sequential calls AFTER settlement get a fresh invocation
 *      (otherwise the next expiry-window refresh would never run).
 *   3. Rejection also clears the slot (otherwise a transient network
 *      failure would permanently break refresh).
 */
import { describe, expect, test } from "bun:test"
import { createSingleFlight } from "../../src/util/single-flight"

describe("createSingleFlight", () => {
  test("concurrent calls share one inflight promise (fn invoked once)", async () => {
    let invocations = 0
    let resolveInner: (v: number) => void = () => {}
    const inner = new Promise<number>((resolve) => {
      resolveInner = resolve
    })
    const flight = createSingleFlight(() => {
      invocations += 1
      return inner
    })

    // Fire 5 concurrent calls.
    const ps = [flight(), flight(), flight(), flight(), flight()]
    // None of them have resolved yet.
    expect(invocations).toBe(1)

    // Resolve the inner promise.
    resolveInner(42)
    const results = await Promise.all(ps)
    expect(results).toEqual([42, 42, 42, 42, 42])
    expect(invocations).toBe(1)
  })

  test("sequential calls after settlement get a fresh invocation", async () => {
    let invocations = 0
    const flight = createSingleFlight(async () => {
      invocations += 1
      return invocations
    })

    const a = await flight()
    const b = await flight()
    const c = await flight()
    expect(a).toBe(1)
    expect(b).toBe(2)
    expect(c).toBe(3)
    expect(invocations).toBe(3)
  })

  test("rejection clears the slot so next call retries", async () => {
    let invocations = 0
    let shouldFail = true
    const flight = createSingleFlight(async () => {
      invocations += 1
      if (shouldFail) throw new Error("transient")
      return "ok"
    })

    await expect(flight()).rejects.toThrow(/transient/)
    expect(invocations).toBe(1)

    // Without slot-clearing on reject, the next call would short-circuit
    // on the cached rejected promise forever. Flip the flag and retry.
    shouldFail = false
    const result = await flight()
    expect(result).toBe("ok")
    expect(invocations).toBe(2)
  })

  test("rejection propagates to ALL concurrent waiters (not just the first)", async () => {
    let rejectInner: (e: Error) => void = () => {}
    const inner = new Promise<number>((_, reject) => {
      rejectInner = reject
    })
    const flight = createSingleFlight(() => inner)

    const p1 = flight()
    const p2 = flight()
    rejectInner(new Error("boom"))

    await expect(p1).rejects.toThrow(/boom/)
    await expect(p2).rejects.toThrow(/boom/)
  })

  test("new in-flight after settle isn't blocked by stale slot", async () => {
    // Simulates the OAuth refresh pattern: token expires at T=0, refresh
    // happens, succeeds; an hour later (T=1h) token expires again, refresh
    // must run again. The slot-clear in `finally` is what makes this work.
    let invocations = 0
    const flight = createSingleFlight(async () => {
      invocations += 1
      return invocations
    })

    // First "expiry window": several concurrent fetches all coalesce.
    await Promise.all([flight(), flight(), flight()])
    expect(invocations).toBe(1)

    // Second "expiry window": new burst of concurrent fetches must run a
    // fresh refresh (the first window's slot was cleared).
    await Promise.all([flight(), flight(), flight()])
    expect(invocations).toBe(2)
  })
})
