import z from "zod"
import os from "os"
import fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, type Provider as SDK } from "ai"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Hash } from "../util/hash"
import { Plugin } from "../plugin"
import { NamedError } from "@librecode/util/error"
import { ModelsDev } from "./models"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import { Global } from "../global"
import path from "path"
import { Filesystem } from "../util/filesystem"

// Direct imports for bundled providers
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createVertex } from "@ai-sdk/google-vertex"
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenRouter, type LanguageModelV2 } from "@openrouter/ai-sdk-provider"
import { createOpenaiCompatible as createGitHubCopilotOpenAICompatible } from "./sdk/copilot"
import { createXai } from "@ai-sdk/xai"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createGateway } from "@ai-sdk/gateway"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createVercel } from "@ai-sdk/vercel"
import { createGitLab } from "@gitlab/gitlab-ai-provider"
import { ProviderTransform } from "./transform"
import { Installation } from "../installation"
import { ModelID, ProviderID } from "./schema"
import { CUSTOM_LOADERS, type CustomModelLoader, type CustomVarsLoader } from "./loaders"

const DEFAULT_CHUNK_TIMEOUT = 300_000

const log = Log.create({ service: "provider" })

function wrapSSE(res: Response, ms: number, ctl: AbortController) {
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
  // @ts-ignore (TODO: kill this code so we dont have to maintain it)
  "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible,
}

// Custom loaders are now in ./loaders/ — imported at module level as CUSTOM_LOADERS

export const Model = z
  .object({
    id: ModelID.zod,
    providerID: ProviderID.zod,
    api: z.object({
      id: z.string(),
      url: z.string(),
      npm: z.string(),
    }),
    name: z.string(),
    family: z.string().optional(),
    capabilities: z.object({
      temperature: z.boolean(),
      reasoning: z.boolean(),
      attachment: z.boolean(),
      toolcall: z.boolean(),
      input: z.object({
        text: z.boolean(),
        audio: z.boolean(),
        image: z.boolean(),
        video: z.boolean(),
        pdf: z.boolean(),
      }),
      output: z.object({
        text: z.boolean(),
        audio: z.boolean(),
        image: z.boolean(),
        video: z.boolean(),
        pdf: z.boolean(),
      }),
      interleaved: z.union([
        z.boolean(),
        z.object({
          field: z.enum(["reasoning_content", "reasoning_details"]),
        }),
      ]),
    }),
    cost: z.object({
      input: z.number(),
      output: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
      experimentalOver200K: z
        .object({
          input: z.number(),
          output: z.number(),
          cache: z.object({
            read: z.number(),
            write: z.number(),
          }),
        })
        .optional(),
    }),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    status: z.enum(["alpha", "beta", "deprecated", "active"]),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()),
    release_date: z.string(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  .meta({
    ref: "Model",
  })
type _Model = z.infer<typeof Model>

export const Info = z
  .object({
    id: ProviderID.zod,
    name: z.string(),
    source: z.enum(["env", "config", "custom", "api"]),
    env: z.string().array(),
    key: z.string().optional(),
    options: z.record(z.string(), z.any()),
    models: z.record(z.string(), Model),
  })
  .meta({
    ref: "Provider",
  })
type _Info = z.infer<typeof Info>

function buildModalities(modalities: string[] | undefined): {
  text: boolean
  audio: boolean
  image: boolean
  video: boolean
  pdf: boolean
} {
  return {
    text: modalities?.includes("text") ?? false,
    audio: modalities?.includes("audio") ?? false,
    image: modalities?.includes("image") ?? false,
    video: modalities?.includes("video") ?? false,
    pdf: modalities?.includes("pdf") ?? false,
  }
}

function buildModelCostFromDev(model: ModelsDev.Model): _Model["cost"] {
  const over200k = model.cost?.context_over_200k
  return {
    input: model.cost?.input ?? 0,
    output: model.cost?.output ?? 0,
    cache: {
      read: model.cost?.cache_read ?? 0,
      write: model.cost?.cache_write ?? 0,
    },
    experimentalOver200K: over200k
      ? {
          cache: { read: over200k.cache_read ?? 0, write: over200k.cache_write ?? 0 },
          input: over200k.input,
          output: over200k.output,
        }
      : undefined,
  }
}

function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): _Model {
  const m: _Model = {
    id: ModelID.make(model.id),
    providerID: ProviderID.make(provider.id),
    name: model.name,
    family: model.family,
    api: {
      id: model.id,
      url: model.provider?.api ?? provider.api!,
      npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
    },
    status: model.status ?? "active",
    headers: model.headers ?? {},
    options: model.options ?? {},
    cost: buildModelCostFromDev(model),
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    capabilities: {
      temperature: model.temperature,
      reasoning: model.reasoning,
      attachment: model.attachment,
      toolcall: model.tool_call,
      input: buildModalities(model.modalities?.input),
      output: buildModalities(model.modalities?.output),
      interleaved: model.interleaved ?? false,
    },
    release_date: model.release_date,
    variants: {},
  }

  m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

  return m
}

export function fromModelsDevProvider(provider: ModelsDev.Provider): _Info {
  return {
    id: ProviderID.make(provider.id),
    source: "custom",
    name: provider.name,
    env: provider.env ?? [],
    options: {},
    models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
  }
}

// ── state helper types ────────────────────────────────────────────────────────

type ProvidersMap = { [providerID: string]: _Info }
type ModelLoadersMap = { [providerID: string]: CustomModelLoader }
type VarsLoadersMap = { [providerID: string]: CustomVarsLoader }

interface StateMutableCtx {
  providers: ProvidersMap
  modelLoaders: ModelLoadersMap
  varsLoaders: VarsLoadersMap
  database: { [id: string]: _Info }
}

// ── state helper functions ────────────────────────────────────────────────────

function mergeProviderInto(
  ctx: StateMutableCtx,
  providerID: ProviderID,
  patch: Partial<_Info>,
): void {
  const existing = ctx.providers[providerID]
  if (existing) {
    // @ts-expect-error
    ctx.providers[providerID] = mergeDeep(existing, patch)
    return
  }
  const match = ctx.database[providerID]
  if (!match) return
  // @ts-expect-error
  ctx.providers[providerID] = mergeDeep(match, patch)
}

function resolveConfigModelName(
  model: Config.Provider["models"] extends Record<string, infer M> | undefined ? M : never,
  existingModel: _Model | undefined,
  modelID: string,
): string {
  if (model.name) return model.name
  if (model.id && model.id !== modelID) return modelID
  return existingModel?.name ?? modelID
}

type ConfigModelEntry = Config.Provider["models"] extends Record<string, infer M> | undefined ? M : never

function buildConfigInputModalities(
  model: ConfigModelEntry,
  existing: _Model["capabilities"]["input"] | undefined,
): _Model["capabilities"]["input"] {
  const inp = model.modalities?.input
  return {
    text: inp?.includes("text") ?? existing?.text ?? true,
    audio: inp?.includes("audio") ?? existing?.audio ?? false,
    image: inp?.includes("image") ?? existing?.image ?? false,
    video: inp?.includes("video") ?? existing?.video ?? false,
    pdf: inp?.includes("pdf") ?? existing?.pdf ?? false,
  }
}

function buildConfigOutputModalities(
  model: ConfigModelEntry,
  existing: _Model["capabilities"]["output"] | undefined,
): _Model["capabilities"]["output"] {
  const out = model.modalities?.output
  return {
    text: out?.includes("text") ?? existing?.text ?? true,
    audio: out?.includes("audio") ?? existing?.audio ?? false,
    image: out?.includes("image") ?? existing?.image ?? false,
    video: out?.includes("video") ?? existing?.video ?? false,
    pdf: out?.includes("pdf") ?? existing?.pdf ?? false,
  }
}

function buildConfigModelCapabilities(
  model: ConfigModelEntry,
  existingModel: _Model | undefined,
): _Model["capabilities"] {
  const ec = existingModel?.capabilities
  return {
    temperature: model.temperature ?? ec?.temperature ?? false,
    reasoning: model.reasoning ?? ec?.reasoning ?? false,
    attachment: model.attachment ?? ec?.attachment ?? false,
    toolcall: model.tool_call ?? ec?.toolcall ?? true,
    input: buildConfigInputModalities(model, ec?.input),
    output: buildConfigOutputModalities(model, ec?.output),
    interleaved: model.interleaved ?? false,
  }
}

function buildConfigModelCost(model: ConfigModelEntry, existingModel: _Model | undefined): _Model["cost"] {
  return {
    input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
    output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
    cache: {
      read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
      write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
    },
  }
}

function buildConfigModelApi(
  modelID: string,
  model: ConfigModelEntry,
  providerID: string,
  providerCfg: Config.Provider,
  existingModel: _Model | undefined,
  modelsDev: { [id: string]: ModelsDev.Provider },
): _Model["api"] {
  return {
    id: model.id ?? existingModel?.api.id ?? modelID,
    npm: model.provider?.npm ?? providerCfg.npm ?? existingModel?.api.npm ?? modelsDev[providerID]?.npm ?? "@ai-sdk/openai-compatible",
    url: model.provider?.api ?? providerCfg?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api ?? "",
  }
}

function buildConfigModel(
  modelID: string,
  model: ConfigModelEntry,
  providerID: string,
  providerCfg: Config.Provider,
  existingModel: _Model | undefined,
  modelsDev: { [id: string]: ModelsDev.Provider },
): _Model {
  const parsedModel: _Model = {
    id: ModelID.make(modelID),
    api: buildConfigModelApi(modelID, model, providerID, providerCfg, existingModel, modelsDev),
    status: model.status ?? existingModel?.status ?? "active",
    name: resolveConfigModelName(model, existingModel, modelID),
    providerID: ProviderID.make(providerID),
    capabilities: buildConfigModelCapabilities(model, existingModel),
    cost: buildConfigModelCost(model, existingModel),
    options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
    limit: {
      context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
      output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
    },
    headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
    family: model.family ?? existingModel?.family ?? "",
    release_date: model.release_date ?? existingModel?.release_date ?? "",
    variants: {},
  }
  const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
  parsedModel.variants = mapValues(
    pickBy(merged, (v) => !v.disabled),
    (v) => omit(v, ["disabled"]),
  )
  return parsedModel
}

function extendDatabaseFromConfig(
  database: { [id: string]: _Info },
  configProviders: [string, Config.Provider][],
  modelsDev: { [id: string]: ModelsDev.Provider },
): void {
  for (const [providerID, provider] of configProviders) {
    const existing = database[providerID]
    const parsed: _Info = {
      id: ProviderID.make(providerID),
      name: provider.name ?? existing?.name ?? providerID,
      env: provider.env ?? existing?.env ?? [],
      options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
      source: "config",
      models: existing?.models ?? {},
    }
    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      const existingModel = parsed.models[model.id ?? modelID]
      parsed.models[modelID] = buildConfigModel(modelID, model, providerID, provider, existingModel, modelsDev)
    }
    database[providerID] = parsed
  }
}

function loadEnvProviders(ctx: StateMutableCtx, disabled: Set<string>): void {
  const env = Env.all()
  for (const [id, provider] of Object.entries(ctx.database)) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    const apiKey = provider.env.map((item) => env[item]).find(Boolean)
    if (!apiKey) continue
    mergeProviderInto(ctx, providerID, {
      source: "env",
      key: provider.env.length === 1 ? apiKey : undefined,
    })
  }
}

async function loadApiKeyProviders(ctx: StateMutableCtx, disabled: Set<string>): Promise<void> {
  for (const [id, provider] of Object.entries(await Auth.all())) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    if (provider.type === "api") {
      mergeProviderInto(ctx, providerID, { source: "api", key: provider.key })
    }
  }
}

async function loadCopilotEnterprisePlugin(
  ctx: StateMutableCtx,
  plugin: Awaited<ReturnType<typeof Plugin.list>>[number],
  disabled: Set<string>,
): Promise<void> {
  if (!plugin.auth?.loader) return
  const enterpriseProviderID = ProviderID.githubCopilotEnterprise
  if (disabled.has(enterpriseProviderID)) return
  const enterpriseAuth = await Auth.get(enterpriseProviderID)
  if (!enterpriseAuth) return
  const enterpriseOptions = await plugin.auth.loader(
    () => Auth.get(enterpriseProviderID) as never,
    ctx.database[enterpriseProviderID],
  )
  const opts = enterpriseOptions ?? {}
  const patch: Partial<_Info> = ctx.providers[enterpriseProviderID]
    ? { options: opts }
    : { source: "custom", options: opts }
  mergeProviderInto(ctx, enterpriseProviderID, patch)
}

type PluginEntry = Awaited<ReturnType<typeof Plugin.list>>[number]

async function checkPluginHasAuth(providerID: ProviderID): Promise<boolean> {
  const auth = await Auth.get(providerID)
  if (auth) return true
  if (providerID !== ProviderID.githubCopilot) return false
  const enterpriseAuth = await Auth.get("github-copilot-enterprise")
  return !!enterpriseAuth
}

async function loadMainPluginAuth(ctx: StateMutableCtx, plugin: PluginEntry, providerID: ProviderID): Promise<void> {
  if (!plugin.auth?.loader) return
  const auth = await Auth.get(providerID)
  if (!auth) return
  const options = await plugin.auth.loader(() => Auth.get(providerID) as never, ctx.database[plugin.auth.provider])
  const opts = options ?? {}
  const patch: Partial<_Info> = ctx.providers[providerID] ? { options: opts } : { source: "custom", options: opts }
  mergeProviderInto(ctx, providerID, patch)
}

async function loadPluginProviders(ctx: StateMutableCtx, disabled: Set<string>): Promise<void> {
  for (const plugin of await Plugin.list()) {
    if (!plugin.auth) continue
    const providerID = ProviderID.make(plugin.auth.provider)
    if (disabled.has(providerID)) continue

    const hasAuth = await checkPluginHasAuth(providerID)
    if (!hasAuth || !plugin.auth.loader) continue

    await loadMainPluginAuth(ctx, plugin, providerID)

    if (providerID === ProviderID.githubCopilot) {
      await loadCopilotEnterprisePlugin(ctx, plugin, disabled)
    }
  }
}

async function applyCustomLoader(
  ctx: StateMutableCtx,
  providerID: ProviderID,
  data: _Info,
  fn: (typeof CUSTOM_LOADERS)[string],
): Promise<void> {
  const result = await fn(data)
  if (!result || (!result.autoload && !ctx.providers[providerID])) return
  if (result.getModel) ctx.modelLoaders[providerID] = result.getModel
  if (result.vars) ctx.varsLoaders[providerID] = result.vars
  const opts = result.options ?? {}
  const patch: Partial<_Info> = ctx.providers[providerID] ? { options: opts } : { source: "custom", options: opts }
  mergeProviderInto(ctx, providerID, patch)
}

async function loadCustomLoaderProviders(ctx: StateMutableCtx, disabled: Set<string>): Promise<void> {
  for (const [id, fn] of Object.entries(CUSTOM_LOADERS)) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    const data = ctx.database[providerID]
    if (!data) {
      log.error("Provider does not exist in model list " + providerID)
      continue
    }
    await applyCustomLoader(ctx, providerID, data, fn)
  }
}

function applyConfigOverrides(
  ctx: StateMutableCtx,
  configProviders: [string, Config.Provider][],
): void {
  for (const [id, provider] of configProviders) {
    const providerID = ProviderID.make(id)
    const partial: Partial<_Info> = { source: "config" }
    if (provider.env) partial.env = provider.env
    if (provider.name) partial.name = provider.name
    if (provider.options) partial.options = provider.options
    mergeProviderInto(ctx, providerID, partial)
  }
}

function applyModelVariantsFromConfig(
  model: _Model,
  configVariants: Record<string, Record<string, unknown>> | undefined,
): void {
  model.variants = mapValues(ProviderTransform.variants(model), (v) => v)
  if (!configVariants || !model.variants) return
  const merged = mergeDeep(model.variants, configVariants)
  model.variants = mapValues(
    pickBy(merged, (v) => !v.disabled),
    (v) => omit(v, ["disabled"]),
  )
}

function shouldRemoveModel(
  modelID: string,
  model: _Model,
  providerID: ProviderID,
  configProvider: Config.Provider | undefined,
): boolean {
  if (modelID === "gpt-5-chat-latest") return true
  if (providerID === ProviderID.openrouter && modelID === "openai/gpt-5-chat") return true
  if (model.status === "alpha" && !Flag.LIBRECODE_ENABLE_EXPERIMENTAL_MODELS) return true
  if (model.status === "deprecated") return true
  if (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) return true
  if (configProvider?.whitelist && !configProvider.whitelist.includes(modelID)) return true
  return false
}

function filterProviderModels(
  provider: _Info,
  providerID: ProviderID,
  configProvider: Config.Provider | undefined,
): void {
  for (const [modelID, model] of Object.entries(provider.models)) {
    model.api.id = model.api.id ?? model.id ?? modelID
    if (shouldRemoveModel(modelID, model, providerID, configProvider)) {
      delete provider.models[modelID]
      continue
    }
    applyModelVariantsFromConfig(model, configProvider?.models?.[modelID]?.variants)
  }
}

function filterAndFinalizeProviders(
  ctx: StateMutableCtx,
  config: Awaited<ReturnType<typeof Config.get>>,
  isProviderAllowed: (id: ProviderID) => boolean,
): void {
  for (const [id, provider] of Object.entries(ctx.providers)) {
    const providerID = ProviderID.make(id)
    if (!isProviderAllowed(providerID)) {
      delete ctx.providers[providerID]
      continue
    }
    filterProviderModels(provider, providerID, config.provider?.[providerID])
    if (Object.keys(provider.models).length === 0) {
      delete ctx.providers[providerID]
      continue
    }
    log.info("found", { providerID })
  }
}

// ── state initializer ─────────────────────────────────────────────────────────

const state = Instance.state(async () => {
  using _ = log.time("state")
  const config = await Config.get()
  const modelsDev = await ModelsDev.get()
  const database = mapValues(modelsDev, fromModelsDevProvider)

  // Add LiteLLM as a built-in provider (not from models.dev)
  if (!modelsDev["litellm"]) {
    modelsDev["litellm"] = {
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

export async function list() {
  return state().then((state) => state.providers)
}

function resolveBaseURL(
  options: Record<string, unknown>,
  modelApiURL: string | undefined,
  varsLoader: CustomVarsLoader | undefined,
): string | undefined {
  let url = typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : modelApiURL
  if (!url) return undefined

  // some models/providers have variable urls, ex: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1"
  if (varsLoader) {
    const vars = varsLoader(options)
    for (const [key, value] of Object.entries(vars)) {
      url = url.replaceAll("${" + key + "}", value)
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
  model: _Model,
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
      // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
      timeout: false,
    })

    if (!chunkAbortCtl) return res
    return wrapSSE(res, chunkTimeout as number, chunkAbortCtl)
  }
}

async function loadSDKProvider(model: _Model, options: Record<string, unknown>): Promise<SDK> {
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

async function getSDK(model: _Model): Promise<SDK> {
  try {
    using _ = log.time("getSDK", { providerID: model.providerID })
    const s = await state()
    const provider = s.providers[model.providerID]
    const options: Record<string, unknown> = { ...provider.options }

    if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
      delete options["fetch"]
    }

    if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
      options["includeUsage"] = true
    }

    const baseURL = resolveBaseURL(options, model.api.url, s.varsLoaders[model.providerID])
    if (baseURL !== undefined) options["baseURL"] = baseURL
    if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
    if (model.headers) options["headers"] = { ...(options["headers"] as Record<string, string> | undefined), ...model.headers }

    const key = Hash.fast(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
    const existing = s.sdk.get(key)
    if (existing) return existing

    const customFetch = options["fetch"]
    const chunkTimeout = (options["chunkTimeout"] as number | undefined) || DEFAULT_CHUNK_TIMEOUT
    delete options["chunkTimeout"]

    options["fetch"] = buildCustomFetch(model, customFetch, chunkTimeout, options["timeout"])

    const loaded = await loadSDKProvider(model, options)
    s.sdk.set(key, loaded)
    return loaded
  } catch (e) {
    throw new InitError({ providerID: model.providerID }, { cause: e })
  }
}

export async function getProvider(providerID: ProviderID) {
  return state().then((s) => s.providers[providerID])
}

export async function getModel(providerID: ProviderID, modelID: ModelID) {
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

export async function getLanguage(model: _Model): Promise<LanguageModelV2> {
  const s = await state()
  const key = `${model.providerID}/${model.id}`
  if (s.models.has(key)) return s.models.get(key)!

  const provider = s.providers[model.providerID]
  const sdk = await getSDK(model)

  try {
    const modelLoader = s.modelLoaders[model.providerID]
    const language = modelLoader
      ? await modelLoader(sdk, model.api.id, provider.options)
      : sdk.languageModel(model.api.id)
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

export async function closest(providerID: ProviderID, query: string[]) {
  const s = await state()
  const provider = s.providers[providerID]
  if (!provider) return undefined
  for (const item of query) {
    for (const modelID of Object.keys(provider.models)) {
      if (modelID.includes(item))
        return {
          providerID,
          modelID,
        }
    }
  }
}

const CROSS_REGION_PREFIXES = ["global.", "us.", "eu."] as const

async function findBedrockSmallModel(
  providerID: ProviderID,
  provider: _Info,
  item: string,
): Promise<_Model | undefined> {
  const candidates = Object.keys(provider.models).filter((m) => m.includes(item))
  if (candidates.length === 0) return undefined

  // Priority: global. prefix → user region prefix → unprefixed
  const globalMatch = candidates.find((m) => m.startsWith("global."))
  if (globalMatch) return getModel(providerID, ModelID.make(globalMatch))

  const region = provider.options?.["region"] as string | undefined
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

async function findSmallModelInProvider(
  providerID: ProviderID,
  provider: _Info,
): Promise<_Model | undefined> {
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

export async function getSmallModel(providerID: ProviderID): Promise<_Model | undefined> {
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
export function sort<T extends { id: string }>(models: T[]) {
  return sortBy(
    models,
    [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
    [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
    [(model) => model.id, "desc"],
  )
}

export async function defaultModel() {
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

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: ProviderID.make(providerID),
    modelID: ModelID.make(rest.join("/")),
  }
}

export const ModelNotFoundError = NamedError.create(
  "ProviderModelNotFoundError",
  z.object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
    suggestions: z.array(z.string()).optional(),
  }),
)

export const InitError = NamedError.create(
  "ProviderInitError",
  z.object({
    providerID: ProviderID.zod,
  }),
)

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
export namespace Provider {
  export type Model = _Model
  export type Info = _Info
}
