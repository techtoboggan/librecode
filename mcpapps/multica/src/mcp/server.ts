/**
 * v0.9.76 — Multica MCP server.
 *
 * Speaks MCP over stdio (per the spec) so any MCP host — LibreCode,
 * Claude Code, Cursor, etc. — can connect and either:
 *   - Use the three issue-management tools (`multica_create_issue`,
 *     `multica_update_status`, `multica_add_comment`).
 *   - Read the `ui://multica/board` resource to render the kanban
 *     inline as an MCP-Apps embed.
 *
 * Configuration is read from environment variables on startup. Hosts
 * spawn the server with these set; the user-facing config lives in
 * the host's MCP config file (e.g. LibreCode's `librecode.jsonc`).
 *
 *   MULTICA_BASE_URL          # e.g. http://localhost:8080
 *   MULTICA_TOKEN             # PAT, prefix `mul_`
 *   MULTICA_WORKSPACE_SLUG    # workspace short name
 *   MULTICA_WEB_URL           # e.g. http://localhost:3000 (for the iframe)
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { MulticaClient } from "../multica/client"
import {
  AddCommentInput,
  CreateIssueInput,
  runAddComment,
  runCreateIssue,
  runUpdateStatus,
  UpdateStatusInput,
} from "./tools"

const BOARD_URI = "ui://multica/board"
const APP_NAME = "Multica Board"

export interface ServerConfig {
  baseUrl: string
  token: string
  workspaceSlug: string
  webUrl: string
  /** Override path within the workspace — defaults to "/board". */
  boardPath?: string
}

/**
 * Read config from env. Throws if any required field is missing so
 * the launcher can print a single clear error instead of letting the
 * server start with a partial config.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const required = ["MULTICA_BASE_URL", "MULTICA_TOKEN", "MULTICA_WORKSPACE_SLUG"] as const
  const missing = required.filter((k) => !env[k])
  if (missing.length > 0) {
    throw new Error(
      `Multica MCP app: missing required env var(s): ${missing.join(", ")}. ` +
        `See the README for setup instructions.`,
    )
  }
  return {
    baseUrl: env.MULTICA_BASE_URL!,
    token: env.MULTICA_TOKEN!,
    workspaceSlug: env.MULTICA_WORKSPACE_SLUG!,
    webUrl: env.MULTICA_WEB_URL ?? "http://localhost:3000",
    boardPath: env.MULTICA_BOARD_PATH ?? "/board",
  }
}

/**
 * Read the bundled `board.html` once at startup. Resolves relative to
 * this file regardless of cwd so the published package + the dev
 * runtime both work.
 */
function loadBoardHtml(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, "../web/board.html"), // dev: src/mcp/server.ts → src/web/board.html
    path.resolve(here, "./web/board.html"), // bundled: dist/mcp/server.js → dist/web/board.html
  ]
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8")
    } catch {
      // Try next candidate
    }
  }
  throw new Error(`Multica MCP app: could not locate board.html (looked in: ${candidates.join(", ")})`)
}

/**
 * Render the board.html with workspace + URL injected as <meta> tags
 * the page reads at boot. Done at request time so re-configuring
 * the MCP server (env edit + restart) shows up without a rebuild.
 */
export function renderBoardHtml(template: string, config: ServerConfig): string {
  const meta = [
    `<meta name="multica-board:web-url" content="${escapeAttr(config.webUrl)}">`,
    `<meta name="multica-board:workspace-slug" content="${escapeAttr(config.workspaceSlug)}">`,
    `<meta name="multica-board:path" content="${escapeAttr(config.boardPath ?? "/board")}">`,
  ].join("\n    ")
  // Insert just after <head> if present, else prepend a head block.
  if (/<head(\s[^>]*)?>/i.test(template)) {
    return template.replace(/(<head(\s[^>]*)?>)/i, `$1\n    ${meta}`)
  }
  return `<head>\n    ${meta}\n  </head>\n${template}`
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

/**
 * Build the MCP `Server` instance. Pure factory so tests can drive
 * the request handlers directly without spawning stdio.
 */
export function createMulticaMcpServer(config: ServerConfig, opts: { fetchFn?: typeof fetch } = {}): Server {
  const client = new MulticaClient({
    baseUrl: config.baseUrl,
    token: config.token,
    workspaceSlug: config.workspaceSlug,
    fetchFn: opts.fetchFn,
  })
  const boardTemplate = loadBoardHtml()

  const server = new Server(
    { name: "multica", version: "0.9.76" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      // Per the MCP-Apps extension: declare the resource as a UI
      // surface so hosts know to render it in their iframe panel.
      // Tools are advertised separately so non-iframe hosts can still
      // use them.
      instructions:
        "Multica issue tracker integration. Use the tools to create + update issues; " +
        "read `ui://multica/board` to render the kanban inline.",
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "multica_create_issue",
        description:
          "Create a new Multica issue. Use this at the start of substantial work so progress can be tracked on the kanban.",
        inputSchema: zodToJsonSchema(CreateIssueInput),
      },
      {
        name: "multica_update_status",
        description: "Move an existing Multica issue to a different status column.",
        inputSchema: zodToJsonSchema(UpdateStatusInput),
      },
      {
        name: "multica_add_comment",
        description: "Append a comment to an existing Multica issue. Use this to log progress or capture context.",
        inputSchema: zodToJsonSchema(AddCommentInput),
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "multica_create_issue": {
        const input = CreateIssueInput.parse(request.params.arguments ?? {})
        return runCreateIssue(client, input)
      }
      case "multica_update_status": {
        const input = UpdateStatusInput.parse(request.params.arguments ?? {})
        return runUpdateStatus(client, input)
      }
      case "multica_add_comment": {
        const input = AddCommentInput.parse(request.params.arguments ?? {})
        return runAddComment(client, input)
      }
      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        }
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      {
        uri: BOARD_URI,
        name: APP_NAME,
        description: "Linear-style kanban view of the configured Multica workspace, embedded as an MCP App.",
        mimeType: "text/html;profile=mcp-app",
        _meta: {
          ui: {
            // Hosts that follow the MCP-Apps spec use this to decide
            // which kinds of bridge requests to forward.
            allowedTools: ["multica_create_issue", "multica_update_status", "multica_add_comment"],
          },
        },
      },
    ],
  }))

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    if (request.params.uri !== BOARD_URI) {
      throw new Error(`Multica MCP app: unknown resource ${request.params.uri}`)
    }
    return {
      contents: [
        {
          uri: BOARD_URI,
          mimeType: "text/html;profile=mcp-app",
          text: renderBoardHtml(boardTemplate, config),
        },
      ],
    }
  })

  return server
}

/**
 * Translate a Zod schema into the JSON-Schema shape the MCP tool
 * advertisement expects. Only handles the subset the three Multica
 * tools use (objects with string + enum fields) — keeps the
 * dependency graph small (no full zod-to-json-schema package).
 */
function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodFieldToJson(value as z.ZodTypeAny)
    if (!(value instanceof z.ZodOptional)) required.push(key)
  }
  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  }
}

function zodFieldToJson(schema: z.ZodTypeAny): Record<string, unknown> {
  const description = schema.description
  if (schema instanceof z.ZodOptional) {
    return zodFieldToJson(schema.unwrap())
  }
  if (schema instanceof z.ZodString) {
    return { type: "string", ...(description ? { description } : {}) }
  }
  if (schema instanceof z.ZodEnum) {
    const def = (schema as unknown as { def: { entries: readonly string[] } }).def
    return { type: "string", enum: def.entries, ...(description ? { description } : {}) }
  }
  return { ...(description ? { description } : {}) }
}

/**
 * Connect the server over stdio — what every MCP host expects when
 * spawning a local MCP child process.
 */
export async function runStdio(config: ServerConfig): Promise<void> {
  const server = createMulticaMcpServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
