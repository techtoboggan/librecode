import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { MCP } from "../../../mcp"
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

const ToolCallResultLike = z.object({
  content: z.array(z.unknown()),
  isError: z.boolean().optional(),
})

export const SessionMcpAppRoutes = new Hono().post(
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
    const { server, uri, name: toolName } = c.req.valid("json")
    const toolArgs = (c.req.valid("json").arguments ?? {}) as Record<string, unknown>

    if (server === BUILTIN_SERVER) {
      return c.json(
        {
          isError: true,
          content: [
            { type: "text", text: "Built-in MCP apps cannot invoke tools — they are display-only." },
          ],
        },
        200,
      )
    }

    const allowed = await MCP.appAllowedTools(server, uri)
    const deny = manifestDenyReason(allowed, toolName)
    if (deny) {
      return c.json(
        { isError: true, content: [{ type: "text", text: deny.error }] },
        200,
      )
    }

    try {
      const result = await MCP.callServerTool(server, toolName, toolArgs)
      return c.json(result, 200)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json(
        { isError: true, content: [{ type: "text", text: `Tool call failed: ${message}` }] },
        200,
      )
    }
  },
)
