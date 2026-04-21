import { describe, expect, test } from "bun:test"
import { formatArgs, toolFromPermission } from "./mcp-app-permission-prompt"

describe("toolFromPermission", () => {
  test("extracts the tool name from mcp-app:<server>:<tool>", () => {
    expect(toolFromPermission("mcp-app:acme-weather:get_forecast")).toBe("get_forecast")
  })

  test("handles tool names containing colons (joins them back)", () => {
    expect(toolFromPermission("mcp-app:acme:nested:tool")).toBe("nested:tool")
  })

  test("falls back to the whole string when format is unexpected", () => {
    // Defensive — UI should never crash if the permission name format
    // ever changes. Returning the raw string is fine; the user just sees
    // the full identifier instead of a clean tool name.
    expect(toolFromPermission("read")).toBe("read")
    expect(toolFromPermission("bash:rm")).toBe("bash:rm")
    expect(toolFromPermission("mcp-app:")).toBe("mcp-app:")
  })
})

describe("formatArgs", () => {
  test("returns empty string for null/undefined", () => {
    expect(formatArgs(undefined)).toBe("")
    expect(formatArgs(null)).toBe("")
  })

  test("passes strings through verbatim", () => {
    expect(formatArgs("hello")).toBe("hello")
  })

  test("pretty-prints objects with 2-space indent", () => {
    const out = formatArgs({ location: "NYC", units: "metric" })
    expect(out).toContain('"location": "NYC"')
    expect(out).toContain("\n")
  })

  test("truncates very long output (preview only)", () => {
    const big = { text: "x".repeat(1000) }
    const out = formatArgs(big)
    expect(out.length).toBeLessThanOrEqual(241) // 240 chars + ellipsis
    expect(out.endsWith("…")).toBe(true)
  })

  test("falls back to String() for non-serializable input (e.g. circular)", () => {
    const obj: { self?: unknown } = {}
    obj.self = obj
    const out = formatArgs(obj)
    // Just assert it doesn't throw and returns something printable.
    expect(typeof out).toBe("string")
    expect(out.length).toBeGreaterThan(0)
  })
})
