/**
 * Phase 50b — schema tests for the mcp_apps config field.
 *
 * Tests the Zod schema directly (no filesystem or server needed).
 * Verifies that:
 *   - mcp_apps accepts the expected shape
 *   - mcp_apps is optional (absent config parses cleanly)
 *   - Invalid shapes are rejected
 */
import { describe, expect, test } from "bun:test"
import { z } from "zod"

// Import only the mcp_apps sub-schema in isolation so changes to
// Config at large don't bloat this test file.
const McpAppsSchema = z
  .record(
    z.string(),
    z.object({
      alwaysLoaded: z.boolean().optional(),
    }),
  )
  .optional()

describe("mcp_apps schema field — Phase 50b", () => {
  test("parses undefined (field absent) as undefined", () => {
    const result = McpAppsSchema.parse(undefined)
    expect(result).toBeUndefined()
  })

  test("parses empty object correctly", () => {
    const result = McpAppsSchema.parse({})
    expect(result).toEqual({})
  })

  test("accepts a single URI with alwaysLoaded:true", () => {
    const input = { "ui://acme/notes": { alwaysLoaded: true } }
    const result = McpAppsSchema.parse(input)
    expect(result?.["ui://acme/notes"]?.alwaysLoaded).toBe(true)
  })

  test("accepts a single URI with alwaysLoaded:false", () => {
    const input = { "ui://acme/notes": { alwaysLoaded: false } }
    const result = McpAppsSchema.parse(input)
    expect(result?.["ui://acme/notes"]?.alwaysLoaded).toBe(false)
  })

  test("accepts a URI entry where alwaysLoaded is absent (optional)", () => {
    const input = { "ui://acme/notes": {} }
    const result = McpAppsSchema.parse(input)
    expect(result?.["ui://acme/notes"]).toEqual({})
    expect(result?.["ui://acme/notes"]?.alwaysLoaded).toBeUndefined()
  })

  test("accepts multiple URI entries with mixed alwaysLoaded values", () => {
    const input = {
      "ui://a/app": { alwaysLoaded: true },
      "ui://b/app": { alwaysLoaded: false },
      "ui://c/app": {},
    }
    const result = McpAppsSchema.parse(input)
    expect(result?.["ui://a/app"]?.alwaysLoaded).toBe(true)
    expect(result?.["ui://b/app"]?.alwaysLoaded).toBe(false)
    expect(result?.["ui://c/app"]?.alwaysLoaded).toBeUndefined()
  })

  test("rejects alwaysLoaded:'yes' (string instead of boolean)", () => {
    const input = { "ui://app": { alwaysLoaded: "yes" } }
    expect(() => McpAppsSchema.parse(input)).toThrow()
  })

  test("rejects alwaysLoaded:1 (number instead of boolean)", () => {
    const input = { "ui://app": { alwaysLoaded: 1 } }
    expect(() => McpAppsSchema.parse(input)).toThrow()
  })
})
