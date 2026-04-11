import { Log } from "../util/log"
import path from "path"
import { pathToFileURL } from "url"
import { createRequire } from "module"
import os from "os"
import z from "zod"
import { mergeDeep, pipe } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "@librecode/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { Instance } from "../project/instance"
import { BunProc } from "@/bun"
import { Installation } from "@/installation"
import { constants, existsSync } from "fs"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { PackageRegistry } from "@/bun/registry"
import { proxied } from "@/util/proxied"
import { ConfigPaths } from "./paths"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { Lock } from "@/util/lock"
import {
  mergeConfigConcatArrays,
  loadWellKnownConfigs,
  loadProjectFileConfigs,
  loadLibrecodeDirConfigs,
  loadInlineConfig,
  loadAccountConfig,
  loadManagedConfig,
  migrateModesToAgents,
  applyLegacyToolsPermissions,
} from "./sources"
import {
  McpLocal as _McpLocal,
  McpOAuth as _McpOAuth,
  McpRemote as _McpRemote,
  Mcp as _Mcp,
  PermissionAction as _PermissionAction,
  PermissionObject as _PermissionObject,
  PermissionRule as _PermissionRule,
  Permission as _Permission,
  Command as _Command,
  Skills as _Skills,
  Agent as _Agent,
  Keybinds as _Keybinds,
  Server as _Server,
  Layout as _Layout,
  Provider as _Provider,
  Info as _Info,
  type McpOAuth as McpOAuthType,
  type Mcp as McpType,
  type PermissionAction as PermissionActionType,
  type PermissionObject as PermissionObjectType,
  type PermissionRule as PermissionRuleType,
  type Permission as PermissionType,
  type Command as CommandType,
  type Skills as SkillsType,
  type Agent as AgentType,
  type Layout as LayoutType,
  type Provider as ProviderType,
  type Info as InfoType,
} from "./schema"

export namespace Config {
  const log = Log.create({ service: "config" })

  // ---------------------------------------------------------------------------
  // Schema re-exports — make all schema types available as Config.X
  // ---------------------------------------------------------------------------
  export const McpLocal = _McpLocal
  export const McpOAuth = _McpOAuth
  export type McpOAuth = McpOAuthType
  export const McpRemote = _McpRemote
  export const Mcp = _Mcp
  export type Mcp = McpType
  export const PermissionAction = _PermissionAction
  export type PermissionAction = PermissionActionType
  export const PermissionObject = _PermissionObject
  export type PermissionObject = PermissionObjectType
  export const PermissionRule = _PermissionRule
  export type PermissionRule = PermissionRuleType
  export const Permission = _Permission
  export type Permission = PermissionType
  export const Command = _Command
  export type Command = CommandType
  export const Skills = _Skills
  export type Skills = SkillsType
  export const Agent = _Agent
  export type Agent = AgentType
  export const Keybinds = _Keybinds
  export const Server = _Server
  export const Layout = _Layout
  export type Layout = LayoutType
  export const Provider = _Provider
  export type Provider = ProviderType
  export const Info = _Info
  export type Info = InfoType

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

  export function managedConfigDir(): string {
    return process.env.LIBRECODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
  }

  const managedDir = managedConfigDir()

  // ---------------------------------------------------------------------------
  // Legacy migration
  // ---------------------------------------------------------------------------

  function applyLegacyMigrations(result: Info): Info {
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
  // State — orchestrates all config sources
  // ---------------------------------------------------------------------------

  export const state = Instance.state(async () => {
    // Config loading order (low -> high precedence): https://github.com/techtoboggan/librecode/docs/config#precedence-order
    // 1) Remote .well-known/librecode (org defaults)
    // 2) Global config (~/.config/librecode/librecode.json{,c})
    // 3) Custom config (LIBRECODE_CONFIG)
    // 4) Project config (librecode.json{,c})
    // 5) .librecode directories (.librecode/agents/, .librecode/commands/, .librecode/plugins/, .librecode/librecode.json{,c})
    // 6) Inline config (LIBRECODE_CONFIG_CONTENT)
    // Managed config directory is enterprise-only and always overrides everything above.
    const auth = await Auth.all()
    let result: Info = {}

    result = await loadWellKnownConfigs(auth, result, loadFromText)
    result = mergeConfigConcatArrays(result, await global())

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
      installDependencies,
      needsInstall,
      InvalidError,
    )
    result = resultAfterDirs

    result = await loadInlineConfig(result, loadFromText)
    result = await loadAccountConfig(result, loadFromText)
    result = await loadManagedConfig(result, managedDir, loadFile)
    result = applyLegacyMigrations(result)
    result.plugin = deduplicatePlugins(result.plugin ?? [])

    return {
      config: result,
      directories,
      deps,
    }
  })

  export async function waitForDependencies(): Promise<void> {
    const deps = await state().then((x) => x.deps)
    await Promise.all(deps)
  }

  // ---------------------------------------------------------------------------
  // Dependency installation
  // ---------------------------------------------------------------------------

  export async function installDependencies(dir: string): Promise<void> {
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

  export async function needsInstall(dir: string): Promise<boolean> {
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
  export function getPluginName(plugin: string): string {
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
  export function deduplicatePlugins(plugins: string[]): string[] {
    // seenNames: canonical plugin names for duplicate detection
    // e.g., "oh-my-librecode", "@scope/pkg"
    const seenNames = new Set<string>()

    // uniqueSpecifiers: full plugin specifiers to return
    // e.g., "oh-my-librecode@2.4.3", "file:///path/to/plugin.js"
    const uniqueSpecifiers: string[] = []

    for (const specifier of plugins.toReversed()) {
      const name = getPluginName(specifier)
      if (!seenNames.has(name)) {
        seenNames.add(name)
        uniqueSpecifiers.push(specifier)
      }
    }

    return uniqueSpecifiers.toReversed()
  }

  // ---------------------------------------------------------------------------
  // Error types
  // ---------------------------------------------------------------------------

  export const { JsonError, InvalidError } = ConfigPaths

  export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
      path: z.string(),
      dir: z.string(),
      suggestion: z.string(),
    }),
  )

  // ---------------------------------------------------------------------------
  // Global config loader
  // ---------------------------------------------------------------------------

  export const global = lazy(async () => {
    let result: Info = pipe(
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
          result["$schema"] = "https://github.com/techtoboggan/librecode/config.json"
          result = mergeDeep(result, rest)
          await Filesystem.writeJson(path.join(Global.Path.config, "config.json"), result)
          await fs.unlink(legacy)
        })
        .catch(() => {})
    }

    return result
  })

  export const { readFile } = ConfigPaths

  // ---------------------------------------------------------------------------
  // File / text loaders (internal helpers used by state and sources)
  // ---------------------------------------------------------------------------

  async function loadFile(filepath: string): Promise<Info> {
    log.info("loading", { path: filepath })
    const text = await readFile(filepath)
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
      return import.meta.resolve!(plugin, filePath)
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

  function resolvePluginPaths(data: Info, filePath: string): void {
    if (!data.plugin) return
    for (let i = 0; i < data.plugin.length; i++) {
      data.plugin[i] = resolvePluginSpecifier(data.plugin[i], filePath)
    }
  }

  async function loadFromText(
    text: string,
    options: { path: string } | { dir: string; source: string },
  ): Promise<Info> {
    const original = text
    const source = "path" in options ? options.path : options.source
    const isFile = "path" in options
    const raw = await ConfigPaths.parseText(
      text,
      "path" in options ? options.path : { source: options.source, dir: options.dir },
    )

    const normalized = normalizeConfigData(raw, source)
    const parsed = Info.safeParse(normalized)
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

    throw new InvalidError({
      path: source,
      issues: parsed.error.issues,
    })
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  export async function get(): Promise<Info> {
    return state().then((x) => x.config)
  }

  export async function getGlobal(): Promise<Info> {
    return global()
  }

  export async function update(config: Info): Promise<void> {
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

  function parseConfig(text: string, filepath: string): Info {
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

      throw new JsonError({
        path: filepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    const parsed = Info.safeParse(data)
    if (parsed.success) return parsed.data

    throw new InvalidError({
      path: filepath,
      issues: parsed.error.issues,
    })
  }

  export async function updateGlobal(config: Info): Promise<Info> {
    const filepath = globalConfigFile()
    const before = await Filesystem.readText(filepath).catch((err: any) => {
      if (err.code === "ENOENT") return "{}"
      throw new JsonError({ path: filepath }, { cause: err })
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

    global.reset()

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

  export async function directories(): Promise<string[]> {
    return state().then((x) => x.directories)
  }
}
