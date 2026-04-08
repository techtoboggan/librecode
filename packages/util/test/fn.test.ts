import { describe, expect, test } from "bun:test"
import { fn } from "../src/fn"
import { z } from "zod"

describe("fn", () => {
  const add = fn(z.object({ a: z.number(), b: z.number() }), ({ a, b }) => a + b)

  test("validates input and runs callback", () => {
    expect(add({ a: 1, b: 2 })).toBe(3)
  })

  test("throws on invalid input", () => {
    expect(() => add({ a: "not a number", b: 2 } as any)).toThrow()
  })

  test("force bypasses validation", () => {
    // force() passes input directly — no schema check
    expect(add.force({ a: 10, b: 20 })).toBe(30)
  })

  test("exposes schema", () => {
    expect(add.schema).toBeDefined()
  })

  test("strips unknown keys via parse", () => {
    // Zod strict mode strips extra keys — result should still work
    const result = add({ a: 1, b: 2, extra: "ignored" } as any)
    expect(result).toBe(3)
  })
})
