import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { MCP } from "../../../mcp"
import {
  PER_APP_CONTEXT_CHAR_CAP,
  PER_SESSION_CONTEXT_CHAR_CAP,
  clearAppContext,
  setAppContext,
} from "../../../mcp/app-context"
import { PermissionNext } from "../../../permission/next"
import * as PermissionService from "../../../permission/service"
import { SessionPrompt } from "../../../session/prompt"
import { SessionID } from "../../../session/schema"
import { errors } from "../../error"

export { PER_APP_CONTEXT_CHAR_CAP, PER_SESSION_CONTEXT_CHAR_CAP }

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

/**
 * Default per-app char limit for ui/message text. Mirrors the client
 * constant in mcp-app-message.ts; v0.9.48 will let the user override
 * per-app via the Settings → Apps pane.
 */
export const DEFAULT_MCP_MESSAGE_CHAR_LIMIT_SERVER = 8000

const MessageBody = z
  .object({
    server: z.string().min(1),
    uri: z.string().min(1),
    text: z.string().min(1),
  })
  .strict()

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
  .post(
    "/:sessionID/mcp-apps/message",
    describeRoute({
      summary: "Post a message into the chat thread on behalf of an MCP app",
      description:
        "Wires the MCP `ui/message` AppBridge request into the host session. Per ADR-005 §8 + " +
        "the v0.9.46 user decision: default-deny (every call gates through the permission system), " +
        "char-limit enforced (default 8000, per-app override in v0.9.48), origin metadata attached " +
        "so the renderer can label the message as app-posted, and the host returns no follow-up " +
        "to the app (the bridge gets `{}` whether the model replies or not).",
      operationId: "session.mcpApps.message",
      responses: { 200: { description: "OK" }, ...errors(400, 403, 404) },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator("json", MessageBody),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { server, uri, text } = c.req.valid("json")

      if (server === BUILTIN_SERVER) {
        return c.json({ isError: true, error: "Built-in MCP apps cannot post chat messages." }, 200)
      }

      // Char-limit enforcement. Mirrors the client-side validation in
      // mcp-app-message.ts; both layers check so a misbehaving client
      // can't bypass by hitting the route directly.
      if (text.length > DEFAULT_MCP_MESSAGE_CHAR_LIMIT_SERVER) {
        return c.json(
          {
            isError: true,
            error: `text exceeds char limit (${text.length} > ${DEFAULT_MCP_MESSAGE_CHAR_LIMIT_SERVER}).`,
          },
          200,
        )
      }

      // Permission gate: separate scope from tool calls, with a
      // sentinel `_message` "tool" name so users can grant or deny
      // chat-posting rights independently of tool calls.
      try {
        await PermissionNext.ask({
          sessionID,
          permission: `mcp-app:${server}:_message`,
          patterns: [uri],
          always: [uri],
          metadata: { kind: "mcp-app", server, uri, tool: "_message", text: text.slice(0, 200) },
          ruleset: [],
        })
      } catch (err) {
        if (err instanceof PermissionService.RejectedError || err instanceof PermissionService.CorrectedError) {
          return c.json({ isError: true, error: "User denied this MCP app's request to post a message." }, 200)
        }
        if (err instanceof PermissionService.DeniedError) {
          return c.json({ isError: true, error: "A project rule denies this MCP app from posting messages." }, 200)
        }
        throw err
      }

      // Post the message into the session. Origin metadata lives in
      // the part's `_meta` so the renderer can show a "Posted by
      // <appName>" badge in v0.9.48. We deliberately don't await the
      // model's reply here — per ADR-005 §8 the host MUST NOT return
      // any follow-up to the app.
      try {
        SessionPrompt.prompt({
          sessionID,
          parts: [
            {
              type: "text",
              text,
              _meta: { mcpApp: { server, uri } },
            } as never,
          ],
        }).catch(() => {})
        return c.json({ ok: true }, 200)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ isError: true, error: `Failed to post message: ${message}` }, 200)
      }
    },
  )
  .post(
    "/:sessionID/mcp-apps/context",
    describeRoute({
      summary: "Update an MCP app's model-context contribution for the next turn",
      description:
        "Wires the MCP `ui/update-model-context` AppBridge request. Per ADR-005 §7 + the v0.9.47 " +
        "user decisions: replace-on-write per (server, uri); per-app + per-session char caps " +
        "enforced; contexts copy forward when the session is forked; user can clear via the " +
        "v0.9.48 Settings → Apps pane. Returns {ok: true} on success or {isError: true} with a " +
        "reason string on cap breach so the iframe sees the failure mode.",
      operationId: "session.mcpApps.context",
      responses: { 200: { description: "OK" }, ...errors(400, 404) },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator(
      "json",
      z
        .object({
          server: z.string().min(1),
          uri: z.string().min(1),
          content: z.string(),
          structuredContent: z.unknown().optional(),
        })
        .strict(),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const body = c.req.valid("json")

      if (body.server === BUILTIN_SERVER) {
        return c.json({ isError: true, error: "Built-in MCP apps cannot push model context." }, 200)
      }

      const result = setAppContext({
        sessionID,
        server: body.server,
        uri: body.uri,
        content: body.content,
        structuredContent: body.structuredContent,
      })
      if (!result.ok) return c.json({ isError: true, error: result.reason }, 200)
      return c.json({ ok: true, updatedAt: result.entry.updatedAt }, 200)
    },
  )
  .post(
    "/:sessionID/mcp-apps/context/clear",
    describeRoute({
      summary: "Clear an MCP app's model-context contribution",
      description:
        "Removes the per-app entry. Used by the v0.9.48 Settings → Apps pane and by Disconnect. " +
        "Permission-free — clearing is always safe (it can only reduce model context, never expand it).",
      operationId: "session.mcpApps.context.clear",
      responses: { 200: { description: "OK" }, ...errors(400, 404) },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator("json", z.object({ server: z.string().min(1), uri: z.string().min(1) }).strict()),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { server, uri } = c.req.valid("json")
      clearAppContext(sessionID, server, uri)
      return c.json({ ok: true }, 200)
    },
  )
