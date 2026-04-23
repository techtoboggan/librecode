import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { MCP } from "../../mcp"
import { McpAppState } from "../../mcp/app-state"
import { getBuiltinAppHtml, listBuiltinApps } from "../../mcp/builtin-apps"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

const AppResource = z.object({
  server: z.string(),
  name: z.string(),
  uri: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
})

export const McpRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get MCP status",
        description: "Get the status of all Model Context Protocol (MCP) servers.",
        operationId: "mcp.status",
        responses: {
          200: {
            description: "MCP server status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.status())
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Add MCP server",
        description: "Dynamically add a new Model Context Protocol (MCP) server to the system.",
        operationId: "mcp.add",
        responses: {
          200: {
            description: "MCP server added successfully",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          config: Config.Mcp,
        }),
      ),
      async (c) => {
        const { name, config } = c.req.valid("json")
        const result = await MCP.add(name, config)
        return c.json(result.status)
      },
    )
    .post(
      "/:name/auth",
      describeRoute({
        summary: "Start MCP OAuth",
        description: "Start OAuth authentication flow for a Model Context Protocol (MCP) server.",
        operationId: "mcp.auth.start",
        responses: {
          200: {
            description: "OAuth flow started",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    authorizationUrl: z.string().describe("URL to open in browser for authorization"),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const supportsOAuth = await MCP.supportsOAuth(name)
        if (!supportsOAuth) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        const result = await MCP.startAuth(name)
        return c.json(result)
      },
    )
    .post(
      "/:name/auth/callback",
      describeRoute({
        summary: "Complete MCP OAuth",
        description:
          "Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.",
        operationId: "mcp.auth.callback",
        responses: {
          200: {
            description: "OAuth authentication completed",
            content: {
              "application/json": {
                schema: resolver(MCP.Status),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          code: z.string().describe("Authorization code from OAuth callback"),
        }),
      ),
      async (c) => {
        const name = c.req.param("name")
        const { code } = c.req.valid("json")
        const status = await MCP.finishAuth(name, code)
        return c.json(status)
      },
    )
    .post(
      "/:name/auth/authenticate",
      describeRoute({
        summary: "Authenticate MCP OAuth",
        description: "Start OAuth flow and wait for callback (opens browser)",
        operationId: "mcp.auth.authenticate",
        responses: {
          200: {
            description: "OAuth authentication completed",
            content: {
              "application/json": {
                schema: resolver(MCP.Status),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const supportsOAuth = await MCP.supportsOAuth(name)
        if (!supportsOAuth) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        const status = await MCP.authenticate(name)
        return c.json(status)
      },
    )
    .delete(
      "/:name/auth",
      describeRoute({
        summary: "Remove MCP OAuth",
        description: "Remove OAuth credentials for an MCP server",
        operationId: "mcp.auth.remove",
        responses: {
          200: {
            description: "OAuth credentials removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        await MCP.removeAuth(name)
        return c.json({ success: true as const })
      },
    )
    .post(
      "/:name/connect",
      describeRoute({
        description: "Connect an MCP server",
        operationId: "mcp.connect",
        responses: {
          200: {
            description: "MCP server connected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        await MCP.connect(name)
        return c.json(true)
      },
    )
    .get(
      "/apps",
      describeRoute({
        summary: "List MCP App UI resources",
        description:
          "Returns all UI resources (mimeType text/html;profile=mcp-app) across connected MCP servers. " +
          "Each entry represents an MCP App that can be rendered in a sandboxed iframe.",
        operationId: "mcp.apps.list",
        responses: {
          200: {
            description: "List of available MCP App UI resources",
            content: {
              "application/json": {
                schema: resolver(z.array(AppResource)),
              },
            },
          },
        },
      }),
      async (c) => {
        const all = await MCP.uiResources()
        const mcpApps = Object.entries(all).map(([, r]) => ({
          server: r.client,
          name: r.name,
          uri: r.uri,
          description: r.description,
          mimeType: r.mimeType,
        }))
        // Merge built-in apps with discovered MCP apps
        const builtins = listBuiltinApps()
        return c.json([...builtins, ...mcpApps])
      },
    )
    .get(
      "/apps/html",
      describeRoute({
        summary: "Fetch MCP App HTML",
        description: "Fetches the HTML content for a specific MCP App UI resource identified by server name and uri.",
        operationId: "mcp.apps.html",
        responses: {
          200: {
            description: "HTML content of the MCP App",
            content: {
              "text/html": {
                schema: resolver(z.string()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "query",
        z.object({
          server: z.string().describe("MCP server name"),
          uri: z.string().describe("UI resource URI (ui://...)"),
        }),
      ),
      async (c) => {
        const { server, uri } = c.req.valid("query")

        // Check built-in apps first
        if (server === "__builtin__") {
          const builtinHtml = getBuiltinAppHtml(uri)
          if (builtinHtml) return c.text(builtinHtml, 200, { "Content-Type": "text/html; charset=utf-8" })
          return c.json({ error: `Built-in app not found: ${uri}` }, 404)
        }

        const html = await MCP.fetchAppHtml(server, uri)
        if (!html) {
          return c.json({ error: `MCP App resource not found: ${uri} on server ${server}` }, 404)
        }
        return c.text(html, 200, { "Content-Type": "text/html; charset=utf-8" })
      },
    )
    .get(
      "/apps/state",
      describeRoute({
        summary: "Load an MCP app's persistent state",
        description:
          "v0.9.63 — returns the JSON blob the given (server, uri) app has previously saved via PUT. " +
          "Returns 200 with `{ state: null }` if the app has no saved state yet. Storage lives at " +
          "`~/.local/librecode-mcp-apps/<server-slug>/<uri-hash>.json` so users can inspect or reset " +
          "individual apps' state manually.",
        operationId: "mcp.apps.state.load",
        responses: { 200: { description: "OK" }, ...errors(400) },
      }),
      validator("query", z.object({ server: z.string().min(1), uri: z.string().min(1) })),
      async (c) => {
        const { server, uri } = c.req.valid("query")
        const state = await McpAppState.load(server, uri)
        return c.json({ state: state ?? null })
      },
    )
    .put(
      "/apps/state",
      describeRoute({
        summary: "Save an MCP app's persistent state",
        description:
          "Writes the provided JSON blob for the given (server, uri) app. Enforces a per-app size cap " +
          "(see `McpAppState.MAX_STATE_BYTES`); writes atomically via a rename from a .tmp sibling. " +
          "PUT with `{ state: null }` clears the stored record.",
        operationId: "mcp.apps.state.save",
        responses: { 200: { description: "OK" }, 413: { description: "State too large" }, ...errors(400) },
      }),
      validator("query", z.object({ server: z.string().min(1), uri: z.string().min(1) })),
      validator("json", z.object({ state: z.unknown() })),
      async (c) => {
        const { server, uri } = c.req.valid("query")
        const { state } = c.req.valid("json")
        const result = await McpAppState.save(server, uri, state === null ? undefined : state)
        if (!result.ok) {
          const status = result.reason === "too_large" ? 413 : 400
          return c.json({ error: result.message }, status)
        }
        return c.json({ ok: true })
      },
    )
    .post(
      "/:name/disconnect",
      describeRoute({
        description: "Disconnect an MCP server",
        operationId: "mcp.disconnect",
        responses: {
          200: {
            description: "MCP server disconnected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        await MCP.disconnect(name)
        return c.json(true)
      },
    ),
)
