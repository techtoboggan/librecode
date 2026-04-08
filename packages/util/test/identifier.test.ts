import { describe, expect, test } from "bun:test"
import { Identifier } from "../src/identifier"

describe("Identifier", () => {
  test("ascending IDs are 26 chars", () => {
    const id = Identifier.ascending()
    expect(id.length).toBe(26)
  })

  test("descending IDs are 26 chars", () => {
    const id = Identifier.descending()
    expect(id.length).toBe(26)
  })

  test("ascending IDs sort correctly", () => {
    const ids = Array.from({ length: 10 }, () => Identifier.ascending())
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })

  test("descending IDs sort in reverse", () => {
    const ids = Array.from({ length: 10 }, () => Identifier.descending())
    const sorted = [...ids].sort().reverse()
    expect(ids).toEqual(sorted)
  })

  test("IDs are unique", () => {
    const ids = new Set(Array.from({ length: 100 }, () => Identifier.ascending()))
    expect(ids.size).toBe(100)
  })

  test("create with explicit timestamp", () => {
    const id = Identifier.create(false, 1700000000000)
    expect(id.length).toBe(26)
  })
})
