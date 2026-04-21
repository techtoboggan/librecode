/**
 * v0.9.51 — tests for the per-(session, server, permission) call
 * aggregator. Exercises the pure `recordCall` + `parseMcpAppPermission`
 * helpers. The Bus-subscription side is integration-tested via the
 * GET /session/:id/mcp-apps/usage endpoint (follow-up).
 */
import { describe, expect, test } from "bun:test"
import { McpAppUsage, _testing } from "../../src/mcp/app-usage"

const { recordCall, emptyState } = _testing

describe("parseMcpAppPermission", () => {
  test("extracts server + tool from mcp-app:<server>:<tool>", () => {
    expect(McpAppUsage.parseMcpAppPermission("mcp-app:acme:echo")).toEqual({ server: "acme", tool: "echo" })
  })

  test("handles tool names containing colons (joins the rest)", () => {
    expect(McpAppUsage.parseMcpAppPermission("mcp-app:acme:ns:call")).toEqual({ server: "acme", tool: "ns:call" })
  })

  test("preserves sentinel tool names like _message and _sample", () => {
    expect(McpAppUsage.parseMcpAppPermission("mcp-app:acme:_message")).toEqual({ server: "acme", tool: "_message" })
    expect(McpAppUsage.parseMcpAppPermission("mcp-app:acme:_sample")).toEqual({ server: "acme", tool: "_sample" })
  })

  test("returns undefined for non-mcp-app permissions", () => {
    expect(McpAppUsage.parseMcpAppPermission("edit")).toBeUndefined()
    expect(McpAppUsage.parseMcpAppPermission("bash")).toBeUndefined()
  })

  test("returns undefined for malformed mcp-app names", () => {
    expect(McpAppUsage.parseMcpAppPermission("mcp-app:")).toBeUndefined()
    expect(McpAppUsage.parseMcpAppPermission("mcp-app:acme")).toBeUndefined()
    expect(McpAppUsage.parseMcpAppPermission("mcp-app::tool")).toBeUndefined()
    expect(McpAppUsage.parseMcpAppPermission("mcp-app:server:")).toBeUndefined()
  })
})

describe("recordCall aggregation", () => {
  test("creates a new entry on first call, increments on subsequent", () => {
    const s = emptyState()
    recordCall(s, { sessionID: "ses_a", permission: "mcp-app:acme:echo", at: 1000 })
    recordCall(s, { sessionID: "ses_a", permission: "mcp-app:acme:echo", at: 2000 })
    recordCall(s, { sessionID: "ses_a", permission: "mcp-app:acme:echo", at: 3000 })
    const list = Array.from(s.entries.values())
    expect(list.length).toBe(1)
    expect(list[0].callsInSession).toBe(3)
    expect(list[0].lastUsedAt).toBe(3000)
    expect(list[0].tool).toBe("echo")
    expect(list[0].server).toBe("acme")
  })

  test("keeps separate entries for different (session, server, permission) combos", () => {
    const s = emptyState()
    recordCall(s, { sessionID: "ses_a", permission: "mcp-app:acme:echo", at: 1 })
    recordCall(s, { sessionID: "ses_b", permission: "mcp-app:acme:echo", at: 1 })
    recordCall(s, { sessionID: "ses_a", permission: "mcp-app:other:do_thing", at: 1 })
    recordCall(s, { sessionID: "ses_a", permission: "mcp-app:acme:ping", at: 1 })
    expect(s.entries.size).toBe(4)
  })

  test("filters out non-mcp-app permissions silently", () => {
    const s = emptyState()
    recordCall(s, { sessionID: "ses_a", permission: "edit", at: 1 })
    recordCall(s, { sessionID: "ses_a", permission: "bash", at: 1 })
    expect(s.entries.size).toBe(0)
  })

  test("lastUsedAt is the max seen — out-of-order arrival doesn't regress it", () => {
    const s = emptyState()
    recordCall(s, { sessionID: "ses_a", permission: "mcp-app:acme:echo", at: 3000 })
    // Late-arriving earlier event shouldn't rewind the timestamp.
    recordCall(s, { sessionID: "ses_a", permission: "mcp-app:acme:echo", at: 1000 })
    const entry = Array.from(s.entries.values())[0]
    expect(entry.lastUsedAt).toBe(3000)
    expect(entry.callsInSession).toBe(2)
  })
})
