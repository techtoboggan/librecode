import { describe, expect, test } from "bun:test"
import { manifestDenyReason } from "../../src/server/routes/session/mcp-apps"

/**
 * Unit tests for the manifest gate that protects /session/:id/mcp-apps/tool.
 * The full request lifecycle (HTTP + MCP roundtrip) is covered by the
 * integration test in test/mcp-integration/external-app-tool-call.test.ts —
 * here we lock in the policy in isolation so it's harder to drift.
 *
 * Per ADR-005: an MCP app may only invoke tools whose names appear in its
 * resource's `_meta.ui.allowedTools`. Wildcard `["*"]` opens everything;
 * empty / missing means display-only.
 */
describe("manifestDenyReason", () => {
  test("undefined manifest → deny (resource not found)", () => {
    const reason = manifestDenyReason(undefined, "anything")
    expect(reason).not.toBeNull()
    expect(reason?.error).toContain("not found")
  })

  test("empty array → deny every tool (display-only app)", () => {
    const reason = manifestDenyReason([], "echo")
    expect(reason).not.toBeNull()
    expect(reason?.error).toContain("display-only")
  })

  test("explicit allowlist → allow listed names", () => {
    expect(manifestDenyReason(["echo", "ping"], "echo")).toBeNull()
    expect(manifestDenyReason(["echo", "ping"], "ping")).toBeNull()
  })

  test("explicit allowlist → deny names not on the list", () => {
    const reason = manifestDenyReason(["echo"], "rm")
    expect(reason).not.toBeNull()
    expect(reason?.error).toContain('"rm"')
    expect(reason?.error).toContain("manifest")
  })

  test("wildcard ['*'] → allow any tool", () => {
    expect(manifestDenyReason(["*"], "anything")).toBeNull()
    expect(manifestDenyReason(["*"], "rm-rf")).toBeNull()
  })

  test("wildcard mixed with names is still wildcard (any tool)", () => {
    // We treat "*" as the explicit grant — additional names alongside it
    // are noise, not a stricter intersection. Documented in ADR-005.
    expect(manifestDenyReason(["*", "echo"], "anything-else")).toBeNull()
  })
})
