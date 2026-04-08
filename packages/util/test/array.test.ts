import { describe, expect, test } from "bun:test"
import { findLast } from "../src/array"

describe("findLast", () => {
  test("finds last matching item", () => {
    const items = [1, 2, 3, 4, 5, 4, 3]
    expect(findLast(items, (x) => x === 4)).toBe(4)
  })

  test("returns undefined when no match", () => {
    expect(findLast([1, 2, 3], (x) => x === 99)).toBeUndefined()
  })

  test("returns undefined for empty array", () => {
    expect(findLast([], () => true)).toBeUndefined()
  })

  test("passes index and array to predicate", () => {
    const indices: number[] = []
    findLast([10, 20, 30], (_, i) => {
      indices.push(i)
      return false
    })
    // Should iterate backwards: 2, 1, 0
    expect(indices).toEqual([2, 1, 0])
  })

  test("returns first match from the end", () => {
    const items = [
      { id: 1, active: true },
      { id: 2, active: false },
      { id: 3, active: true },
    ]
    expect(findLast(items, (x) => x.active)?.id).toBe(3)
  })
})
