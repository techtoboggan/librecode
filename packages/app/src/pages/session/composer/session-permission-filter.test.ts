/**
 * Locks in the contract that the composer's permission filter excludes
 * `mcp-app:*` permission names — those prompts render in the MCP app's
 * own tab via McpAppPermissionPrompt (ADR-005 §2 + the user's v0.9.42
 * decision: separate UI surface, never preempt the agent's dock).
 *
 * Lives in its own file so it doesn't depend on session-composer-state
 * (which imports route-level code that doesn't load under bun's test
 * runner — see the existing session-composer-state.test.ts).
 */
import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@librecode/sdk/v2/client"
import { sessionPermissionRequest } from "./session-request-tree"

const sess = (id: string, parentID?: string) => ({ id, parentID }) as Session
const perm = (id: string, sessionID: string, permission: string) => ({ id, sessionID, permission }) as PermissionRequest

const skipMcpApp = (item: PermissionRequest) => !item.permission.startsWith("mcp-app:")

describe("composer permission filter — mcp-app exclusion", () => {
  test("agent prompts pass through; mcp-app prompts are filtered", () => {
    const sessions = [sess("root")]
    const permissions = {
      root: [perm("perm-mcp", "root", "mcp-app:acme:get_forecast"), perm("perm-edit", "root", "edit")],
    }
    expect(sessionPermissionRequest(sessions, permissions, "root", skipMcpApp)?.id).toBe("perm-edit")
  })

  test("when only mcp-app prompts pend, the agent dock gets nothing", () => {
    const sessions = [sess("root")]
    const permissions = {
      root: [perm("perm-mcp", "root", "mcp-app:acme:get_forecast")],
    }
    expect(sessionPermissionRequest(sessions, permissions, "root", skipMcpApp)).toBeUndefined()
  })

  test("filter walks the session tree and applies to descendants too", () => {
    const sessions = [sess("root"), sess("child", "root")]
    const permissions = {
      child: [perm("perm-mcp-child", "child", "mcp-app:acme:get_forecast")],
    }
    expect(sessionPermissionRequest(sessions, permissions, "root", skipMcpApp)).toBeUndefined()

    const withAgent = {
      child: [perm("perm-mcp-child", "child", "mcp-app:acme:get_forecast"), perm("perm-edit-child", "child", "edit")],
    }
    expect(sessionPermissionRequest(sessions, withAgent, "root", skipMcpApp)?.id).toBe("perm-edit-child")
  })
})
