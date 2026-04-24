import * as prompts from "@clack/prompts"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Bus } from "../../../bus"
import { Config } from "../../../config/config"
import { Installation } from "../../../installation"
import { MCP } from "../../../mcp"
import { McpAuth } from "../../../mcp/auth"
import { McpOAuthProvider } from "../../../mcp/oauth-provider"
import { Instance } from "../../../project/instance"
import { UI } from "../../ui"
import { cmd } from "../cmd"
import {
  addMcpToConfig,
  collectOAuthConfig,
  confirmReauthIfNeeded,
  getAuthStatusIcon,
  getAuthStatusText,
  isMcpConfigured,
  isMcpRemote,
  printDebugTokenInfo,
  removeMcpFromConfig,
  resolveAddConfigPath,
  selectOAuthServer,
  setMcpEnabled,
} from "./helpers"

export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpRemoveCommand)
      .command(McpEnableCommand)
      .command(McpDisableCommand)
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
  status: MCP.Status | undefined,
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
    hint = `\n    ${status.error}`
  } else if (status?.status === "failed") {
    statusIcon = "✗"
    statusText = "failed"
    hint = `\n    ${(status as { error: string }).error}`
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
    spinner.stop(`Unexpected status: ${status.status}`, 1)
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
  command: "add [name]",
  describe: "add an MCP server",
  // v0.9.73 — add flag-driven non-interactive mode so upstream tools
  // (e.g. openwebgoggles's `init librecode` target) can shell out to
  // `librecode mcp add <name> --local <cmd>` without TTY prompts.
  // Passing a name positionally + any of `--local` / `--remote` skips
  // the whole prompt flow.
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "MCP server name (unique key). Omit to run interactively.",
      })
      .option("local", {
        type: "string",
        describe: "Local command to run (non-interactive). Quote to pass args in one token.",
      })
      .option("remote", {
        type: "string",
        describe: "Remote server URL (non-interactive).",
      })
      .option("oauth", {
        type: "boolean",
        default: false,
        describe: "Enable OAuth for the remote server (used with --remote).",
      })
      .option("client-id", { type: "string", describe: "OAuth client ID (used with --oauth)." })
      .option("client-secret", { type: "string", describe: "OAuth client secret (used with --oauth)." })
      .option("header", {
        type: "array",
        string: true,
        describe: "HTTP header for remote server, KEY=VALUE. Repeatable.",
      })
      .option("disabled", {
        type: "boolean",
        default: false,
        describe: "Add but leave disabled so it doesn't auto-connect.",
      })
      .option("global", {
        type: "boolean",
        describe: "Write to the global config. Defaults to project config inside a git repo, global otherwise.",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Emit a JSON result instead of the prompts chrome. For scripting.",
      })
      .check((argv) => {
        if (argv.local && argv.remote) throw new Error("--local and --remote are mutually exclusive.")
        if (argv.name && !argv.local && !argv.remote) {
          // Positional name without a flag — let the prompt flow handle it
          return true
        }
        return true
      }),
  async handler(argv) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const nonInteractive = Boolean(argv.local || argv.remote)
        if (nonInteractive) {
          return runAddNonInteractive(argv)
        }
        await runAddInteractive(argv.name as string | undefined)
      },
    })
  },
})

async function runAddNonInteractive(argv: {
  name?: string
  local?: string
  remote?: string
  oauth?: boolean
  "client-id"?: string
  "client-secret"?: string
  header?: string[]
  disabled?: boolean
  global?: boolean
  json?: boolean
}): Promise<void> {
  const name = argv.name
  if (!name) {
    throw new Error("MCP server name is required as a positional argument when using --local or --remote.")
  }
  const configPath = argv.global ? await resolveGlobalConfigPath() : await resolveAddConfigPath({ preferProject: true })

  const mcpConfig = argv.local
    ? buildLocalConfig(argv.local, argv.disabled)
    : buildRemoteConfig(argv.remote!, {
        oauth: argv.oauth,
        clientId: argv["client-id"],
        clientSecret: argv["client-secret"],
        headers: argv.header,
        disabled: argv.disabled,
      })

  await addMcpToConfig(name, mcpConfig, configPath)
  if (argv.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, name, path: configPath, config: mcpConfig })}\n`)
    return
  }
  UI.println(`added MCP server "${name}" to ${configPath}`)
}

async function runAddInteractive(prefilledName?: string): Promise<void> {
  UI.empty()
  prompts.intro("Add MCP server")
  const configPath = await resolveAddConfigPath()

  const name =
    prefilledName ??
    (await prompts.text({
      message: "Enter MCP server name",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    }))
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
}

/**
 * Parse the `--local <string>` flag into a local MCP config. Splits on
 * whitespace so `--local "bun x @foo/mcp"` produces `["bun", "x", "@foo/mcp"]`.
 * Exported-shape (pure) so tests can hit it without spinning up yargs.
 */
export function buildLocalConfig(command: string, disabled?: boolean): Config.Mcp {
  const parts = command
    .trim()
    .split(/\s+/)
    .filter((x) => x.length > 0)
  if (parts.length === 0) throw new Error("--local command cannot be empty.")
  const out: Config.Mcp = { type: "local", command: parts }
  if (disabled) (out as { enabled?: boolean }).enabled = false
  return out
}

/** Parse the `--remote <url>` + OAuth / headers flags into a remote MCP config. */
export function buildRemoteConfig(
  url: string,
  opts: { oauth?: boolean; clientId?: string; clientSecret?: string; headers?: string[]; disabled?: boolean },
): Config.Mcp {
  if (!URL.canParse(url)) throw new Error(`--remote URL is not a valid URL: ${url}`)
  const cfg: Record<string, unknown> = { type: "remote", url }
  if (opts.headers?.length) {
    const parsed: Record<string, string> = {}
    for (const h of opts.headers) {
      const idx = h.indexOf("=")
      if (idx <= 0) throw new Error(`--header must be KEY=VALUE, got: ${h}`)
      parsed[h.slice(0, idx)] = h.slice(idx + 1)
    }
    cfg.headers = parsed
  }
  if (opts.oauth) {
    const oauth: Record<string, string> = {}
    if (opts.clientId) oauth.clientId = opts.clientId
    if (opts.clientSecret) oauth.clientSecret = opts.clientSecret
    cfg.oauth = oauth
  }
  if (opts.disabled) cfg.enabled = false
  return cfg as Config.Mcp
}

async function resolveGlobalConfigPath(): Promise<string> {
  const { Global } = await import("../../../global")
  const { resolveConfigPath } = await import("./helpers")
  return resolveConfigPath(Global.Path.config, true)
}

export const McpRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove an MCP server from the config",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "MCP server name to remove",
      })
      .option("global", {
        type: "boolean",
        describe: "Write to the global config. Defaults to project config inside a git repo, global otherwise.",
      })
      .option("json", { type: "boolean", default: false }),
  async handler(argv) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const configPath = argv.global
          ? await resolveGlobalConfigPath()
          : await resolveAddConfigPath({ preferProject: true })
        const removed = await removeMcpFromConfig(argv.name as string, configPath)
        if (argv.json) {
          process.stdout.write(`${JSON.stringify({ ok: true, name: argv.name, path: configPath, removed })}\n`)
          return
        }
        if (removed) UI.println(`removed MCP server "${argv.name}" from ${configPath}`)
        else UI.println(`no MCP server "${argv.name}" in ${configPath} — nothing to remove`)
      },
    })
  },
})

export const McpEnableCommand = cmd({
  command: "enable <name>",
  describe: "enable a previously-disabled MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", { type: "string", demandOption: true })
      .option("global", { type: "boolean" })
      .option("json", { type: "boolean", default: false }),
  async handler(argv) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const configPath = argv.global
          ? await resolveGlobalConfigPath()
          : await resolveAddConfigPath({ preferProject: true })
        await setMcpEnabled(argv.name as string, true, configPath)
        if (argv.json) {
          process.stdout.write(`${JSON.stringify({ ok: true, name: argv.name, enabled: true, path: configPath })}\n`)
          return
        }
        UI.println(`enabled MCP server "${argv.name}" in ${configPath}`)
      },
    })
  },
})

export const McpDisableCommand = cmd({
  command: "disable <name>",
  describe: "disable an MCP server without removing it",
  builder: (yargs) =>
    yargs
      .positional("name", { type: "string", demandOption: true })
      .option("global", { type: "boolean" })
      .option("json", { type: "boolean", default: false }),
  async handler(argv) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const configPath = argv.global
          ? await resolveGlobalConfigPath()
          : await resolveAddConfigPath({ preferProject: true })
        await setMcpEnabled(argv.name as string, false, configPath)
        if (argv.json) {
          process.stdout.write(`${JSON.stringify({ ok: true, name: argv.name, enabled: false, path: configPath })}\n`)
          return
        }
        UI.println(`disabled MCP server "${argv.name}" in ${configPath}`)
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
