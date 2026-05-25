import { describe, expect, test } from "bun:test"
import { Info } from "../../src/config/schema"

describe("experimental.app_dock schema default", () => {
  test("defaults to true when omitted", () => {
    const parsed = Info.parse({})
    expect(parsed.experimental?.app_dock).toBe(true)
  })

  test("respects explicit false", () => {
    const parsed = Info.parse({ experimental: { app_dock: false } })
    expect(parsed.experimental?.app_dock).toBe(false)
  })

  test("respects explicit true", () => {
    const parsed = Info.parse({ experimental: { app_dock: true } })
    expect(parsed.experimental?.app_dock).toBe(true)
  })
})
