import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy } from "remeda"
import { Log } from "../util/log"
import { Plugin } from "../plugin"
import { ModelsDev } from "./models"
import { Auth } from "../auth"
import { Env } from "../env"
import { Flag } from "../flag/flag"
import { ProviderTransform } from "./transform"
import { ModelID, ProviderID } from "./schema"
import { CUSTOM_LOADERS, type CustomModelLoader, type CustomVarsLoader } from "./loaders"
import { type ModelType, type InfoType } from "./types"

const log = Log.create({ service: "provider" })

// ── state helper types ────────────────────────────────────────────────────────

export type ProvidersMap = { [providerID: string]: InfoType }
export type ModelLoadersMap = { [providerID: string]: CustomModelLoader }
export type VarsLoadersMap = { [providerID: string]: CustomVarsLoader }

export interface StateMutableCtx {
  providers: ProvidersMap
  modelLoaders: ModelLoadersMap
  varsLoaders: VarsLoadersMap
  database: { [id: string]: InfoType }
}

// ── model construction from models.dev ───────────────────────────────────────

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

function buildModelCostFromDev(model: ModelsDev.Model): ModelType["cost"] {
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

function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): ModelType {
  const m: ModelType = {
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

export function fromModelsDevProvider(provider: ModelsDev.Provider): InfoType {
  return {
    id: ProviderID.make(provider.id),
    source: "custom",
    name: provider.name,
    env: provider.env ?? [],
    options: {},
    models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
  }
}

// ── state helper functions ────────────────────────────────────────────────────

export function mergeProviderInto(ctx: StateMutableCtx, providerID: ProviderID, patch: Partial<InfoType>): void {
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
  existingModel: ModelType | undefined,
  modelID: string,
): string {
  if (model.name) return model.name
  if (model.id && model.id !== modelID) return modelID
  return existingModel?.name ?? modelID
}

type ConfigModelEntry = Config.Provider["models"] extends Record<string, infer M> | undefined ? M : never

function buildConfigInputModalities(
  model: ConfigModelEntry,
  existing: ModelType["capabilities"]["input"] | undefined,
): ModelType["capabilities"]["input"] {
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
  existing: ModelType["capabilities"]["output"] | undefined,
): ModelType["capabilities"]["output"] {
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
  existingModel: ModelType | undefined,
): ModelType["capabilities"] {
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

function buildConfigModelCost(model: ConfigModelEntry, existingModel: ModelType | undefined): ModelType["cost"] {
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
  existingModel: ModelType | undefined,
  modelsDev: { [id: string]: ModelsDev.Provider },
): ModelType["api"] {
  return {
    id: model.id ?? existingModel?.api.id ?? modelID,
    npm:
      model.provider?.npm ??
      providerCfg.npm ??
      existingModel?.api.npm ??
      modelsDev[providerID]?.npm ??
      "@ai-sdk/openai-compatible",
    url: model.provider?.api ?? providerCfg?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api ?? "",
  }
}

function buildConfigModel(
  modelID: string,
  model: ConfigModelEntry,
  providerID: string,
  providerCfg: Config.Provider,
  existingModel: ModelType | undefined,
  modelsDev: { [id: string]: ModelsDev.Provider },
): ModelType {
  const parsedModel: ModelType = {
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

export function extendDatabaseFromConfig(
  database: { [id: string]: InfoType },
  configProviders: [string, Config.Provider][],
  modelsDev: { [id: string]: ModelsDev.Provider },
): void {
  for (const [providerID, provider] of configProviders) {
    const existing = database[providerID]
    const parsed: InfoType = {
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

export function loadEnvProviders(ctx: StateMutableCtx, disabled: Set<string>): void {
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

export async function loadApiKeyProviders(ctx: StateMutableCtx, disabled: Set<string>): Promise<void> {
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
  const patch: Partial<InfoType> = ctx.providers[enterpriseProviderID]
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
  const patch: Partial<InfoType> = ctx.providers[providerID] ? { options: opts } : { source: "custom", options: opts }
  mergeProviderInto(ctx, providerID, patch)
}

export async function loadPluginProviders(ctx: StateMutableCtx, disabled: Set<string>): Promise<void> {
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
  data: InfoType,
  fn: (typeof CUSTOM_LOADERS)[string],
): Promise<void> {
  const result = await fn(data)
  if (!result || (!result.autoload && !ctx.providers[providerID])) return
  if (result.getModel) ctx.modelLoaders[providerID] = result.getModel
  if (result.vars) ctx.varsLoaders[providerID] = result.vars
  const opts = result.options ?? {}
  const patch: Partial<InfoType> = ctx.providers[providerID] ? { options: opts } : { source: "custom", options: opts }
  mergeProviderInto(ctx, providerID, patch)
}

export async function loadCustomLoaderProviders(ctx: StateMutableCtx, disabled: Set<string>): Promise<void> {
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

export function applyConfigOverrides(ctx: StateMutableCtx, configProviders: [string, Config.Provider][]): void {
  for (const [id, provider] of configProviders) {
    const providerID = ProviderID.make(id)
    const partial: Partial<InfoType> = { source: "config" }
    if (provider.env) partial.env = provider.env
    if (provider.name) partial.name = provider.name
    if (provider.options) partial.options = provider.options
    mergeProviderInto(ctx, providerID, partial)
  }
}

function applyModelVariantsFromConfig(
  model: ModelType,
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
  model: ModelType,
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
  provider: InfoType,
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

export function filterAndFinalizeProviders(
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
