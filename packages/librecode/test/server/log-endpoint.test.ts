import { describe, expect, test } from "bun:test"
import { LogPayload, sanitizeLogExtra } from "../../src/server/log-endpoint-schema.ts"

// A04 (Insecure Design) / A09 (Logging Failures) — the /log endpoint accepts
// user-supplied log entries. Without payload limits it is a DoS vector (flood
// the log file) and a log-injection vector (fake INFO/ERROR lines). The
// schema enforces sane length + charset bounds at the edge.

describe("LogPayload", () => {
  test("accepts a reasonable log entry", () => {
    const res = LogPayload.safeParse({ service: "tui", level: "info", message: "hello" })
    expect(res.success).toBe(true)
  })

  test("rejects service names with control characters (log injection)", () => {
    const res = LogPayload.safeParse({
      service: "tui\nINFO: fake-line",
      level: "info",
      message: "x",
    })
    expect(res.success).toBe(false)
  })

  test("rejects service name longer than 64 chars", () => {
    const res = LogPayload.safeParse({
      service: "a".repeat(65),
      level: "info",
      message: "x",
    })
    expect(res.success).toBe(false)
  })

  test("rejects service name that doesn't match allowed charset", () => {
    // Space and slash not allowed — only [a-z0-9._-]
    expect(LogPayload.safeParse({ service: "has space", level: "info", message: "x" }).success).toBe(false)
    expect(LogPayload.safeParse({ service: "has/slash", level: "info", message: "x" }).success).toBe(false)
    expect(LogPayload.safeParse({ service: "has:colon", level: "info", message: "x" }).success).toBe(false)
  })

  test("accepts service name with allowed charset", () => {
    expect(LogPayload.safeParse({ service: "tui.startup", level: "info", message: "x" }).success).toBe(true)
    expect(LogPayload.safeParse({ service: "desk_top-2", level: "info", message: "x" }).success).toBe(true)
  })

  test("rejects message longer than 8KB", () => {
    const res = LogPayload.safeParse({
      service: "tui",
      level: "info",
      message: "a".repeat(8 * 1024 + 1),
    })
    expect(res.success).toBe(false)
  })

  test("accepts message at exactly 8KB", () => {
    const res = LogPayload.safeParse({
      service: "tui",
      level: "info",
      message: "a".repeat(8 * 1024),
    })
    expect(res.success).toBe(true)
  })

  test("rejects invalid level", () => {
    const res = LogPayload.safeParse({ service: "tui", level: "critical", message: "x" })
    expect(res.success).toBe(false)
  })
})

describe("sanitizeLogExtra", () => {
  test("caps extra object to a fixed serialized size", () => {
    const huge = { bigArray: Array.from({ length: 100000 }, (_, i) => ({ idx: i, name: "x".repeat(100) })) }
    const result = sanitizeLogExtra(huge)
    // Sanitizer must either truncate or replace with a marker; never pass raw
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(16 * 1024)
  })

  test("passes through small objects unchanged", () => {
    const input = { userId: "abc", action: "click" }
    expect(sanitizeLogExtra(input)).toEqual(input)
  })

  test("handles undefined", () => {
    expect(sanitizeLogExtra(undefined)).toBeUndefined()
  })
})
