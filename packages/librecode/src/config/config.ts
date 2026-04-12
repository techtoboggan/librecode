import { constants, existsSync } from "node:fs"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { NamedError } from "@librecode/util/error"
import {
  applyEdits,
  type ParseError as JsoncParseError,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { mergeDeep, pipe } from "remeda"
import z from "zod"
import { BunProc } from "@/bun"
import { PackageRegistry } from "@/bun/registry"
import { GlobalBus } from "@/bus/global"
import { Installation } from "@/installation"
import { Filesystem } from "@/util/filesystem"
import { Lock } from "@/util/lock"
import { Process } from "@/util/process"
import { proxied } from "@/util/proxied"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Event } from "../server/event"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { ConfigPaths } from "./paths"
import {
  Agent as _Agent,
  Command as _Command,
  Info as _Info,
  Keybinds as _Keybinds,
  Layout as _Layout,
  Mcp as _Mcp,
  McpLocal as _McpLocal,
  McpOAuth as _McpOAuth,
  McpRemote as _McpRemote,
  Permission as _Permission,
  PermissionAction as _PermissionAction,
  PermissionObject as _PermissionObject,
  PermissionRule as _PermissionRule,
  Provider as _Provider,
  Server as _Server,
  Skills as _Skills,
  type Agent as AgentType,
  type Command as CommandType,
  type Info as InfoType,
  type Layout as LayoutType,
  type McpOAuth as McpOAuthType,
  type Mcp as McpType,
  type PermissionAction as PermissionActionType,
  type PermissionObject as PermissionObjectType,
  type PermissionRule as PermissionRuleType,
  type Permission as PermissionType,
  type Provider as ProviderType,
  type Skills as SkillsType,
} from "./schema"
import {
  applyLegacyToolsPermissions,
  loadAccountConfig,
  loadInlineConfig,
  loadLibrecodeDirConfigs,
  loadManagedConfig,
  loadProjectFileConfigs,
  loadWellKnownConfigs,
  mergeConfigConcatArrays,
  migrateModesToAgents,
} from "./sources"

// ---------------------------------------------------------------------------
// Module-level private state
// ---------------------------------------------------------------------------

const log = Log.create({ service: "config" })

// Re-export readFile from ConfigPaths — declared early so loadFile can use it
const { readFile: configReadFile } = ConfigPaths

// ---------------------------------------------------------------------------
// Managed config directory helpers
// ---------------------------------------------------------------------------

function systemManagedConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/librecode"
    case "win32":
      return path.join(process.env.ProgramData || "C:\\ProgramData", "librecode")
    default:
      return "/etc/librecode"
  }
}

function managedConfigDir(): string {
  return process.env.LIBRECODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
}

const managedDir = managedConfigDir()

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

function applyLegacyMigrations(result: InfoType): InfoType {
  migrateModesToAgents(result)

  if (Flag.LIBRECODE_PERMISSION) {
    result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.LIBRECODE_PERMISSION))
  }

  applyLegacyToolsPermissions(result)

  if (!result.username) result.username = os.userInfo().username
  if (result.autoshare === true && !result.share) result.share = "auto"
  if (Flag.LIBRECODE_DISABLE_AUTOCOMPACT) result.compaction = { ...result.compaction, auto: false }
  if (Flag.LIBRECODE_DISABLE_PRUNE) result.compaction = { ...result.compaction, prune: false }

  return result
}

// ---------------------------------------------------------------------------
// Error types (declared early — used by loaders below)
// ---------------------------------------------------------------------------

const { JsonError: configJsonError, InvalidError: configInvalidError } = ConfigPaths

const ConfigDirectoryTypoError = NamedError.create(
  "ConfigDirectoryTypoError",
  z.object({
    path: z.string(),
    dir: z.string(),
    suggestion: z.string(),
  }),
)

// ---------------------------------------------------------------------------
// File / text loaders (internal helpers used by state and sources)
// ---------------------------------------------------------------------------

async function loadFile(filepath: string): Promise<InfoType> {
  log.info("loading", { path: filepath })
  const text = await configReadFile(filepath)
  if (!text) return {}
  return loadFromText(text, { path: filepath })
}

function normalizeConfigData(data: unknown, source: string): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data
  const copy = { ...(data as Record<string, unknown>) }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  log.warn("tui keys in librecode config are deprecated; move them to tui.json", { path: source })
  return copy
}

function resolvePluginSpecifier(plugin: string, filePath: string): string {
  try {
    return import.meta.resolve?.(plugin, filePath)
  } catch {
    try {
      // import.meta.resolve sometimes fails with newly created node_modules
      const require = createRequire(filePath)
      const resolvedPath = require.resolve(plugin)
      return pathToFileURL(resolvedPath).href
    } catch {
      // Ignore — plugin might be a generic string identifier like "mcp-server"
      return plugin
    }
  }
}

function resolvePluginPaths(data: InfoType, filePath: string): void {
  if (!data.plugin) return
  for (let i = 0; i < data.plugin.length; i++) {
    data.plugin[i] = resolvePluginSpecifier(data.plugin[i], filePath)
  }
}

async function loadFromText(
  text: string,
  options: { path: string } | { dir: string; source: string },
): Promise<InfoType> {
  const original = text
  const source = "path" in options ? options.path : options.source
  const isFile = "path" in options
  const raw = await ConfigPaths.parseText(
    text,
    "path" in options ? options.path : { source: options.source, dir: options.dir },
  )

  const normalized = normalizeConfigData(raw, source)
  const parsed = _Info.safeParse(normalized)
  if (parsed.success) {
    if (!parsed.data.$schema && isFile) {
      parsed.data.$schema = "https://github.com/techtoboggan/librecode/config.json"
      const updated = original.replace(
        /^\s*\{/,
        '{\n  "$schema": "https://github.com/techtoboggan/librecode/config.json",',
      )
      await Filesystem.write(options.path, updated).catch(() => {})
    }
    const data = parsed.data
    if (data.plugin && isFile) {
      resolvePluginPaths(data, options.path)
    }
    return data
  }

  throw new configInvalidError({
    path: source,
    issues: parsed.error.issues,
  })
}

// ---------------------------------------------------------------------------
// Global config loader
// ---------------------------------------------------------------------------

const configGlobal = lazy(async () => {
  let result: InfoType = pipe(
    {},
    mergeDeep(await loadFile(path.join(Global.Path.config, "config.json"))),
    mergeDeep(await loadFile(path.join(Global.Path.config, "librecode.json"))),
    mergeDeep(await loadFile(path.join(Global.Path.config, "librecode.jsonc"))),
  )

  const legacy = path.join(Global.Path.config, "config")
  if (existsSync(legacy)) {
    await import(pathToFileURL(legacy).href, {
      with: {
        type: "toml",
      },
    })
      .then(async (mod) => {
        const { provider, model, ...rest } = mod.default
        if (provider && model) result.model = `${provider}/${model}`
        result.$schema = "https://github.com/techtoboggan/librecode/config.json"
        result = mergeDeep(result, rest)
        await Filesystem.writeJson(path.join(Global.Path.config, "config.json"), result)
        await fs.unlink(legacy)
      })
      .catch(() => {})
  }

  return result
})

// ---------------------------------------------------------------------------
// State — orchestrates all config sources
// ---------------------------------------------------------------------------

const configState = Instance.state(async () => {
  // Config loading order (low -> high precedence): https://github.com/techtoboggan/librecode/docs/config#precedence-order
  // 1) Remote .well-known/librecode (org defaults)
  // 2) Global config (~/.config/librecode/librecode.json{,c})
  // 3) Custom config (LIBRECODE_CONFIG)
  // 4) Project config (librecode.json{,c})
  // 5) .librecode directories (.librecode/agents/, .librecode/commands/, .librecode/plugins/, .librecode/librecode.json{,c})
  // 6) Inline config (LIBRECODE_CONFIG_CONTENT)
  // Managed config directory is enterprise-only and always overrides everything above.
  const auth = await Auth.all()
  let result: InfoType = {}

  result = await loadWellKnownConfigs(auth, result, loadFromText)
  result = mergeConfigConcatArrays(result, await configGlobal())

  if (Flag.LIBRECODE_CONFIG) {
    result = mergeConfigConcatArrays(result, await loadFile(Flag.LIBRECODE_CONFIG))
    log.debug("loaded custom config", { path: Flag.LIBRECODE_CONFIG })
  }

  result = await loadProjectFileConfigs(result, loadFile)

  result.agent = result.agent || {}
  result.mode = result.mode || {}
  result.plugin = result.plugin || []

  const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
  const { result: resultAfterDirs, deps } = await loadLibrecodeDirConfigs(
    directories,
    result,
    loadFile,
    configInstallDependencies,
    configNeedsInstall,
    configInvalidError,
  )
  result = resultAfterDirs

  result = await loadInlineConfig(result, loadFromText)
  result = await loadAccountConfig(result, loadFromText)
  result = await loadManagedConfig(result, managedDir, loadFile)
  result = applyLegacyMigrations(result)
  result.plugin = configDeduplicatePlugins(result.plugin ?? [])

  return {
    config: result,
    directories,
    deps,
  }
})

// ---------------------------------------------------------------------------
// Public async functions
// ---------------------------------------------------------------------------

async function configWaitForDependencies(): Promise<void> {
  const deps = await configState().then((x) => x.deps)
  await Promise.all(deps)
}

async function configInstallDependencies(dir: string): Promise<void> {
  const pkg = path.join(dir, "package.json")
  // Use "*" for local dev builds; fall back to "latest" for CI/channel builds
  // whose version strings (e.g. "0.0.0-main-202604111840") are never published to npm.
  const targetVersion = Installation.isLocal()
    ? "*"
    : /^0\.0\.0-/.test(Installation.VERSION)
      ? "latest"
      : Installation.VERSION

  const json = await Filesystem.readJson<{ dependencies?: Record<string, string> }>(pkg).catch(() => ({
    dependencies: {},
  }))
  json.dependencies = {
    ...json.dependencies,
    "@librecode/plugin": targetVersion,
  }
  await Filesystem.writeJson(pkg, json)

  const gitignore = path.join(dir, ".gitignore")
  const hasGitIgnore = await Filesystem.exists(gitignore)
  if (!hasGitIgnore)
    await Filesystem.write(gitignore, ["node_modules", "package.json", "bun.lock", ".gitignore"].join("\n"))

  // Install any additional dependencies defined in the package.json
  // This allows local plugins and custom tools to use external packages
  using _ = await Lock.write("bun-install")
  await BunProc.run(
    [
      "install",
      // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
      ...(proxied() || process.env.CI ? ["--no-cache"] : []),
    ],
    { cwd: dir },
  ).catch((err) => {
    if (err instanceof Process.RunFailedError) {
      const detail = {
        dir,
        cmd: err.cmd,
        code: err.code,
        stdout: err.stdout.toString(),
        stderr: err.stderr.toString(),
      }
      if (Flag.LIBRECODE_STRICT_CONFIG_DEPS) {
        log.error("failed to install dependencies", detail)
        throw err
      }
      log.warn("failed to install dependencies", detail)
      return
    }

    if (Flag.LIBRECODE_STRICT_CONFIG_DEPS) {
      log.error("failed to install dependencies", { dir, error: err })
      throw err
    }
    log.warn("failed to install dependencies", { dir, error: err })
  })
}

async function isWritable(dir: string): Promise<boolean> {
  try {
    await fs.access(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function configNeedsInstall(dir: string): Promise<boolean> {
  // Test environments can set LIBRECODE_SKIP_DEPS_INSTALL=1 to bypass
  // bun install (which makes network calls and is slow in unit tests).
  if (process.env.LIBRECODE_SKIP_DEPS_INSTALL === "1") return false

  // Some config dirs may be read-only.
  // Installing deps there will fail; skip installation in that case.
  const writable = await isWritable(dir)
  if (!writable) {
    log.debug("config dir is not writable, skipping dependency install", { dir })
    return false
  }

  const nodeModules = path.join(dir, "node_modules")
  if (!existsSync(nodeModules)) return true

  const pkg = path.join(dir, "package.json")
  const pkgExists = await Filesystem.exists(pkg)
  if (!pkgExists) return true

  const parsed = await Filesystem.readJson<{ dependencies?: Record<string, string> }>(pkg).catch(() => null)
  const dependencies = parsed?.dependencies ?? {}
  const depVersion = dependencies["@librecode/plugin"]
  if (!depVersion) return true

  const targetVersion = Installation.isLocal() ? "latest" : Installation.VERSION
  if (targetVersion === "latest") {
    const isOutdated = await PackageRegistry.isOutdated("@librecode/plugin", depVersion, dir)
    if (!isOutdated) return false
    log.info("Cached version is outdated, proceeding with install", {
      pkg: "@librecode/plugin",
      cachedVersion: depVersion,
    })
    return true
  }
  if (depVersion === targetVersion) return false
  return true
}

// ---------------------------------------------------------------------------
// Plugin helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a canonical plugin name from a plugin specifier.
 * - For file:// URLs: extracts filename without extension
 * - For npm packages: extracts package name without version
 *
 * @example
 * getPluginName("file:///path/to/plugin/foo.js") // "foo"
 * getPluginName("oh-my-librecode@2.4.3") // "oh-my-librecode"
 * getPluginName("@scope/pkg@1.0.0") // "@scope/pkg"
 */
function configGetPluginName(plugin: string): string {
  if (plugin.startsWith("file://")) {
    return path.parse(new URL(plugin).pathname).name
  }
  const lastAt = plugin.lastIndexOf("@")
  if (lastAt > 0) {
    return plugin.substring(0, lastAt)
  }
  return plugin
}

/**
 * Deduplicates plugins by name, with later entries (higher priority) winning.
 * Priority order (highest to lowest):
 * 1. Local plugin/ directory
 * 2. Local librecode.json
 * 3. Global plugin/ directory
 * 4. Global librecode.json
 *
 * Since plugins are added in low-to-high priority order,
 * we reverse, deduplicate (keeping first occurrence), then restore order.
 */
function configDeduplicatePlugins(plugins: string[]): string[] {
  // seenNames: canonical plugin names for duplicate detection
  // e.g., "oh-my-librecode", "@scope/pkg"
  const seenNames = new Set<string>()

  // uniqueSpecifiers: full plugin specifiers to return
  // e.g., "oh-my-librecode@2.4.3", "file:///path/to/plugin.js"
  const uniqueSpecifiers: string[] = []

  for (const specifier of plugins.toReversed()) {
    const name = configGetPluginName(specifier)
    if (!seenNames.has(name)) {
      seenNames.add(name)
      uniqueSpecifiers.push(specifier)
    }
  }

  return uniqueSpecifiers.toReversed()
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

async function configGet(): Promise<InfoType> {
  return configState().then((x) => x.config)
}

async function configGetGlobal(): Promise<InfoType> {
  return configGlobal()
}

async function configUpdate(config: InfoType): Promise<void> {
  const filepath = path.join(Instance.directory, "config.json")
  const existing = await loadFile(filepath)
  await Filesystem.writeJson(filepath, mergeDeep(existing, config))
  await Instance.dispose()
}

function globalConfigFile(): string {
  const candidates = ["librecode.jsonc", "librecode.json", "config.json"].map((file) =>
    path.join(Global.Path.config, file),
  )
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function patchJsonc(input: string, patch: unknown, patchPath: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, patchPath, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJsonc(result, value, [...patchPath, key])
  }, input)
}

function parseConfig(text: string, filepath: string): InfoType {
  const errors: JsoncParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    const lines = text.split("\n")
    const errorDetails = errors
      .map((e) => {
        const beforeOffset = text.substring(0, e.offset).split("\n")
        const line = beforeOffset.length
        const column = beforeOffset[beforeOffset.length - 1].length + 1
        const problemLine = lines[line - 1]

        const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
        if (!problemLine) return error

        return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
      })
      .join("\n")

    throw new configJsonError({
      path: filepath,
      message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
    })
  }

  const parsed = _Info.safeParse(data)
  if (parsed.success) return parsed.data

  throw new configInvalidError({
    path: filepath,
    issues: parsed.error.issues,
  })
}

async function configUpdateGlobal(config: InfoType): Promise<InfoType> {
  const filepath = globalConfigFile()
  // biome-ignore lint/suspicious/noExplicitAny: catch variable typed for .code property access
  const before = await Filesystem.readText(filepath).catch((err: any) => {
    if (err.code === "ENOENT") return "{}"
    throw new configJsonError({ path: filepath }, { cause: err })
  })

  const next = await (async () => {
    if (!filepath.endsWith(".jsonc")) {
      const existing = parseConfig(before, filepath)
      const merged = mergeDeep(existing, config)
      await Filesystem.writeJson(filepath, merged)
      return merged
    }

    const updated = patchJsonc(before, config)
    const merged = parseConfig(updated, filepath)
    await Filesystem.write(filepath, updated)
    return merged
  })()

  configGlobal.reset()

  void Instance.disposeAll()
    .catch(() => undefined)
    .finally(() => {
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Event.Disposed.type,
          properties: {},
        },
      })
    })

  return next
}

async function configDirectories(): Promise<string[]> {
  return configState().then((x) => x.directories)
}

// ---------------------------------------------------------------------------
// Barrel export — preserves Config.X call syntax for all consumers
// ---------------------------------------------------------------------------

export const Config = {
  // Schema re-exports
  McpLocal: _McpLocal,
  McpOAuth: _McpOAuth,
  McpRemote: _McpRemote,
  Mcp: _Mcp,
  PermissionAction: _PermissionAction,
  PermissionObject: _PermissionObject,
  PermissionRule: _PermissionRule,
  Permission: _Permission,
  Command: _Command,
  Skills: _Skills,
  Agent: _Agent,
  Keybinds: _Keybinds,
  Server: _Server,
  Layout: _Layout,
  Provider: _Provider,
  Info: _Info,

  // Error types
  JsonError: configJsonError,
  InvalidError: configInvalidError,
  ConfigDirectoryTypoError,

  // Managed config
  managedConfigDir,

  // State
  state: configState,
  waitForDependencies: configWaitForDependencies,

  // Dependencies
  installDependencies: configInstallDependencies,
  needsInstall: configNeedsInstall,

  // Plugin helpers
  getPluginName: configGetPluginName,
  deduplicatePlugins: configDeduplicatePlugins,

  // Global config
  global: configGlobal,
  readFile: configReadFile,

  // Public API
  get: configGet,
  getGlobal: configGetGlobal,
  update: configUpdate,
  updateGlobal: configUpdateGlobal,
  directories: configDirectories,
}

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Config {
  type McpOAuth = McpOAuthType
  type Mcp = McpType
  type PermissionAction = PermissionActionType
  type PermissionObject = PermissionObjectType
  type PermissionRule = PermissionRuleType
  type Permission = PermissionType
  type Command = CommandType
  type Skills = SkillsType
  type Agent = AgentType
  type Layout = LayoutType
  type Provider = ProviderType
  type Info = InfoType
}
