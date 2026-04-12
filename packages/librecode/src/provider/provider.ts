// Direct imports for bundled providers

import path from "node:path"
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createGateway } from "@ai-sdk/gateway"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createVertex } from "@ai-sdk/google-vertex"
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"
import { createGroq } from "@ai-sdk/groq"
import { createMistral } from "@ai-sdk/mistral"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createVercel } from "@ai-sdk/vercel"
import { createXai } from "@ai-sdk/xai"
import { createGitLab } from "@gitlab/gitlab-ai-provider"
import { createOpenRouter, type LanguageModelV2 } from "@openrouter/ai-sdk-provider"
import { NoSuchModelError, type Provider as SDK } from "ai"
import fuzzysort from "fuzzysort"
import { mapValues, sortBy } from "remeda"
import { BunProc } from "../bun"
import { Config } from "../config/config"
import { Env } from "../env"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Hash } from "../util/hash"
import { Log } from "../util/log"
import type { CustomVarsLoader } from "./loaders"
import { ModelsDev } from "./models"
import { ModelID, ProviderID } from "./schema"
import { createOpenaiCompatible as createGitHubCopilotOpenAICompatible } from "./sdk/copilot"
import {
  applyConfigOverrides,
  extendDatabaseFromConfig,
  filterAndFinalizeProviders,
  fromModelsDevProvider,
  loadApiKeyProviders,
  loadCustomLoaderProviders,
  loadEnvProviders,
  loadPluginProviders,
  type StateMutableCtx,
} from "./state-loader"
import { Info, type InfoType, InitError, Model, ModelNotFoundError, type ModelType } from "./types"

const DEFAULT_CHUNK_TIMEOUT = 300_000

const log = Log.create({ service: "provider" })

const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/google-vertex": createVertex,
  "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/openai-compatible": createOpenAICompatible,
  "@openrouter/ai-sdk-provider": createOpenRouter,
  "@ai-sdk/xai": createXai,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/deepinfra": createDeepInfra,
  "@ai-sdk/cerebras": createCerebras,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/gateway": createGateway,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/vercel": createVercel,
  "@gitlab/gitlab-ai-provider": createGitLab,
  // @ts-expect-error (TODO: kill this code so we dont have to maintain it)
  "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible,
}

function wrapSSE(res: Response, ms: number, ctl: AbortController): Response {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

// ── state initializer ─────────────────────────────────────────────────────────

const state = Instance.state(async () => {
  using _ = log.time("state")
  const config = await Config.get()
  const modelsDev = await ModelsDev.get()
  const database = mapValues(modelsDev, fromModelsDevProvider)

  // Add LiteLLM as a built-in provider (not from models.dev)
  if (!modelsDev.litellm) {
    modelsDev.litellm = {
      id: "litellm",
      name: "LiteLLM",
      api: "http://localhost:4000/v1",
      npm: "@ai-sdk/openai-compatible",
      env: ["LITELLM_API_KEY"],
      models: {},
    }
  }

  // Add GitHub Copilot Enterprise provider that inherits from GitHub Copilot
  if (database["github-copilot"]) {
    const githubCopilot = database["github-copilot"]
    database["github-copilot-enterprise"] = {
      ...githubCopilot,
      id: ProviderID.githubCopilotEnterprise,
      name: "GitHub Copilot Enterprise",
      models: mapValues(githubCopilot.models, (model) => ({
        ...model,
        providerID: ProviderID.githubCopilotEnterprise,
      })),
    }
  }

  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null
  const isProviderAllowed = (providerID: ProviderID): boolean => {
    if (enabled && !enabled.has(providerID)) return false
    return !disabled.has(providerID)
  }

  const ctx: StateMutableCtx = {
    providers: {},
    modelLoaders: {},
    varsLoaders: {},
    database,
  }

  log.info("init")

  const configProviders = Object.entries(config.provider ?? {})

  extendDatabaseFromConfig(database, configProviders, modelsDev)
  loadEnvProviders(ctx, disabled)
  await loadApiKeyProviders(ctx, disabled)
  await loadPluginProviders(ctx, disabled)
  await loadCustomLoaderProviders(ctx, disabled)
  applyConfigOverrides(ctx, configProviders)
  filterAndFinalizeProviders(ctx, config, isProviderAllowed)

  return {
    models: new Map<string, LanguageModelV2>(),
    providers: ctx.providers,
    sdk: new Map<string, SDK>(),
    modelLoaders: ctx.modelLoaders,
    varsLoaders: ctx.varsLoaders,
  }
})

export async function list(): Promise<Record<string, InfoType>> {
  return state().then((s) => s.providers)
}

function resolveBaseURL(
  options: Record<string, unknown>,
  modelApiURL: string | undefined,
  varsLoader: CustomVarsLoader | undefined,
): string | undefined {
  let url = typeof options.baseURL === "string" && options.baseURL !== "" ? options.baseURL : modelApiURL
  if (!url) return undefined

  // some models/providers have variable urls, ex: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1"
  if (varsLoader) {
    const vars = varsLoader(options)
    for (const [key, value] of Object.entries(vars)) {
      url = url.replaceAll(`\${${key}}`, value)
    }
  }

  return url.replace(/\$\{([^}]+)\}/g, (item, key) => Env.get(String(key)) ?? item)
}

function stripOpenAIItemIds(opts: BunFetchRequestInit, modelNpm: string, modelProviderID: string): void {
  if (modelNpm !== "@ai-sdk/openai" || !opts.body || opts.method !== "POST") return
  const body = JSON.parse(opts.body as string)
  const isAzure = modelProviderID.includes("azure")
  if (isAzure && body.store === true) return
  if (!Array.isArray(body.input)) return
  for (const item of body.input) {
    if ("id" in item) delete item.id
  }
  opts.body = JSON.stringify(body)
}

function buildCombinedSignal(
  opts: BunFetchRequestInit,
  chunkAbortCtl: AbortController | undefined,
  timeout: unknown,
): AbortSignal | null {
  const signals: AbortSignal[] = []
  if (opts.signal) signals.push(opts.signal)
  if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
  if (timeout !== undefined && timeout !== null && timeout !== false)
    signals.push(AbortSignal.timeout(timeout as number))
  if (signals.length === 0) return null
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals)
}

function buildCustomFetch(
  model: ModelType,
  customFetch: unknown,
  chunkTimeout: number | false,
  timeout: unknown,
): (input: unknown, init?: BunFetchRequestInit) => Promise<Response> {
  return async (input: unknown, init?: BunFetchRequestInit) => {
    const fetchFn = (customFetch as typeof fetch) ?? fetch
    const opts = init ?? {}
    const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined

    const combined = buildCombinedSignal(opts, chunkAbortCtl, timeout)
    if (combined) opts.signal = combined

    stripOpenAIItemIds(opts, model.api.npm, model.providerID)

    const res = await fetchFn(input as RequestInfo | URL, {
      ...opts,
      // @ts-expect-error see here: https://github.com/oven-sh/bun/issues/16682
      timeout: false,
    })

    if (!chunkAbortCtl) return res
    return wrapSSE(res, chunkTimeout as number, chunkAbortCtl)
  }
}

async function loadSDKProvider(model: ModelType, options: Record<string, unknown>): Promise<SDK> {
  const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
  if (bundledFn) {
    log.info("using bundled provider", { providerID: model.providerID, pkg: model.api.npm })
    return bundledFn({ name: model.providerID, ...options }) as SDK
  }

  let installedPath: string
  if (!model.api.npm.startsWith("file://")) {
    installedPath = await BunProc.install(model.api.npm, "latest")
  } else {
    log.info("loading local provider", { pkg: model.api.npm })
    installedPath = model.api.npm
  }

  const mod = await import(installedPath)
  const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
  return fn({ name: model.providerID, ...options }) as SDK
}

async function getSDK(model: ModelType): Promise<SDK> {
  try {
    using _ = log.time("getSDK", { providerID: model.providerID })
    const s = await state()
    const provider = s.providers[model.providerID]
    const options: Record<string, unknown> = { ...provider.options }

    if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
      delete options.fetch
    }

    if (model.api.npm.includes("@ai-sdk/openai-compatible") && options.includeUsage !== false) {
      options.includeUsage = true
    }

    const baseURL = resolveBaseURL(options, model.api.url, s.varsLoaders[model.providerID])
    if (baseURL !== undefined) options.baseURL = baseURL
    if (options.apiKey === undefined && provider.key) options.apiKey = provider.key
    if (model.headers)
      options.headers = { ...(options.headers as Record<string, string> | undefined), ...model.headers }

    const key = Hash.fast(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
    const existing = s.sdk.get(key)
    if (existing) return existing

    const customFetch = options.fetch
    const chunkTimeout = (options.chunkTimeout as number | undefined) || DEFAULT_CHUNK_TIMEOUT
    delete options.chunkTimeout

    options.fetch = buildCustomFetch(model, customFetch, chunkTimeout, options.timeout)

    const loaded = await loadSDKProvider(model, options)
    s.sdk.set(key, loaded)
    return loaded
  } catch (e) {
    throw new InitError({ providerID: model.providerID }, { cause: e })
  }
}

export async function getProvider(providerID: ProviderID): Promise<InfoType | undefined> {
  return state().then((s) => s.providers[providerID])
}

export async function getModel(providerID: ProviderID, modelID: ModelID): Promise<ModelType> {
  const s = await state()
  const provider = s.providers[providerID]
  if (!provider) {
    const availableProviders = Object.keys(s.providers)
    const matches = fuzzysort.go(providerID, availableProviders, { limit: 3, threshold: -10000 })
    const suggestions = matches.map((m) => m.target)
    throw new ModelNotFoundError({ providerID, modelID, suggestions })
  }

  const info = provider.models[modelID]
  if (!info) {
    const availableModels = Object.keys(provider.models)
    const matches = fuzzysort.go(modelID, availableModels, { limit: 3, threshold: -10000 })
    const suggestions = matches.map((m) => m.target)
    throw new ModelNotFoundError({ providerID, modelID, suggestions })
  }
  return info
}

export async function getLanguage(model: ModelType): Promise<LanguageModelV2> {
  const s = await state()
  const key = `${model.providerID}/${model.id}`
  if (s.models.has(key)) return s.models.get(key)!

  const provider = s.providers[model.providerID]
  const sdk = await getSDK(model)

  try {
    const modelLoader = s.modelLoaders[model.providerID]
    const language = modelLoader
      ? await modelLoader(sdk, model.api.id, provider.options)
      : (sdk.languageModel(model.api.id) as LanguageModelV2)
    s.models.set(key, language)
    return language
  } catch (e) {
    if (e instanceof NoSuchModelError)
      throw new ModelNotFoundError(
        {
          modelID: model.id,
          providerID: model.providerID,
        },
        { cause: e },
      )
    throw e
  }
}

export async function closest(
  providerID: ProviderID,
  query: string[],
): Promise<{ providerID: ProviderID; modelID: ModelID } | undefined> {
  const s = await state()
  const provider = s.providers[providerID]
  if (!provider) return undefined
  for (const item of query) {
    for (const modelID of Object.keys(provider.models)) {
      if (modelID.includes(item))
        return {
          providerID,
          modelID: ModelID.make(modelID),
        }
    }
  }
  return undefined
}

const CROSS_REGION_PREFIXES = ["global.", "us.", "eu."] as const

async function findBedrockSmallModel(
  providerID: ProviderID,
  provider: InfoType,
  item: string,
): Promise<ModelType | undefined> {
  const candidates = Object.keys(provider.models).filter((m) => m.includes(item))
  if (candidates.length === 0) return undefined

  // Priority: global. prefix → user region prefix → unprefixed
  const globalMatch = candidates.find((m) => m.startsWith("global."))
  if (globalMatch) return getModel(providerID, ModelID.make(globalMatch))

  const region = provider.options?.region as string | undefined
  if (region) {
    const regionPrefix = region.split("-")[0]
    if (regionPrefix === "us" || regionPrefix === "eu") {
      const regionalMatch = candidates.find((m) => m.startsWith(`${regionPrefix}.`))
      if (regionalMatch) return getModel(providerID, ModelID.make(regionalMatch))
    }
  }

  const unprefixed = candidates.find((m) => !CROSS_REGION_PREFIXES.some((p) => m.startsWith(p)))
  if (unprefixed) return getModel(providerID, ModelID.make(unprefixed))
  return undefined
}

function buildSmallModelPriority(providerID: ProviderID): string[] {
  const base = [
    "claude-haiku-4-5",
    "claude-haiku-4.5",
    "3-5-haiku",
    "3.5-haiku",
    "gemini-3-flash",
    "gemini-2.5-flash",
    "gpt-5-nano",
  ]
  if (providerID.startsWith("github-copilot")) return ["gpt-5-mini", "claude-haiku-4.5", ...base]
  return base
}

async function findSmallModelInProvider(providerID: ProviderID, provider: InfoType): Promise<ModelType | undefined> {
  const priorityList = buildSmallModelPriority(providerID)
  for (const item of priorityList) {
    if (providerID === ProviderID.amazonBedrock) {
      const found = await findBedrockSmallModel(providerID, provider, item)
      if (found) return found
    } else {
      const modelKey = Object.keys(provider.models).find((m) => m.includes(item))
      if (modelKey) return getModel(providerID, ModelID.make(modelKey))
    }
  }
  return undefined
}

export async function getSmallModel(providerID: ProviderID): Promise<ModelType | undefined> {
  const cfg = await Config.get()

  if (cfg.small_model) {
    const parsed = parseModel(cfg.small_model)
    return getModel(parsed.providerID, parsed.modelID)
  }

  const provider = await state().then((s) => s.providers[providerID])
  if (!provider) return undefined

  return findSmallModelInProvider(providerID, provider)
}

const priority = ["gpt-5", "claude-sonnet-4", "gemini-3-pro"]
export function sort<T extends { id: string }>(models: T[]): T[] {
  return sortBy(
    models,
    [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
    [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
    [(model) => model.id, "desc"],
  )
}

export async function defaultModel(): Promise<{ providerID: ProviderID; modelID: ModelID }> {
  const cfg = await Config.get()
  if (cfg.model) return parseModel(cfg.model)

  const providers = await list()
  const recent = (await Filesystem.readJson<{ recent?: { providerID: ProviderID; modelID: ModelID }[] }>(
    path.join(Global.Path.state, "model.json"),
  )
    .then((x) => (Array.isArray(x.recent) ? x.recent : []))
    .catch(() => [])) as { providerID: ProviderID; modelID: ModelID }[]
  for (const entry of recent) {
    const provider = providers[entry.providerID]
    if (!provider) continue
    if (!provider.models[entry.modelID]) continue
    return { providerID: entry.providerID, modelID: entry.modelID }
  }

  const provider = Object.values(providers).find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id))
  if (!provider) throw new Error("no providers found")
  const [model] = sort(Object.values(provider.models))
  if (!model) throw new Error("no models found")
  return {
    providerID: provider.id,
    modelID: model.id,
  }
}

export function parseModel(model: string): { providerID: ProviderID; modelID: ModelID } {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: ProviderID.make(providerID),
    modelID: ModelID.make(rest.join("/")),
  }
}

export { fromModelsDevProvider, Info, InitError, Model, ModelNotFoundError }

export const Provider = {
  Model,
  Info,
  fromModelsDevProvider,
  list,
  getProvider,
  getModel,
  getLanguage,
  closest,
  getSmallModel,
  sort,
  defaultModel,
  parseModel,
  ModelNotFoundError,
  InitError,
} as const

// Type companion namespace for type re-exports
// biome-ignore lint/style/noNamespace: type companion — declaration merging for Provider.Model, Provider.Info etc.
export namespace Provider {
  export type Model = ModelType
  export type Info = InfoType
}
