import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { MCP } from "../../../mcp"
import { PermissionNext } from "../../../permission/next"
import * as PermissionService from "../../../permission/service"
import { SessionID } from "../../../session/schema"
import { errors } from "../../error"

/**
 * Manifest enforcement: an app may only invoke a tool that the resource it
 * was loaded from explicitly granted via `_meta.ui.allowedTools`.
 *   - undefined → resource not found / not connected
 *   - empty array → display-only app, every call denied
 *   - includes "*" → any tool on the same MCP server is allowed
 *   - explicit names → only those tools
 *
 * Returns the structured deny reason (for callTool's response shape) when
 * not allowed, or `null` when allowed.
 */
export function manifestDenyReason(
  allowed: ReadonlyArray<string> | undefined,
  toolName: string,
): { error: string } | null {
  if (allowed === undefined) return { error: "MCP App resource not found or server not connected." }
  if (allowed.length === 0)
    return { error: "This MCP app has no allowedTools manifest — it cannot call tools (display-only)." }
  if (allowed.includes("*")) return null
  if (allowed.includes(toolName)) return null
  return { error: `Tool "${toolName}" is not in this app's allowedTools manifest.` }
}

const CallToolBody = z
  .object({
    server: z.string().min(1).describe("MCP server name that hosts the tool"),
    uri: z.string().min(1).describe("UI resource URI the call originates from (must list the tool in its manifest)"),
    name: z.string().min(1).describe("Tool name"),
    arguments: z.record(z.string(), z.unknown()).optional().describe("Tool arguments (JSON object)"),
  })
  .strict()

// Built-in apps run host-internal HTML, not third-party servers; they have no
// real tool surface to expose. Hard-deny up front so a maliciously crafted
// "ui://builtin/*" page can't claim tool access.
const BUILTIN_SERVER = "__builtin__"

/**
 * Per-call permission scope for an MCP-app tool call. ADR-005 §2.
 *
 * The permission "name" is `mcp-app:<server>:<tool>` so the existing
 * wildcard matcher can use it. The pattern carries the originating
 * resource URI — that lets users grant per-app or per-app-per-tool
 * scopes via the standard rule format.
 *
 * Exported for tests + UI; the UI uses these to pre-fill the prompt
 * with sensible "Allow always for this app" / "Allow once" labels.
 */
export function permissionScope(server: string, uri: string, tool: string) {
  return {
    permission: `mcp-app:${server}:${tool}`,
    pattern: uri,
  }
}

const ToolCallResultLike = z.object({
  content: z.array(z.unknown()),
  isError: z.boolean().optional(),
})

export const SessionMcpAppRoutes = new Hono()
  .post(
    "/:sessionID/mcp-apps/disconnect",
    describeRoute({
      summary: "Disconnect an MCP app — drop session-scoped grants",
      description:
        "Called by the host UI when the user clicks Disconnect on a pinned MCP app. " +
        "Clears all session-scoped permission grants matching `mcp-app:<server>:` so the " +
        "next tool call from this app re-prompts the user. Persistent (project-wide) " +
        "rules are NOT cleared — those are managed via the Settings → Apps pane.",
      operationId: "session.mcpApps.disconnect",
      responses: {
        200: { description: "OK" },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator("json", z.object({ server: z.string().min(1) }).strict()),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { server } = c.req.valid("json")
      PermissionService.dropSessionApprovals(sessionID, `mcp-app:${server}:`)
      return c.json({ ok: true }, 200)
    },
  )
  .post(
    "/:sessionID/mcp-apps/tool",
    describeRoute({
      summary: "Call an MCP server tool on behalf of an MCP app",
      description:
        "Invoked by the host's AppBridge handler when an MCP app iframe issues a `tools/call` request. " +
        "Enforces the per-resource manifest (`_meta.ui.allowedTools`) before delegating to the connected MCP server. " +
        "Built-in apps (server `__builtin__`) are rejected unconditionally.",
      operationId: "session.mcpApps.tool",
      responses: {
        200: {
          description: "Tool call result (may be { isError: true } for in-band failures)",
          content: { "application/json": { schema: resolver(ToolCallResultLike) } },
        },
        ...errors(400, 403, 404),
      },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator("json", CallToolBody),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { server, uri, name: toolName } = c.req.valid("json")
      const toolArgs = (c.req.valid("json").arguments ?? {}) as Record<string, unknown>

      if (server === BUILTIN_SERVER) {
        return c.json(
          {
            isError: true,
            content: [{ type: "text", text: "Built-in MCP apps cannot invoke tools — they are display-only." }],
          },
          200,
        )
      }

      const allowed = await MCP.appAllowedTools(server, uri)
      const deny = manifestDenyReason(allowed, toolName)
      if (deny) {
        return c.json({ isError: true, content: [{ type: "text", text: deny.error }] }, 200)
      }

      // ADR-005 §2: per-call permission gate. Routes through the existing
      // permission system with a `mcp-app:<server>:<tool>` permission name
      // so wildcard matching + project-wide rules + the new session-scoped
      // grants all apply. Failures and rejections become in-band isError
      // responses so the iframe's bridge stays alive.
      const scope = permissionScope(server, uri, toolName)
      try {
        await PermissionNext.ask({
          sessionID,
          permission: scope.permission,
          patterns: [scope.pattern],
          always: [scope.pattern],
          metadata: { kind: "mcp-app", server, uri, tool: toolName, arguments: toolArgs },
          ruleset: [],
        })
      } catch (err) {
        if (err instanceof PermissionService.RejectedError || err instanceof PermissionService.CorrectedError) {
          return c.json(
            {
              isError: true,
              content: [{ type: "text", text: "User denied permission for this MCP app tool call." }],
            },
            200,
          )
        }
        if (err instanceof PermissionService.DeniedError) {
          return c.json(
            {
              isError: true,
              content: [{ type: "text", text: "A project rule denies this MCP app tool call." }],
            },
            200,
          )
        }
        throw err
      }

      try {
        const result = await MCP.callServerTool(server, toolName, toolArgs)
        return c.json(result, 200)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ isError: true, content: [{ type: "text", text: `Tool call failed: ${message}` }] }, 200)
      }
    },
  )
