import type { Hooks, PluginInput, Plugin as PluginInstance } from "@librecode/plugin"
import { createLibrecodeClient } from "@librecode/sdk"
import { NamedError } from "@librecode/util/error"
import { BunProc } from "../bun"
import { Bus } from "../bus"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { Log } from "../util/log"
import { CodexAuthPlugin } from "./codex"
import { CopilotAuthPlugin } from "./copilot"
import { LiteLLMAuthPlugin } from "./litellm"
import { OllamaAuthPlugin } from "./ollama"

const log = Log.create({ service: "plugin" })

// BUILTIN npm plugins installed on first run.
// Simple API key providers (Anthropic, OpenAI, etc.) do NOT need entries here:
// - Auth UI: dialog-connect-provider.tsx falls back to a generic "API Key" prompt
// - API key injection: loadApiKeyProviders() handles all stored keys generically
// - Provider-specific headers: handled by CUSTOM_LOADERS in provider/loaders/
// Add plugins here only for providers that need custom OAuth flows or multi-step auth.
const BUILTIN: string[] = []

// Built-in plugins that are directly imported (not installed from npm)
const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin, LiteLLMAuthPlugin, OllamaAuthPlugin]

function buildPluginInput(client: ReturnType<typeof createLibrecodeClient>): PluginInput {
  return {
    client,
    project: Instance.project,
    worktree: Instance.worktree,
    directory: Instance.directory,
    get serverUrl(): URL {
      // Lazy require to break circular dep: Session → SessionPrompt → Plugin → Server → Session
      const { Server } = require("../server/server") as typeof import("../server/server")
      return Server.url ?? new URL("http://localhost:4096")
    },
    $: Bun.$,
  }
}

// Validates npm package name: allows scoped (@scope/name) and unscoped names,
// with optional version suffix (@version). Rejects shell metacharacters.
const VALID_NPM_PACKAGE = /^(@[a-z0-9][a-z0-9-_.]*\/)?[a-z0-9][a-z0-9-_.]*(@[a-zA-Z0-9._\-~^*]+)?$/

async function installNpmPlugin(plugin: string): Promise<string> {
  if (!VALID_NPM_PACKAGE.test(plugin)) {
    log.error("rejected invalid plugin name", { plugin })
    Bus.publish(Session.Event.Error, {
      error: new NamedError.Unknown({ message: `Invalid plugin name: ${plugin}` }).toObject(),
    })
    return ""
  }
  const lastAtIndex = plugin.lastIndexOf("@")
  const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
  const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
  return BunProc.install(pkg, version).catch((err) => {
    const cause = err instanceof Error ? err.cause : err
    const detail = cause instanceof Error ? cause.message : String(cause ?? err)
    log.error("failed to install plugin", { pkg, version, error: detail })
    Bus.publish(Session.Event.Error, {
      error: new NamedError.Unknown({ message: `Failed to install plugin ${pkg}@${version}: ${detail}` }).toObject(),
    })
    return ""
  })
}

async function loadPluginFromPath(path: string, input: PluginInput, hooks: Hooks[]): Promise<void> {
  await import(path)
    .then(async (mod) => {
      const seen = new Set<PluginInstance>()
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        if (seen.has(fn)) continue
        seen.add(fn)
        hooks.push(await fn(input))
      }
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      log.error("failed to load plugin", { path, error: message })
      Bus.publish(Session.Event.Error, {
        error: new NamedError.Unknown({ message: `Failed to load plugin ${path}: ${message}` }).toObject(),
      })
    })
}

async function resolvePluginPath(plugin: string): Promise<string> {
  if (plugin.startsWith("file://")) return plugin
  return installNpmPlugin(plugin)
}

function isLegacyPlugin(plugin: string): boolean {
  return plugin.includes("librecode-openai-codex-auth") || plugin.includes("librecode-copilot-auth")
}

async function loadInternalPlugins(input: PluginInput, hooks: Hooks[]): Promise<void> {
  for (const plugin of INTERNAL_PLUGINS) {
    log.info("loading internal plugin", { name: plugin.name })
    const init = await plugin(input).catch((err) => {
      log.error("failed to load internal plugin", { name: plugin.name, error: err })
    })
    if (init) hooks.push(init)
  }
}

async function loadExternalPlugins(plugins: string[], input: PluginInput, hooks: Hooks[]): Promise<void> {
  for (const rawPlugin of plugins) {
    if (isLegacyPlugin(rawPlugin)) continue
    log.info("loading plugin", { path: rawPlugin })
    const resolved = await resolvePluginPath(rawPlugin)
    if (!resolved) continue
    await loadPluginFromPath(resolved, input, hooks)
  }
}

const state = Instance.state(async () => {
  const client = createLibrecodeClient({
    baseUrl: "http://localhost:4096",
    directory: Instance.directory,
    headers: Flag.LIBRECODE_SERVER_PASSWORD
      ? {
          Authorization: `Basic ${Buffer.from(`${Flag.LIBRECODE_SERVER_USERNAME ?? "librecode"}:${Flag.LIBRECODE_SERVER_PASSWORD}`).toString("base64")}`,
        }
      : undefined,
    fetch: async (...args) => {
      const { Server } = require("../server/server") as typeof import("../server/server")
      return Server.Default().fetch(...args)
    },
  })
  const config = await Config.get()
  const hooks: Hooks[] = []
  const input = buildPluginInput(client)

  await loadInternalPlugins(input, hooks)

  let plugins = config.plugin ?? []
  if (plugins.length) await Config.waitForDependencies()
  if (!Flag.LIBRECODE_DISABLE_DEFAULT_PLUGINS) plugins = [...BUILTIN, ...plugins]
  await loadExternalPlugins(plugins, input, hooks)

  return { hooks, input }
})

async function pluginTrigger<
  Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
  Input = Parameters<Required<Hooks>[Name]>[0],
  Output = Parameters<Required<Hooks>[Name]>[1],
>(name: Name, input: Input, output: Output): Promise<Output> {
  if (!name) return output
  for (const hook of await state().then((x) => x.hooks)) {
    const fn = hook[name]
    if (!fn) continue
    // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
    // give up.
    // try-counter: 2
    await fn(input, output)
  }
  return output
}

async function pluginList() {
  return state().then((x) => x.hooks)
}

async function pluginInit() {
  const hooks = await state().then((x) => x.hooks)
  const config = await Config.get()
  for (const hook of hooks) {
    // @ts-expect-error this is because we haven't moved plugin to sdk v2
    await hook.config?.(config)
  }
  Bus.subscribeAll(async (input) => {
    const hooks = await state().then((x) => x.hooks)
    for (const hook of hooks) {
      hook.event?.({
        event: input,
      })
    }
  })
}

export const Plugin = {
  trigger: pluginTrigger,
  list: pluginList,
  init: pluginInit,
} as const
