/**
 * Unit coverage for the URI safety check on the read-only proxy
 * (resources/read). The full request flow is covered by the integration
 * test in test/mcp-integration/read-proxy.test.ts; here we lock in the
 * gate logic in isolation so it's harder to drift.
 *
 * Per ADR-005 §4: an MCP app may only read URIs the same server has
 * advertised via resources/list. Rejection messages should be specific
 * enough that an app developer can tell which step failed.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const original = await import("../../src/mcp")

// Snapshot the MCP module so we can monkey-patch listResourcesForServer
// per test without leaking into siblings.
const realList = original.MCP.listResourcesForServer

afterEach(() => {
  ;(original.MCP as { listResourcesForServer: typeof realList }).listResourcesForServer = realList
})

beforeEach(() => {
  // Default: no listing; tests can override.
  ;(original.MCP as { listResourcesForServer: unknown }).listResourcesForServer = mock(async () => undefined)
})

const { denyReadReason } = await import("../../src/server/routes/session/mcp-apps-read")

describe("denyReadReason", () => {
  test("__builtin__ server is rejected unconditionally", async () => {
    const reason = await denyReadReason("__builtin__", "lctest://docs/x")
    expect(reason).toContain("Built-in")
  })

  test("server not connected (listResourcesForServer returns undefined) is rejected", async () => {
    ;(original.MCP as { listResourcesForServer: unknown }).listResourcesForServer = mock(async () => undefined)
    const reason = await denyReadReason("ghost-server", "lctest://anything")
    expect(reason).toContain("not connected")
  })

  test("URI not in the listed set is rejected — prevents reading arbitrary URIs", async () => {
    ;(original.MCP as { listResourcesForServer: unknown }).listResourcesForServer = mock(async () => ({
      resources: [{ uri: "lctest://docs/readme", name: "readme" }],
    }))
    const reason = await denyReadReason("acme", "lctest://docs/secret")
    expect(reason).toContain("not advertised")
    expect(reason).toContain("lctest://docs/secret")
  })

  test("URI in the listed set is allowed", async () => {
    ;(original.MCP as { listResourcesForServer: unknown }).listResourcesForServer = mock(async () => ({
      resources: [{ uri: "lctest://docs/readme", name: "readme" }],
    }))
    expect(await denyReadReason("acme", "lctest://docs/readme")).toBeNull()
  })
})
