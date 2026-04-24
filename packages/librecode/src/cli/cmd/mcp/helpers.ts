import path from "node:path"
import * as prompts from "@clack/prompts"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import type { Config } from "../../../config/config"
import { Global } from "../../../global"
import { MCP } from "../../../mcp"
import { McpAuth } from "../../../mcp/auth"
import { Instance } from "../../../project/instance"
import { Filesystem } from "../../../util/filesystem"
import { UI } from "../../ui"

export function getAuthStatusIcon(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "✓"
    case "expired":
      return "⚠"
    case "not_authenticated":
      return "✗"
  }
}

export function getAuthStatusText(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "authenticated"
    case "expired":
      return "expired"
    case "not_authenticated":
      return "not authenticated"
  }
}

type McpEntry = NonNullable<Config.Info["mcp"]>[string]
export type McpConfigured = Config.Mcp
export type McpRemote = Extract<McpConfigured, { type: "remote" }>

export function isMcpConfigured(config: McpEntry): config is McpConfigured {
  return typeof config === "object" && config !== null && "type" in config
}

export function isMcpRemote(config: McpEntry): config is McpRemote {
  return isMcpConfigured(config) && config.type === "remote"
}

export async function resolveConfigPath(baseDir: string, global = false): Promise<string> {
  const candidates = [path.join(baseDir, "librecode.json"), path.join(baseDir, "librecode.jsonc")]
  if (!global) {
    candidates.push(
      path.join(baseDir, ".librecode", "librecode.json"),
      path.join(baseDir, ".librecode", "librecode.jsonc"),
    )
  }
  for (const candidate of candidates) {
    if (await Filesystem.exists(candidate)) return candidate
  }
  return candidates[0]
}

export async function addMcpToConfig(name: string, mcpConfig: Config.Mcp, configPath: string): Promise<string> {
  let text = "{}"
  if (await Filesystem.exists(configPath)) text = await Filesystem.readText(configPath)
  const edits = modify(text, ["mcp", name], mcpConfig, { formattingOptions: { tabSize: 2, insertSpaces: true } })
  await Filesystem.write(configPath, applyEdits(text, edits))
  return configPath
}

export async function selectOAuthServer(oauthServers: Array<[string, McpRemote]>, argName?: string): Promise<string> {
  if (argName) return argName
  const options = await Promise.all(
    oauthServers.map(async ([name, cfg]) => {
      const authStatus = await MCP.getAuthStatus(name)
      return {
        label: `${getAuthStatusIcon(authStatus)} ${name} (${getAuthStatusText(authStatus)})`,
        value: name,
        hint: cfg.url,
      }
    }),
  )
  const selected = await prompts.select({ message: "Select MCP server to authenticate", options })
  if (prompts.isCancel(selected)) throw new UI.CancelledError()
  return selected
}

export async function confirmReauthIfNeeded(serverName: string, authStatus: MCP.AuthStatus): Promise<boolean> {
  if (authStatus === "authenticated") {
    const confirm = await prompts.confirm({
      message: `${serverName} already has valid credentials. Re-authenticate?`,
    })
    if (prompts.isCancel(confirm) || !confirm) {
      prompts.outro("Cancelled")
      return false
    }
  } else if (authStatus === "expired") {
    prompts.log.warn(`${serverName} has expired credentials. Re-authenticating...`)
  }
  return true
}

export async function collectOAuthConfig(url: string): Promise<Config.Mcp> {
  const useOAuth = await prompts.confirm({
    message: "Does this server require OAuth authentication?",
    initialValue: false,
  })
  if (prompts.isCancel(useOAuth)) throw new UI.CancelledError()
  if (!useOAuth) return { type: "remote", url }

  const hasClientId = await prompts.confirm({ message: "Do you have a pre-registered client ID?", initialValue: false })
  if (prompts.isCancel(hasClientId)) throw new UI.CancelledError()
  if (!hasClientId) return { type: "remote", url, oauth: {} }

  const clientId = await prompts.text({
    message: "Enter client ID",
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })
  if (prompts.isCancel(clientId)) throw new UI.CancelledError()

  const hasSecret = await prompts.confirm({ message: "Do you have a client secret?", initialValue: false })
  if (prompts.isCancel(hasSecret)) throw new UI.CancelledError()
  if (!hasSecret) return { type: "remote", url, oauth: { clientId } }

  const secret = await prompts.password({ message: "Enter client secret" })
  if (prompts.isCancel(secret)) throw new UI.CancelledError()
  return { type: "remote", url, oauth: { clientId, clientSecret: secret } }
}

export async function resolveAddConfigPath(opts?: { preferProject?: boolean }): Promise<string> {
  const [projectConfigPath, globalConfigPath] = await Promise.all([
    resolveConfigPath(Instance.worktree),
    resolveConfigPath(Global.Path.config, true),
  ])
  const project = Instance.project
  if (project.vcs !== "git") return globalConfigPath
  // v0.9.73 — non-interactive paths (flag-driven CLI, REST endpoints)
  // need a deterministic default. Inside a git project we pick the
  // project config; outside we fall back to global. Callers that
  // want global explicitly can pass `--global` at the CLI layer.
  if (opts?.preferProject) return projectConfigPath
  const scopeResult = await prompts.select({
    message: "Location",
    options: [
      { label: "Current project", value: projectConfigPath, hint: projectConfigPath },
      { label: "Global", value: globalConfigPath, hint: globalConfigPath },
    ],
  })
  if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
  return scopeResult
}

/**
 * v0.9.73 — remove an MCP server entry from the config file at
 * `configPath`. Returns true if the entry existed and was removed,
 * false if the file didn't mention that name. Preserves comments via
 * jsonc-parser's `modify` + `applyEdits`. Never throws for a missing
 * name — idempotent by design so callers can safely re-run `remove`.
 */
export async function removeMcpFromConfig(name: string, configPath: string): Promise<boolean> {
  if (!(await Filesystem.exists(configPath))) return false
  const text = await Filesystem.readText(configPath)
  // Pass `undefined` to modify() to delete the key.
  const edits = modify(text, ["mcp", name], undefined, { formattingOptions: { tabSize: 2, insertSpaces: true } })
  if (edits.length === 0) return false
  await Filesystem.write(configPath, applyEdits(text, edits))
  return true
}

/**
 * v0.9.73 — toggle the `enabled` flag on a configured MCP server. If
 * the server isn't in the config at all, throws — enable/disable
 * semantically assumes the entry exists. For "add-if-missing"
 * behavior, use `addMcpToConfig` directly.
 *
 * jsonc-parser's `modify` happily creates missing intermediate keys,
 * which would silently convert a typo (`librecode mcp enable foo`
 * against a config that has `Foo`) into a new half-configured server.
 * Guard against that by parsing first and throwing on miss.
 */
export async function setMcpEnabled(name: string, enabled: boolean, configPath: string): Promise<void> {
  if (!(await Filesystem.exists(configPath))) {
    throw new Error(`Config file not found at ${configPath}`)
  }
  const text = await Filesystem.readText(configPath)
  const errors: JsoncParseErrorRecord[] = []
  const parsed = parseJsonc(text, errors) as { mcp?: Record<string, unknown> } | undefined
  if (!parsed || !parsed.mcp || !(name in parsed.mcp)) {
    throw new Error(`MCP server "${name}" not found in ${configPath}`)
  }
  const edits = modify(text, ["mcp", name, "enabled"], enabled, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  if (edits.length === 0) return // already in target state
  await Filesystem.write(configPath, applyEdits(text, edits))
}

// Minimal local type so we don't leak jsonc-parser's error union into
// the public surface.
type JsoncParseErrorRecord = { error: number; offset: number; length: number }

export async function printDebugTokenInfo(serverName: string): Promise<void> {
  const entry = await McpAuth.get(serverName)
  if (entry?.tokens) {
    prompts.log.info(`  Access token: present`)

    if (entry.tokens.expiresAt) {
      const expiresDate = new Date(entry.tokens.expiresAt * 1000)
      const isExpired = entry.tokens.expiresAt < Date.now() / 1000
      prompts.log.info(`  Expires: ${expiresDate.toISOString()} ${isExpired ? "(EXPIRED)" : ""}`)
    }
    if (entry.tokens.refreshToken) prompts.log.info("  Refresh token: present")
  }
  if (entry?.clientInfo) {
    prompts.log.info(`  Client ID: ${entry.clientInfo.clientId}`)
    if (entry.clientInfo.clientSecretExpiresAt) {
      prompts.log.info(
        `  Client secret expires: ${new Date(entry.clientInfo.clientSecretExpiresAt * 1000).toISOString()}`,
      )
    }
  }
}
