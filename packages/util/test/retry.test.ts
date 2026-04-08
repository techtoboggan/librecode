import { describe, expect, test } from "bun:test"
import { retry } from "../src/retry"

describe("retry", () => {
  test("returns on first success", async () => {
    let calls = 0
    const result = await retry(async () => {
      calls++
      return "ok"
    })
    expect(result).toBe("ok")
    expect(calls).toBe(1)
  })

  test("retries on transient error", async () => {
    let calls = 0
    const result = await retry(
      async () => {
        calls++
        if (calls < 3) throw new Error("load failed")
        return "recovered"
      },
      { delay: 10 },
    )
    expect(result).toBe("recovered")
    expect(calls).toBe(3)
  })

  test("throws after max attempts", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error("econnreset")
        },
        { attempts: 2, delay: 10 },
      ),
    ).rejects.toThrow("econnreset")
    expect(calls).toBe(2)
  })

  test("throws immediately for non-transient errors", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error("invalid input")
        },
        { delay: 10 },
      ),
    ).rejects.toThrow("invalid input")
    expect(calls).toBe(1)
  })

  test("respects custom retryIf", async () => {
    let calls = 0
    const result = await retry(
      async () => {
        calls++
        if (calls < 2) throw new Error("custom-retriable")
        return "done"
      },
      { delay: 10, retryIf: (e) => String(e).includes("custom-retriable") },
    )
    expect(result).toBe("done")
    expect(calls).toBe(2)
  })
})
