import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import z from "zod"
import { MCP } from "../../../mcp"
import { SessionID } from "../../../session/schema"
import { errors } from "../../error"

/**
 * Read-only proxy routes used by the MCP-app AppBridge handlers
 * (`onlistresources`, `onreadresource`, `onlistresourcetemplates`,
 * `onlistprompts`). Per ADR-005 §4 these don't require permission
 * prompts — the MCP server already chose to advertise them — but they
 * are scoped per session and per server so a misbehaving app cannot
 * enumerate other servers' resources.
 *
 * Built-in apps (server === "__builtin__") are denied: they have no
 * real MCP server backing them.
 */

const BUILTIN_SERVER = "__builtin__"

/**
 * URI safety check for `resources/read`. The app may only read URIs
 * the same server has actually advertised via `resources/list`, so a
 * malicious app cannot read arbitrary file:// or other server-internal
 * URIs by guessing.
 *
 * Returns null when allowed; an error string when denied.
 */
export async function denyReadReason(server: string, uri: string): Promise<string | null> {
  if (server === BUILTIN_SERVER) return "Built-in MCP apps cannot read resources."
  const listed = await MCP.listResourcesForServer(server)
  if (!listed) return `MCP server "${server}" is not connected.`
  const known = listed.resources.some((r) => r.uri === uri)
  if (!known) return `Resource "${uri}" was not advertised by server "${server}".`
  return null
}

/** Standard error JSON shape for these routes — matches CallToolResult. */
function errorJson(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] }
}

const ServerQuery = z.object({ server: z.string().min(1).describe("MCP server name") })

const ReadBody = z
  .object({
    server: z.string().min(1).describe("MCP server name"),
    uri: z.string().min(1).describe("Resource URI to read (must have been listed by resources/list)"),
  })
  .strict()

export const SessionMcpAppReadRoutes = new Hono()
  .get(
    "/:sessionID/mcp-apps/resources",
    describeRoute({
      summary: "List resources advertised by an MCP server (proxy for MCP apps)",
      operationId: "session.mcpApps.resources.list",
      responses: { ...errors(400, 404) },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator("query", ServerQuery),
    async (c) => {
      const { server } = c.req.valid("query")
      if (server === BUILTIN_SERVER) return c.json(errorJson("Built-in MCP apps cannot list resources."), 200)
      try {
        const result = await MCP.listResourcesForServer(server)
        if (!result) return c.json(errorJson(`MCP server "${server}" is not connected.`), 200)
        return c.json(result, 200)
      } catch (err) {
        return c.json(errorJson(`resources/list failed: ${err instanceof Error ? err.message : String(err)}`), 200)
      }
    },
  )
  .post(
    "/:sessionID/mcp-apps/resources/read",
    describeRoute({
      summary: "Read a resource from an MCP server (proxy for MCP apps)",
      operationId: "session.mcpApps.resources.read",
      responses: { ...errors(400, 403, 404) },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator("json", ReadBody),
    async (c) => {
      const { server, uri } = c.req.valid("json")
      const deny = await denyReadReason(server, uri)
      if (deny) return c.json(errorJson(deny), 200)
      try {
        const result = await MCP.readResource(server, uri)
        if (!result) return c.json(errorJson(`Failed to read resource "${uri}".`), 200)
        return c.json(result, 200)
      } catch (err) {
        return c.json(errorJson(`resources/read failed: ${err instanceof Error ? err.message : String(err)}`), 200)
      }
    },
  )
  .get(
    "/:sessionID/mcp-apps/resource-templates",
    describeRoute({
      summary: "List resource templates advertised by an MCP server",
      operationId: "session.mcpApps.resourceTemplates.list",
      responses: { ...errors(400, 404) },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator("query", ServerQuery),
    async (c) => {
      const { server } = c.req.valid("query")
      if (server === BUILTIN_SERVER) return c.json(errorJson("Built-in MCP apps cannot list resource templates."), 200)
      try {
        const result = await MCP.listResourceTemplatesForServer(server)
        if (!result) return c.json(errorJson(`MCP server "${server}" is not connected.`), 200)
        return c.json(result, 200)
      } catch (err) {
        return c.json(
          errorJson(`resources/templates/list failed: ${err instanceof Error ? err.message : String(err)}`),
          200,
        )
      }
    },
  )
  .get(
    "/:sessionID/mcp-apps/prompts",
    describeRoute({
      summary: "List prompts advertised by an MCP server",
      operationId: "session.mcpApps.prompts.list",
      responses: { ...errors(400, 404) },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator("query", ServerQuery),
    async (c) => {
      const { server } = c.req.valid("query")
      if (server === BUILTIN_SERVER) return c.json(errorJson("Built-in MCP apps cannot list prompts."), 200)
      try {
        const result = await MCP.listPromptsForServer(server)
        if (!result) return c.json(errorJson(`MCP server "${server}" is not connected.`), 200)
        return c.json(result, 200)
      } catch (err) {
        return c.json(errorJson(`prompts/list failed: ${err instanceof Error ? err.message : String(err)}`), 200)
      }
    },
  )
