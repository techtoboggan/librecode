import { describe, expect, test } from "bun:test"
import { formatTokens } from "@/utils/format-tokens"

describe("formatTokens", () => {
  test("formats millions", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M")
    expect(formatTokens(1_500_000)).toBe("1.5M")
    expect(formatTokens(12_345_678)).toBe("12.3M")
  })

  test("formats thousands", () => {
    expect(formatTokens(1_000)).toBe("1.0k")
    expect(formatTokens(1_500)).toBe("1.5k")
    expect(formatTokens(999_999)).toBe("1000.0k")
  })

  test("formats small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(1)).toBe("1")
    expect(formatTokens(999)).toBe("999")
  })
})
