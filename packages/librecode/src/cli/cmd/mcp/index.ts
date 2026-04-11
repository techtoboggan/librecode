import { cmd } from "../cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import * as prompts from "@clack/prompts"
import { UI } from "../../ui"
import { MCP } from "../../../mcp"
import { McpAuth } from "../../../mcp/auth"
import { McpOAuthProvider } from "../../../mcp/oauth-provider"
import { Config } from "../../../config/config"
import { Instance } from "../../../project/instance"
import { Installation } from "../../../installation"
import { Bus } from "../../../bus"
import {
  isMcpConfigured,
  isMcpRemote,
  getAuthStatusIcon,
  getAuthStatusText,
  selectOAuthServer,
  confirmReauthIfNeeded,
  collectOAuthConfig,
  resolveAddConfigPath,
  addMcpToConfig,
  printDebugTokenInfo,
} from "./helpers"

export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpDebugCommand)
      .demandCommand(),
  async handler() {},
})

export const McpListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list MCP servers and their status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Servers")
        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const statuses = await MCP.status()
        const servers = Object.entries(mcpServers).filter((e): e is [string, Config.Mcp] => isMcpConfigured(e[1]))

        if (servers.length === 0) {
          prompts.log.warn("No MCP servers configured")
          prompts.outro("Add servers with: librecode mcp add")
          return
        }

        for (const [name, serverConfig] of servers) {
          prompts.log.info(buildServerStatusLine(name, serverConfig, statuses[name], await MCP.hasStoredTokens(name)))
        }
        prompts.outro(`${servers.length} server(s)`)
      },
    })
  },
})

function buildServerStatusLine(
  name: string,
  serverConfig: Config.Mcp,
  status: MCP.ServerStatus | undefined,
  hasStoredTokens: boolean,
): string {
  const hasOAuth = isMcpRemote(serverConfig) && !!serverConfig.oauth
  let statusIcon = "○"
  let statusText = "not initialized"
  let hint = ""

  if (status?.status === "connected") {
    statusIcon = "✓"
    statusText = "connected"
    if (hasOAuth && hasStoredTokens) hint = " (OAuth)"
  } else if (status?.status === "disabled") {
    statusIcon = "○"
    statusText = "disabled"
  } else if (status?.status === "needs_auth") {
    statusIcon = "⚠"
    statusText = "needs authentication"
  } else if (status?.status === "needs_client_registration") {
    statusIcon = "✗"
    statusText = "needs client registration"
    hint = "\n    " + status.error
  } else if (status?.status === "failed") {
    statusIcon = "✗"
    statusText = "failed"
    hint = "\n    " + (status as any).error
  }

  const typeHint = serverConfig.type === "remote" ? serverConfig.url : serverConfig.command.join(" ")
  return `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`
}

export const McpAuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list OAuth-capable MCP servers and their auth status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Status")
        const config = await Config.get()
        const oauthServers = Object.entries(config.mcp ?? {}).filter(
          (e): e is [string, Extract<Config.Mcp, { type: "remote" }>] => isMcpRemote(e[1]) && e[1].oauth !== false,
        )
        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-capable MCP servers configured")
          prompts.outro("Done")
          return
        }
        for (const [name, cfg] of oauthServers) {
          const authStatus = await MCP.getAuthStatus(name)
          prompts.log.info(
            `${getAuthStatusIcon(authStatus)} ${name} ${UI.Style.TEXT_DIM}${getAuthStatusText(authStatus)}\n    ${UI.Style.TEXT_DIM}${cfg.url}`,
          )
        }
        prompts.outro(`${oauthServers.length} OAuth-capable server(s)`)
      },
    })
  },
})

export const McpAuthCommand = cmd({
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",
  builder: (yargs) =>
    yargs.positional("name", { describe: "name of the MCP server", type: "string" }).command(McpAuthListCommand),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Authentication")
        const config = await Config.get()
        const oauthServers = Object.entries(config.mcp ?? {}).filter(
          (e): e is [string, Extract<Config.Mcp, { type: "remote" }>] => isMcpRemote(e[1]) && e[1].oauth !== false,
        )
        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-capable MCP servers configured")
          prompts.log.info('Add a remote server: "mcp": { "name": { "type": "remote", "url": "..." } }')
          prompts.outro("Done")
          return
        }
        const serverName = await selectOAuthServer(oauthServers, args.name)
        const serverConfig = config.mcp?.[serverName]
        if (!serverConfig || !isMcpRemote(serverConfig) || serverConfig.oauth === false) {
          prompts.log.error(`MCP server ${serverName} is not an OAuth-capable remote server`)
          prompts.outro("Done")
          return
        }
        const authStatus = await MCP.getAuthStatus(serverName)
        if (!(await confirmReauthIfNeeded(serverName, authStatus))) return
        await performOAuthFlow(serverName, serverConfig.url)
        prompts.outro("Done")
      },
    })
  },
})

async function performOAuthFlow(serverName: string, serverUrl: string): Promise<void> {
  const spinner = prompts.spinner()
  spinner.start("Starting OAuth flow...")
  const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
    if (evt.properties.mcpName === serverName) {
      spinner.stop("Could not open browser automatically")
      prompts.log.warn("Please open this URL in your browser to authenticate:")
      prompts.log.info(evt.properties.url)
      spinner.start("Waiting for authorization...")
    }
  })
  try {
    const status = await MCP.authenticate(serverName)
    reportAuthStatus(status, serverName, serverUrl, spinner)
  } catch (error) {
    spinner.stop("Authentication failed", 1)
    prompts.log.error(error instanceof Error ? error.message : String(error))
  } finally {
    unsubscribe()
  }
}

function reportAuthStatus(
  status: Awaited<ReturnType<typeof MCP.authenticate>>,
  serverName: string,
  serverUrl: string,
  spinner: ReturnType<typeof prompts.spinner>,
): void {
  if (status.status === "connected") {
    spinner.stop("Authentication successful!")
  } else if (status.status === "needs_client_registration") {
    spinner.stop("Authentication failed", 1)
    prompts.log.error(status.error)
    prompts.log.info(`Add clientId to your MCP server config for "${serverName}" at ${serverUrl}`)
  } else if (status.status === "failed") {
    spinner.stop("Authentication failed", 1)
    prompts.log.error(status.error)
  } else {
    spinner.stop("Unexpected status: " + status.status, 1)
  }
}

export const McpLogoutCommand = cmd({
  command: "logout [name]",
  describe: "remove OAuth credentials for an MCP server",
  builder: (yargs) => yargs.positional("name", { describe: "name of the MCP server", type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Logout")
        const credentials = await McpAuth.all()
        const serverNames = Object.keys(credentials)
        if (serverNames.length === 0) {
          prompts.log.warn("No MCP OAuth credentials stored")
          prompts.outro("Done")
          return
        }
        const serverName = args.name ?? (await selectLogoutServer(serverNames, credentials))
        if (!credentials[serverName]) {
          prompts.log.error(`No credentials found for: ${serverName}`)
          prompts.outro("Done")
          return
        }
        await MCP.removeAuth(serverName)
        prompts.log.success(`Removed OAuth credentials for ${serverName}`)
        prompts.outro("Done")
      },
    })
  },
})

async function selectLogoutServer(
  serverNames: string[],
  credentials: Awaited<ReturnType<typeof McpAuth.all>>,
): Promise<string> {
  const selected = await prompts.select({
    message: "Select MCP server to logout",
    options: serverNames.map((name) => {
      const entry = credentials[name]
      const parts = [entry.tokens ? "tokens" : "", entry.clientInfo ? "client" : ""].filter(Boolean)
      return { label: name, value: name, hint: parts.join(" + ") || undefined }
    }),
  })
  if (prompts.isCancel(selected)) throw new UI.CancelledError()
  return selected
}

export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add MCP server")
        const configPath = await resolveAddConfigPath()

        const name = await prompts.text({
          message: "Enter MCP server name",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(name)) throw new UI.CancelledError()

        const type = await prompts.select({
          message: "Select MCP server type",
          options: [
            { label: "Local", value: "local", hint: "Run a local command" },
            { label: "Remote", value: "remote", hint: "Connect to a remote URL" },
          ],
        })
        if (prompts.isCancel(type)) throw new UI.CancelledError()

        if (type === "local") {
          const command = await prompts.text({
            message: "Enter command to run",
            placeholder: "e.g., librecode x @modelcontextprotocol/server-filesystem",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(command)) throw new UI.CancelledError()
          await addMcpToConfig(name, { type: "local", command: command.split(" ") }, configPath)
          prompts.log.success(`MCP server "${name}" added to ${configPath}`)
          prompts.outro("MCP server added successfully")
          return
        }

        const url = await prompts.text({
          message: "Enter MCP server URL",
          placeholder: "e.g., https://example.com/mcp",
          validate: (x) => (!x || x.length === 0 ? "Required" : !URL.canParse(x) ? "Invalid URL" : undefined),
        })
        if (prompts.isCancel(url)) throw new UI.CancelledError()

        const mcpConfig = await collectOAuthConfig(url)
        await addMcpToConfig(name, mcpConfig, configPath)
        prompts.log.success(`MCP server "${name}" added to ${configPath}`)
        prompts.outro("MCP server added successfully")
      },
    })
  },
})

export const McpDebugCommand = cmd({
  command: "debug <name>",
  describe: "debug OAuth connection for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", { describe: "name of the MCP server", type: "string", demandOption: true }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Debug")
        const config = await Config.get()
        const serverName = args.name
        const serverConfig = config.mcp?.[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }
        if (!isMcpRemote(serverConfig)) {
          prompts.log.error(`MCP server ${serverName} is not a remote server`)
          prompts.outro("Done")
          return
        }
        if (serverConfig.oauth === false) {
          prompts.log.warn(`MCP server ${serverName} has OAuth explicitly disabled`)
          prompts.outro("Done")
          return
        }

        prompts.log.info(`Server: ${serverName}`)
        prompts.log.info(`URL: ${serverConfig.url}`)
        const authStatus = await MCP.getAuthStatus(serverName)
        prompts.log.info(`Auth status: ${getAuthStatusIcon(authStatus)} ${getAuthStatusText(authStatus)}`)
        await printDebugTokenInfo(serverName)

        const spinner = prompts.spinner()
        spinner.start("Testing connection...")
        try {
          await debugHttpProbe(serverConfig, serverName, spinner)
        } catch (error) {
          spinner.stop("Connection failed", 1)
          prompts.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }
        prompts.outro("Debug complete")
      },
    })
  },
})

async function debugHttpProbe(
  serverConfig: Extract<Config.Mcp, { type: "remote" }>,
  serverName: string,
  spinner: ReturnType<typeof prompts.spinner>,
): Promise<void> {
  const response = await fetch(serverConfig.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "librecode-debug", version: Installation.VERSION },
      },
      id: 1,
    }),
  })
  spinner.stop(`HTTP response: ${response.status} ${response.statusText}`)
  const wwwAuth = response.headers.get("www-authenticate")
  if (wwwAuth) prompts.log.info(`WWW-Authenticate: ${wwwAuth}`)

  if (response.status === 401) {
    await handleUnauthorizedDebug(serverConfig, serverName)
  } else if (response.status >= 200 && response.status < 300) {
    await handleSuccessDebug(response)
  } else {
    prompts.log.warn(`Unexpected status: ${response.status}`)
    const body = await response.text().catch(() => "")
    if (body) prompts.log.info(`Response body: ${body.substring(0, 500)}`)
  }
}

async function handleUnauthorizedDebug(
  serverConfig: Extract<Config.Mcp, { type: "remote" }>,
  serverName: string,
): Promise<void> {
  prompts.log.warn("Server returned 401 Unauthorized")
  const oauthConfig = typeof serverConfig.oauth === "object" ? serverConfig.oauth : undefined
  const authProvider = new McpOAuthProvider(
    serverName,
    serverConfig.url,
    { clientId: oauthConfig?.clientId, clientSecret: oauthConfig?.clientSecret, scope: oauthConfig?.scope },
    { onRedirect: async () => {} },
  )
  prompts.log.info("Testing OAuth flow (without completing authorization)...")
  const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), { authProvider })
  try {
    const client = new Client({ name: "librecode-debug", version: Installation.VERSION })
    await client.connect(transport)
    prompts.log.success("Connection successful (already authenticated)")
    await client.close()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      prompts.log.info(`OAuth flow triggered: ${error.message}`)
      const clientInfo = await authProvider.clientInformation()
      prompts.log.info(
        clientInfo
          ? `Client ID available: ${clientInfo.client_id}`
          : "No client ID - dynamic registration will be attempted",
      )
    } else {
      prompts.log.error(`Connection error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function handleSuccessDebug(response: Response): Promise<void> {
  prompts.log.success("Server responded successfully (no auth required or already authenticated)")
  const body = await response.text()
  try {
    const json = JSON.parse(body)
    if (json.result?.serverInfo) prompts.log.info(`Server info: ${JSON.stringify(json.result.serverInfo)}`)
  } catch {
    /* not JSON */
  }
}
