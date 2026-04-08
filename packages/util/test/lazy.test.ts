import { describe, expect, test } from "bun:test"
import { lazy } from "../src/lazy"

describe("lazy", () => {
  test("computes value on first call", () => {
    let calls = 0
    const get = lazy(() => {
      calls++
      return 42
    })
    expect(get()).toBe(42)
    expect(calls).toBe(1)
  })

  test("caches value on subsequent calls", () => {
    let calls = 0
    const get = lazy(() => {
      calls++
      return "computed"
    })
    get()
    get()
    get()
    expect(calls).toBe(1)
  })

  test("caches undefined if factory returns undefined", () => {
    let calls = 0
    const get = lazy(() => {
      calls++
      return undefined
    })
    expect(get()).toBeUndefined()
    expect(get()).toBeUndefined()
    expect(calls).toBe(1)
  })

  test("caches null if factory returns null", () => {
    let calls = 0
    const get = lazy(() => {
      calls++
      return null
    })
    expect(get()).toBeNull()
    expect(calls).toBe(1)
  })
})
