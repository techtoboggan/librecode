import { Log } from "../util/log"
import path from "path"
import { pathToFileURL } from "url"
import { mergeDeep, unique } from "remeda"
import { NamedError } from "@librecode/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance } from "../project/instance"
import { Bus } from "@/bus"
import { Glob } from "../util/glob"
import { Account } from "@/account"
import { ConfigPaths } from "./paths"
import { ConfigMarkdown } from "./markdown"
import { existsSync } from "fs"
import { iife } from "@/util/iife"
import type { Info, Agent, Command, PermissionAction } from "./schema"

const log = Log.create({ service: "config" })

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

export function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source)
  if (target.plugin && source.plugin) {
    merged.plugin = Array.from(new Set([...target.plugin, ...source.plugin]))
  }
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

// ---------------------------------------------------------------------------
// Utility helpers used by directory loaders
// ---------------------------------------------------------------------------

function rel(item: string, patterns: string[]): string | undefined {
  const normalizedItem = item.replaceAll("\\", "/")
  for (const pattern of patterns) {
    const index = normalizedItem.indexOf(pattern)
    if (index === -1) continue
    return normalizedItem.slice(index + pattern.length)
  }
}

function trim(file: string): string {
  const ext = path.extname(file)
  return ext.length ? file.slice(0, -ext.length) : file
}

// ---------------------------------------------------------------------------
// Directory-level loaders
// ---------------------------------------------------------------------------

export async function loadCommand(
  dir: string,
  InvalidError: typeof ConfigPaths.InvalidError,
): Promise<Record<string, Command>> {
  const result: Record<string, Command> = {}
  for (const item of await Glob.scan("{command,commands}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse command ${item}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load command", { command: item, err })
      return undefined
    })
    if (!md) continue

    const patterns = ["/.librecode/command/", "/.librecode/commands/", "/command/", "/commands/"]
    const file = rel(item, patterns) ?? path.basename(item)
    const name = trim(file)

    const { Command } = await import("./schema")
    const config = {
      name,
      ...md.data,
      template: md.content.trim(),
    }
    const parsed = Command.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
  }
  return result
}

export async function loadAgent(
  dir: string,
  InvalidError: typeof ConfigPaths.InvalidError,
): Promise<Record<string, Agent>> {
  const result: Record<string, Agent> = {}

  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse agent ${item}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load agent", { agent: item, err })
      return undefined
    })
    if (!md) continue

    const patterns = ["/.librecode/agent/", "/.librecode/agents/", "/agent/", "/agents/"]
    const file = rel(item, patterns) ?? path.basename(item)
    const agentName = trim(file)

    const { Agent } = await import("./schema")
    const config = {
      name: agentName,
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Agent.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
  }
  return result
}

export async function loadMode(
  dir: string,
): Promise<Record<string, Agent>> {
  const result: Record<string, Agent> = {}
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse mode ${item}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load mode", { mode: item, err })
      return undefined
    })
    if (!md) continue

    const { Agent } = await import("./schema")
    const config = {
      name: path.basename(item, ".md"),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Agent.safeParse(config)
    if (parsed.success) {
      result[config.name] = {
        ...parsed.data,
        mode: "primary" as const,
      }
    }
  }
  return result
}

export async function loadPlugin(dir: string): Promise<string[]> {
  const plugins: string[] = []

  for (const item of await Glob.scan("{plugin,plugins}/*.{ts,js}", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    plugins.push(pathToFileURL(item).href)
  }
  return plugins
}

// ---------------------------------------------------------------------------
// Config source loaders — each loads one layer of the config precedence stack
// ---------------------------------------------------------------------------

export async function loadWellKnownConfigs(
  auth: Awaited<ReturnType<typeof Auth.all>>,
  result: Info,
  loadFn: (text: string, options: { dir: string; source: string }) => Promise<Info>,
): Promise<Info> {
  for (const [key, value] of Object.entries(auth)) {
    if (value.type !== "wellknown") continue
    const url = key.replace(/\/+$/, "")
    process.env[value.key] = value.token
    log.debug("fetching remote config", { url: `${url}/.well-known/librecode` })
    const response = await fetch(`${url}/.well-known/librecode`)
    if (!response.ok) {
      throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
    }
    const wellknown = (await response.json()) as Record<string, unknown>
    const remoteConfig = (wellknown.config ?? {}) as Record<string, unknown>
    if (!remoteConfig.$schema) remoteConfig.$schema = "https://github.com/techtoboggan/librecode/config.json"
    result = mergeConfigConcatArrays(
      result,
      await loadFn(JSON.stringify(remoteConfig), {
        dir: path.dirname(`${url}/.well-known/librecode`),
        source: `${url}/.well-known/librecode`,
      }),
    )
    log.debug("loaded remote config from well-known", { url })
  }
  return result
}

export async function loadProjectFileConfigs(
  result: Info,
  loadFileFn: (file: string) => Promise<Info>,
): Promise<Info> {
  if (!Flag.LIBRECODE_DISABLE_PROJECT_CONFIG) {
    for (const file of await ConfigPaths.projectFiles("librecode", Instance.directory, Instance.worktree)) {
      result = mergeConfigConcatArrays(result, await loadFileFn(file))
    }
  }
  return result
}

export async function loadLibrecodeDirConfigs(
  directories: string[],
  result: Info,
  loadFileFn: (file: string) => Promise<Info>,
  installDependenciesFn: (dir: string) => Promise<void>,
  needsInstallFn: (dir: string) => Promise<boolean>,
  InvalidError: typeof ConfigPaths.InvalidError,
): Promise<{ result: Info; deps: Promise<void>[] }> {
  if (Flag.LIBRECODE_CONFIG_DIR) {
    log.debug("loading config from LIBRECODE_CONFIG_DIR", { path: Flag.LIBRECODE_CONFIG_DIR })
  }
  // Ensure required sub-objects are initialized before iterating
  result.agent ??= {}
  result.mode ??= {}
  result.plugin ??= []

  const deps: Promise<void>[] = []
  for (const dir of unique(directories)) {
    if (dir.endsWith(".librecode") || dir === Flag.LIBRECODE_CONFIG_DIR) {
      for (const file of ["librecode.jsonc", "librecode.json"]) {
        log.debug(`loading config from ${path.join(dir, file)}`)
        result = mergeConfigConcatArrays(result, await loadFileFn(path.join(dir, file)))
        result.agent ??= {}
        result.mode ??= {}
        result.plugin ??= []
      }
    }
    deps.push(
      iife(async () => {
        const shouldInstall = await needsInstallFn(dir)
        if (shouldInstall) await installDependenciesFn(dir)
      }),
    )
    result.command = mergeDeep(result.command ?? {}, await loadCommand(dir, InvalidError))
    result.agent = mergeDeep(result.agent ?? {}, await loadAgent(dir, InvalidError))
    result.agent = mergeDeep(result.agent ?? {}, await loadMode(dir))
    result.plugin!.push(...(await loadPlugin(dir)))
  }
  return { result, deps }
}

export async function loadInlineConfig(
  result: Info,
  loadFn: (text: string, options: { dir: string; source: string }) => Promise<Info>,
): Promise<Info> {
  if (!process.env.LIBRECODE_CONFIG_CONTENT) return result
  result = mergeConfigConcatArrays(
    result,
    await loadFn(process.env.LIBRECODE_CONFIG_CONTENT, {
      dir: Instance.directory,
      source: "LIBRECODE_CONFIG_CONTENT",
    }),
  )
  log.debug("loaded custom config from LIBRECODE_CONFIG_CONTENT")
  return result
}

export async function loadAccountConfig(
  result: Info,
  loadFn: (text: string, options: { dir: string; source: string }) => Promise<Info>,
): Promise<Info> {
  const active = Account.active()
  if (!active?.active_org_id) return result
  try {
    const [config, token] = await Promise.all([
      Account.config(active.id, active.active_org_id),
      Account.token(active.id),
    ])
    if (token) {
      process.env["LIBRECODE_CONSOLE_TOKEN"] = token
      Env.set("LIBRECODE_CONSOLE_TOKEN", token)
    }
    if (config) {
      result = mergeConfigConcatArrays(
        result,
        await loadFn(JSON.stringify(config), {
          dir: path.dirname(`${active.url}/api/config`),
          source: `${active.url}/api/config`,
        }),
      )
    }
  } catch (err: unknown) {
    log.debug("failed to fetch remote account config", { error: err instanceof Error ? err.message : err })
  }
  return result
}

export async function loadManagedConfig(
  result: Info,
  managedDir: string,
  loadFileFn: (file: string) => Promise<Info>,
): Promise<Info> {
  // Load managed config files last (highest priority) - enterprise admin-controlled
  // Kept separate from directories array to avoid write operations when installing plugins
  // which would fail on system directories requiring elevated permissions
  // This way it only loads config file and not skills/plugins/commands
  if (!existsSync(managedDir)) return result
  for (const file of ["librecode.jsonc", "librecode.json"]) {
    result = mergeConfigConcatArrays(result, await loadFileFn(path.join(managedDir, file)))
  }
  return result
}

// ---------------------------------------------------------------------------
// Legacy migration helpers
// ---------------------------------------------------------------------------

export function migrateModesToAgents(result: Info): void {
  for (const [name, mode] of Object.entries(result.mode ?? {})) {
    result.agent = mergeDeep(result.agent ?? {}, { [name]: { ...mode, mode: "primary" as const } })
  }
}

export function applyLegacyToolsPermissions(result: Info): void {
  if (!result.tools) return
  const perms: Record<string, PermissionAction> = {}
  for (const [tool, enabled] of Object.entries(result.tools)) {
    const action: PermissionAction = enabled ? "allow" : "deny"
    if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
      perms.edit = action
    } else {
      perms[tool] = action
    }
  }
  result.permission = mergeDeep(perms, result.permission ?? {})
}
