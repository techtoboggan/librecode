import { NamedError } from "@librecode/util/error"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { dynamicTool, type JSONSchema7, jsonSchema, type Tool } from "ai"
import open from "open"
import z from "zod/v4"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { withTimeout } from "@/util/timeout"
import { BusEvent } from "../bus/bus-event"
import { Config } from "../config/config"
import { Installation } from "../installation"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { McpAuth } from "./auth"
import { McpOAuthCallback } from "./oauth-callback"
import { McpOAuthProvider } from "./oauth-provider"

const log = Log.create({ service: "mcp" })
const DEFAULT_TIMEOUT = 30_000

const Resource = z
  .object({
    name: z.string(),
    uri: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    client: z.string(),
  })
  .meta({ ref: "McpResource" })

const ToolsChanged = BusEvent.define(
  "mcp.tools.changed",
  z.object({
    server: z.string(),
  }),
)

const BrowserOpenFailed = BusEvent.define(
  "mcp.browser.open.failed",
  z.object({
    mcpName: z.string(),
    url: z.string(),
  }),
)

const Failed = NamedError.create(
  "MCPFailed",
  z.object({
    name: z.string(),
  }),
)

type MCPClient = Client

const Status = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("connected"),
      })
      .meta({
        ref: "MCPStatusConnected",
      }),
    z
      .object({
        status: z.literal("disabled"),
      })
      .meta({
        ref: "MCPStatusDisabled",
      }),
    z
      .object({
        status: z.literal("failed"),
        error: z.string(),
      })
      .meta({
        ref: "MCPStatusFailed",
      }),
    z
      .object({
        status: z.literal("needs_auth"),
      })
      .meta({
        ref: "MCPStatusNeedsAuth",
      }),
    z
      .object({
        status: z.literal("needs_client_registration"),
        error: z.string(),
      })
      .meta({
        ref: "MCPStatusNeedsClientRegistration",
      }),
  ])
  .meta({
    ref: "MCPStatus",
  })

// Register notification handlers for MCP client
function registerNotificationHandlers(client: MCPClient, serverName: string) {
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    log.info("tools list changed notification received", { server: serverName })
    Bus.publish(ToolsChanged, { server: serverName })
  })
}

// Convert MCP tool definition to AI SDK Tool type
async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Promise<Tool> {
  const inputSchema = mcpTool.inputSchema

  // Spread first, then override type to ensure it's always "object"
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      return client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout,
        },
      )
    },
  })
}

// Store transports for OAuth servers to allow finishing auth
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
const pendingOAuthTransports = new Map<string, TransportWithAuth>()

// Prompt cache types
type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]

type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
type McpEntry = NonNullable<Config.Info["mcp"]>[string]
function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
  return typeof entry === "object" && entry !== null && "type" in entry
}

async function descendants(pid: number): Promise<number[]> {
  if (process.platform === "win32") return []
  const pids: number[] = []
  const queue = [pid]
  while (queue.length > 0) {
    const current = queue.shift()!
    const proc = Bun.spawn(["pgrep", "-P", String(current)], { stdout: "pipe", stderr: "pipe" })
    const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]).catch(
      () => [-1, ""] as const,
    )
    if (code !== 0) continue
    for (const tok of out.trim().split(/\s+/)) {
      const cpid = parseInt(tok, 10)
      if (!Number.isNaN(cpid) && pids.indexOf(cpid) === -1) {
        pids.push(cpid)
        queue.push(cpid)
      }
    }
  }
  return pids
}

const state = Instance.state(
  async () => {
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const clients: Record<string, MCPClient> = {}
    const status: Record<string, MCP.Status> = {}

    await Promise.all(
      Object.entries(config).map(async ([key, mcp]) => {
        if (!isMcpConfigured(mcp)) {
          log.error("Ignoring MCP config entry without type", { key })
          return
        }

        // If disabled by config, mark as disabled without trying to connect
        if (mcp.enabled === false) {
          status[key] = { status: "disabled" }
          return
        }

        const result = await create(key, mcp).catch(() => undefined)
        if (!result) return

        status[key] = result.status

        if (result.mcpClient) {
          clients[key] = result.mcpClient
        }
      }),
    )
    return {
      status,
      clients,
    }
  },
  async (s) => {
    // The MCP SDK only signals the direct child process on close.
    // Servers like chrome-devtools-mcp spawn grandchild processes
    // (e.g. Chrome) that the SDK never reaches, leaving them orphaned.
    // Kill the full descendant tree first so the server exits promptly
    // and no processes are left behind.
    for (const client of Object.values(s.clients)) {
      const pid = (client.transport as any)?.pid
      if (typeof pid !== "number") continue
      for (const dpid of await descendants(pid)) {
        try {
          process.kill(dpid, "SIGTERM")
        } catch {}
      }
    }

    await Promise.all(
      Object.values(s.clients).map((client) =>
        client.close().catch((error) => {
          log.error("Failed to close MCP client", {
            error,
          })
        }),
      ),
    )
    pendingOAuthTransports.clear()
  },
)

// Helper function to fetch prompts for a specific client
async function fetchPromptsForClient(clientName: string, client: Client) {
  const prompts = await client.listPrompts().catch((e) => {
    log.error("failed to get prompts", { clientName, error: e.message })
    return undefined
  })

  if (!prompts) {
    return
  }

  const commands: Record<string, PromptInfo & { client: string }> = {}

  for (const prompt of prompts.prompts) {
    const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
    const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
    const key = `${sanitizedClientName}:${sanitizedPromptName}`

    commands[key] = { ...prompt, client: clientName }
  }
  return commands
}

async function fetchResourcesForClient(clientName: string, client: Client) {
  const resources = await client.listResources().catch((e) => {
    log.error("failed to get prompts", { clientName, error: e.message })
    return undefined
  })

  if (!resources) {
    return
  }

  const commands: Record<string, ResourceInfo & { client: string }> = {}

  for (const resource of resources.resources) {
    const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
    const sanitizedResourceName = resource.name.replace(/[^a-zA-Z0-9_-]/g, "_")
    const key = `${sanitizedClientName}:${sanitizedResourceName}`

    commands[key] = { ...resource, client: clientName }
  }
  return commands
}

async function add(name: string, mcp: Config.Mcp) {
  const s = await state()
  const result = await create(name, mcp)
  if (!result) {
    const status = {
      status: "failed" as const,
      error: "unknown error",
    }
    s.status[name] = status
    return {
      status,
    }
  }
  if (!result.mcpClient) {
    s.status[name] = result.status
    return {
      status: s.status,
    }
  }
  // Close existing client if present to prevent memory leaks
  const existingClient = s.clients[name]
  if (existingClient) {
    await existingClient.close().catch((error) => {
      log.error("Failed to close existing MCP client", { name, error })
    })
  }
  s.clients[name] = result.mcpClient
  s.status[name] = result.status

  return {
    status: s.status,
  }
}

type CreateResult = { mcpClient: MCPClient | undefined; status: MCP.Status }

function buildRemoteAuthProvider(
  key: string,
  mcp: Extract<Config.Mcp, { type: "remote" }>,
): McpOAuthProvider | undefined {
  if (mcp.oauth === false) return undefined
  const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
  return new McpOAuthProvider(
    key,
    mcp.url,
    {
      clientId: oauthConfig?.clientId,
      clientSecret: oauthConfig?.clientSecret,
      scope: oauthConfig?.scope,
    },
    {
      onRedirect: async (url) => {
        log.info("oauth redirect requested", { key, url: url.toString() })
      },
    },
  )
}

function classifyAuthError(
  lastError: Error,
  authProvider: McpOAuthProvider | undefined,
): "registration" | "needs_auth" | null {
  if (!authProvider) return null
  const isAuthError = lastError instanceof UnauthorizedError || lastError.message.includes("OAuth")
  if (!isAuthError) return null
  if (lastError.message.includes("registration") || lastError.message.includes("client_id")) return "registration"
  return "needs_auth"
}

function handleRegistrationError(key: string): MCP.Status {
  const status: MCP.Status = {
    status: "needs_client_registration",
    error: "Server does not support dynamic client registration. Please provide clientId in config.",
  }
  Bus.publish(TuiEvent.ToastShow, {
    title: "MCP Authentication Required",
    message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
    variant: "warning",
    duration: 8000,
  }).catch((e) => log.debug("failed to show toast", { error: e }))
  return status
}

function handleNeedsAuthError(key: string, transport: TransportWithAuth): MCP.Status {
  pendingOAuthTransports.set(key, transport)
  const status: MCP.Status = { status: "needs_auth" }
  Bus.publish(TuiEvent.ToastShow, {
    title: "MCP Authentication Required",
    message: `Server "${key}" requires authentication. Run: librecode mcp auth ${key}`,
    variant: "warning",
    duration: 8000,
  }).catch((e) => log.debug("failed to show toast", { error: e }))
  return status
}

type TransportConnectResult =
  | { connected: true; client: MCPClient }
  | { connected: false; status: MCP.Status; stop: boolean }

async function tryConnectTransport(
  key: string,
  transportName: string,
  transport: TransportWithAuth,
  authProvider: McpOAuthProvider | undefined,
  connectTimeout: number,
  url: string,
): Promise<TransportConnectResult> {
  try {
    const client = new Client({ name: "librecode", version: Installation.VERSION })
    await withTimeout(client.connect(transport), connectTimeout)
    registerNotificationHandlers(client, key)
    log.info("connected", { key, transport: transportName })
    return { connected: true, client }
  } catch (error) {
    const lastError = error instanceof Error ? error : new Error(String(error))
    const authClass = classifyAuthError(lastError, authProvider)
    if (authClass !== null) {
      log.info("mcp server requires authentication", { key, transport: transportName })
      const status =
        authClass === "registration" ? handleRegistrationError(key) : handleNeedsAuthError(key, transport)
      return { connected: false, status, stop: true }
    }
    log.debug("transport connection failed", { key, transport: transportName, url, error: lastError.message })
    return { connected: false, status: { status: "failed", error: lastError.message }, stop: false }
  }
}

async function createRemoteClient(key: string, mcp: Extract<Config.Mcp, { type: "remote" }>): Promise<CreateResult> {
  const authProvider = buildRemoteAuthProvider(key, mcp)
  const transports: Array<{ name: string; transport: TransportWithAuth }> = [
    {
      name: "StreamableHTTP",
      transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
        authProvider,
        requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
      }),
    },
    {
      name: "SSE",
      transport: new SSEClientTransport(new URL(mcp.url), {
        authProvider,
        requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
      }),
    },
  ]

  const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
  let status: MCP.Status = { status: "failed", error: "Unknown error" }
  let mcpClient: MCPClient | undefined

  for (const { name, transport } of transports) {
    const result = await tryConnectTransport(key, name, transport, authProvider, connectTimeout, mcp.url)
    if (result.connected) {
      mcpClient = result.client
      status = { status: "connected" }
      break
    }
    status = result.status
    if (result.stop) break
  }

  return { mcpClient, status }
}

async function createLocalClient(key: string, mcp: Extract<Config.Mcp, { type: "local" }>): Promise<CreateResult> {
  const [cmd, ...args] = mcp.command
  const cwd = Instance.directory
  const transport = new StdioClientTransport({
    stderr: "pipe",
    command: cmd,
    args,
    cwd,
    env: {
      ...process.env,
      ...(cmd === "librecode" ? { BUN_BE_BUN: "1" } : {}),
      ...mcp.environment,
    },
  })
  transport.stderr?.on("data", (chunk: Buffer) => {
    log.info(`mcp stderr: ${chunk.toString()}`, { key })
  })

  const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
  try {
    const client = new Client({ name: "librecode", version: Installation.VERSION })
    await withTimeout(client.connect(transport), connectTimeout)
    registerNotificationHandlers(client, key)
    return { mcpClient: client, status: { status: "connected" } }
  } catch (error) {
    log.error("local mcp startup failed", {
      key,
      command: mcp.command,
      cwd,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      mcpClient: undefined,
      status: { status: "failed", error: error instanceof Error ? error.message : String(error) },
    }
  }
}

async function create(key: string, mcp: Config.Mcp): Promise<CreateResult> {
  if (mcp.enabled === false) {
    log.info("mcp server disabled", { key })
    return { mcpClient: undefined, status: { status: "disabled" } }
  }

  log.info("found", { key, type: mcp.type })

  let result: CreateResult
  if (mcp.type === "remote") {
    result = await createRemoteClient(key, mcp)
  } else if (mcp.type === "local") {
    result = await createLocalClient(key, mcp)
  } else {
    result = { mcpClient: undefined, status: { status: "failed", error: "Unknown error" } }
  }

  if (!result.mcpClient) return result

  const toolsList = await withTimeout(result.mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err) => {
    log.error("failed to get tools from client", { key, error: err })
    return undefined
  })
  if (!toolsList) {
    await result.mcpClient.close().catch((error) => {
      log.error("Failed to close MCP client", { error })
    })
    return { mcpClient: undefined, status: { status: "failed", error: "Failed to get tools" } }
  }

  log.info("create() successfully created client", { key, toolCount: toolsList.tools.length })
  return result
}

async function mcpStatus() {
  const s = await state()
  const cfg = await Config.get()
  const config = cfg.mcp ?? {}
  const result: Record<string, MCP.Status> = {}

  // Include all configured MCPs from config, not just connected ones
  for (const [key, mcp] of Object.entries(config)) {
    if (!isMcpConfigured(mcp)) continue
    result[key] = s.status[key] ?? { status: "disabled" }
  }

  return result
}

async function clients() {
  return state().then((s) => s.clients)
}

async function connect(name: string) {
  const cfg = await Config.get()
  const config = cfg.mcp ?? {}
  const mcp = config[name]
  if (!mcp) {
    log.error("MCP config not found", { name })
    return
  }

  if (!isMcpConfigured(mcp)) {
    log.error("Ignoring MCP connect request for config without type", { name })
    return
  }

  const result = await create(name, { ...mcp, enabled: true })

  if (!result) {
    const s = await state()
    s.status[name] = {
      status: "failed",
      error: "Unknown error during connection",
    }
    return
  }

  const s = await state()
  s.status[name] = result.status
  if (result.mcpClient) {
    // Close existing client if present to prevent memory leaks
    const existingClient = s.clients[name]
    if (existingClient) {
      await existingClient.close().catch((error) => {
        log.error("Failed to close existing MCP client", { name, error })
      })
    }
    s.clients[name] = result.mcpClient
  }
}

async function disconnect(name: string) {
  const s = await state()
  const client = s.clients[name]
  if (client) {
    await client.close().catch((error) => {
      log.error("Failed to close MCP client", { name, error })
    })
    delete s.clients[name]
  }
  s.status[name] = { status: "disabled" }
}

async function tools() {
  const result: Record<string, Tool> = {}
  const s = await state()
  const cfg = await Config.get()
  const config = cfg.mcp ?? {}
  const clientsSnapshot = await clients()
  const defaultTimeout = cfg.experimental?.mcp_timeout

  const connectedClients = Object.entries(clientsSnapshot).filter(
    ([clientName]) => s.status[clientName]?.status === "connected",
  )

  const toolsResults = await Promise.all(
    connectedClients.map(async ([clientName, client]) => {
      const toolsResult = await client.listTools().catch((e) => {
        log.error("failed to get tools", { clientName, error: e.message })
        const failedStatus = {
          status: "failed" as const,
          error: e instanceof Error ? e.message : String(e),
        }
        s.status[clientName] = failedStatus
        delete s.clients[clientName]
        return undefined
      })
      return { clientName, client, toolsResult }
    }),
  )

  for (const { clientName, client, toolsResult } of toolsResults) {
    if (!toolsResult) continue
    const mcpConfig = config[clientName]
    const entry = isMcpConfigured(mcpConfig) ? mcpConfig : undefined
    const timeout = entry?.timeout ?? defaultTimeout
    for (const mcpTool of toolsResult.tools) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      result[`${sanitizedClientName}_${sanitizedToolName}`] = await convertMcpTool(mcpTool, client, timeout)
    }
  }
  return result
}

async function prompts() {
  const s = await state()
  const clientsSnapshot = await clients()

  const result = Object.fromEntries<PromptInfo & { client: string }>(
    (
      await Promise.all(
        Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
          if (s.status[clientName]?.status !== "connected") {
            return []
          }

          return Object.entries((await fetchPromptsForClient(clientName, client)) ?? {})
        }),
      )
    ).flat(),
  )

  return result
}

async function resources() {
  const s = await state()
  const clientsSnapshot = await clients()

  const result = Object.fromEntries<ResourceInfo & { client: string }>(
    (
      await Promise.all(
        Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
          if (s.status[clientName]?.status !== "connected") {
            return []
          }

          return Object.entries((await fetchResourcesForClient(clientName, client)) ?? {})
        }),
      )
    ).flat(),
  )

  return result
}

async function getPrompt(clientName: string, name: string, args?: Record<string, string>) {
  const clientsSnapshot = await clients()
  const client = clientsSnapshot[clientName]

  if (!client) {
    log.warn("client not found for prompt", {
      clientName,
    })
    return undefined
  }

  const result = await client
    .getPrompt({
      name: name,
      arguments: args,
    })
    .catch((e) => {
      log.error("failed to get prompt from MCP server", {
        clientName,
        promptName: name,
        error: e.message,
      })
      return undefined
    })

  return result
}

async function readResource(clientName: string, resourceUri: string) {
  const clientsSnapshot = await clients()
  const client = clientsSnapshot[clientName]

  if (!client) {
    log.warn("client not found for prompt", {
      clientName: clientName,
    })
    return undefined
  }

  const result = await client
    .readResource({
      uri: resourceUri,
    })
    .catch((e) => {
      log.error("failed to get prompt from MCP server", {
        clientName: clientName,
        resourceUri: resourceUri,
        error: e.message,
      })
      return undefined
    })

  return result
}

/**
 * Start OAuth authentication flow for an MCP server.
 * Returns the authorization URL that should be opened in a browser.
 */
async function startAuth(mcpName: string): Promise<{ authorizationUrl: string }> {
  const cfg = await Config.get()
  const mcpConfig = cfg.mcp?.[mcpName]

  if (!mcpConfig) {
    throw new Error(`MCP server not found: ${mcpName}`)
  }

  if (!isMcpConfigured(mcpConfig)) {
    throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
  }

  if (mcpConfig.type !== "remote") {
    throw new Error(`MCP server ${mcpName} is not a remote server`)
  }

  if (mcpConfig.oauth === false) {
    throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
  }

  // Start the callback server
  await McpOAuthCallback.ensureRunning()

  // Generate and store a cryptographically secure state parameter BEFORE creating the provider
  // The SDK will call provider.state() to read this value
  const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  await McpAuth.updateOAuthState(mcpName, oauthState)

  // Create a new auth provider for this flow
  // OAuth config is optional - if not provided, we'll use auto-discovery
  const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
  let capturedUrl: URL | undefined
  const authProvider = new McpOAuthProvider(
    mcpName,
    mcpConfig.url,
    {
      clientId: oauthConfig?.clientId,
      clientSecret: oauthConfig?.clientSecret,
      scope: oauthConfig?.scope,
    },
    {
      onRedirect: async (url) => {
        capturedUrl = url
      },
    },
  )

  // Create transport with auth provider
  const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
    authProvider,
  })

  // Try to connect - this will trigger the OAuth flow
  try {
    const client = new Client({
      name: "librecode",
      version: Installation.VERSION,
    })
    await client.connect(transport)
    // If we get here, we're already authenticated
    return { authorizationUrl: "" }
  } catch (error) {
    if (error instanceof UnauthorizedError && capturedUrl) {
      // Store transport for finishAuth
      pendingOAuthTransports.set(mcpName, transport)
      return { authorizationUrl: capturedUrl.toString() }
    }
    throw error
  }
}

/**
 * Complete OAuth authentication after user authorizes in browser.
 * Opens the browser and waits for callback.
 */
async function authenticate(mcpName: string): Promise<MCP.Status> {
  const { authorizationUrl } = await startAuth(mcpName)

  if (!authorizationUrl) {
    // Already authenticated
    const s = await state()
    return s.status[mcpName] ?? { status: "connected" }
  }

  // Get the state that was already generated and stored in startAuth()
  const oauthState = await McpAuth.getOAuthState(mcpName)
  if (!oauthState) {
    throw new Error("OAuth state not found - this should not happen")
  }

  // The SDK has already added the state parameter to the authorization URL
  // We just need to open the browser
  log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

  // Register the callback BEFORE opening the browser to avoid race condition
  // when the IdP has an active SSO session and redirects immediately
  const callbackPromise = McpOAuthCallback.waitForCallback(oauthState)

  try {
    const subprocess = await open(authorizationUrl)
    // The open package spawns a detached process and returns immediately.
    // We need to listen for errors which fire asynchronously:
    // - "error" event: command not found (ENOENT)
    // - "exit" with non-zero code: command exists but failed (e.g., no display)
    await new Promise<void>((resolve, reject) => {
      // Give the process a moment to fail if it's going to
      const timeout = setTimeout(() => resolve(), 500)
      subprocess.on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      subprocess.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout)
          reject(new Error(`Browser open failed with exit code ${code}`))
        }
      })
    })
  } catch (error) {
    // Browser opening failed (e.g., in remote/headless sessions like SSH, devcontainers)
    // Emit event so CLI can display the URL for manual opening
    log.warn("failed to open browser, user must open URL manually", { mcpName, error })
    Bus.publish(BrowserOpenFailed, { mcpName, url: authorizationUrl })
  }

  // Wait for callback using the already-registered promise
  const code = await callbackPromise

  // Validate and clear the state
  const storedState = await McpAuth.getOAuthState(mcpName)
  if (storedState !== oauthState) {
    await McpAuth.clearOAuthState(mcpName)
    throw new Error("OAuth state mismatch - potential CSRF attack")
  }

  await McpAuth.clearOAuthState(mcpName)

  // Finish auth
  return finishAuth(mcpName, code)
}

/**
 * Complete OAuth authentication with the authorization code.
 */
async function finishAuth(mcpName: string, authorizationCode: string): Promise<MCP.Status> {
  const transport = pendingOAuthTransports.get(mcpName)

  if (!transport) {
    throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
  }

  try {
    // Call finishAuth on the transport
    await transport.finishAuth(authorizationCode)

    // Clear the code verifier after successful auth
    await McpAuth.clearCodeVerifier(mcpName)

    // Now try to reconnect
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]

    if (!mcpConfig) {
      throw new Error(`MCP server not found: ${mcpName}`)
    }

    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    // Re-add the MCP server to establish connection
    pendingOAuthTransports.delete(mcpName)
    const result = await add(mcpName, mcpConfig)

    const statusRecord = result.status as Record<string, MCP.Status>
    return statusRecord[mcpName] ?? { status: "failed", error: "Unknown error after auth" }
  } catch (error) {
    log.error("failed to finish oauth", { mcpName, error })
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Remove OAuth credentials for an MCP server.
 */
async function removeAuth(mcpName: string): Promise<void> {
  await McpAuth.remove(mcpName)
  McpOAuthCallback.cancelPending(mcpName)
  pendingOAuthTransports.delete(mcpName)
  await McpAuth.clearOAuthState(mcpName)
  log.info("removed oauth credentials", { mcpName })
}

/**
 * Check if an MCP server supports OAuth (remote servers support OAuth by default unless explicitly disabled).
 */
async function supportsOAuth(mcpName: string): Promise<boolean> {
  const cfg = await Config.get()
  const mcpConfig = cfg.mcp?.[mcpName]
  if (!mcpConfig) return false
  if (!isMcpConfigured(mcpConfig)) return false
  return mcpConfig.type === "remote" && mcpConfig.oauth !== false
}

/**
 * Check if an MCP server has stored OAuth tokens.
 */
async function hasStoredTokens(mcpName: string): Promise<boolean> {
  const entry = await McpAuth.get(mcpName)
  return !!entry?.tokens
}

/**
 * Get the authentication status for an MCP server.
 */
async function getAuthStatus(mcpName: string): Promise<MCP.AuthStatus> {
  const hasTokens = await hasStoredTokens(mcpName)
  if (!hasTokens) return "not_authenticated"
  const expired = await McpAuth.isTokenExpired(mcpName)
  return expired ? "expired" : "authenticated"
}

export const MCP = {
  Resource,
  ToolsChanged,
  BrowserOpenFailed,
  Failed,
  Status,
  add,
  status: mcpStatus,
  clients,
  connect,
  disconnect,
  tools,
  prompts,
  resources,
  getPrompt,
  readResource,
  startAuth,
  authenticate,
  finishAuth,
  removeAuth,
  supportsOAuth,
  hasStoredTokens,
  getAuthStatus,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace MCP {
  type Resource = z.infer<typeof Resource>
  type Status = z.infer<typeof Status>
  type AuthStatus = "authenticated" | "expired" | "not_authenticated"
}
