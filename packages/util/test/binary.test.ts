import { describe, expect, test } from "bun:test"
import { Binary } from "../src/binary"

describe("Binary.search", () => {
  const items = [
    { id: "a", value: 1 },
    { id: "c", value: 3 },
    { id: "e", value: 5 },
    { id: "g", value: 7 },
  ]
  const compare = (item: { id: string }) => item.id

  test("finds existing item", () => {
    const result = Binary.search(items, "c", compare)
    expect(result).toEqual({ found: true, index: 1 })
  })

  test("finds first item", () => {
    const result = Binary.search(items, "a", compare)
    expect(result).toEqual({ found: true, index: 0 })
  })

  test("finds last item", () => {
    const result = Binary.search(items, "g", compare)
    expect(result).toEqual({ found: true, index: 3 })
  })

  test("returns insertion index for missing item", () => {
    const result = Binary.search(items, "b", compare)
    expect(result.found).toBe(false)
    expect(result.index).toBe(1)
  })

  test("returns 0 for item before all", () => {
    const result = Binary.search(items, "0", compare)
    expect(result).toEqual({ found: false, index: 0 })
  })

  test("returns length for item after all", () => {
    const result = Binary.search(items, "z", compare)
    expect(result).toEqual({ found: false, index: 4 })
  })

  test("works on empty array", () => {
    const result = Binary.search([], "a", compare)
    expect(result).toEqual({ found: false, index: 0 })
  })
})

describe("Binary.insert", () => {
  const compare = (item: { id: string }) => item.id

  test("inserts in sorted order", () => {
    const arr = [{ id: "a" }, { id: "c" }, { id: "e" }]
    Binary.insert(arr, { id: "b" }, compare)
    expect(arr.map((x) => x.id)).toEqual(["a", "b", "c", "e"])
  })

  test("inserts at beginning", () => {
    const arr = [{ id: "b" }, { id: "c" }]
    Binary.insert(arr, { id: "a" }, compare)
    expect(arr.map((x) => x.id)).toEqual(["a", "b", "c"])
  })

  test("inserts at end", () => {
    const arr = [{ id: "a" }, { id: "b" }]
    Binary.insert(arr, { id: "c" }, compare)
    expect(arr.map((x) => x.id)).toEqual(["a", "b", "c"])
  })

  test("inserts into empty array", () => {
    const arr: { id: string }[] = []
    Binary.insert(arr, { id: "a" }, compare)
    expect(arr.map((x) => x.id)).toEqual(["a"])
  })
})
