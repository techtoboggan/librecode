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
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cache: {
        read: model.cost?.cache_read ?? 0,
        write: model.cost?.cache_write ?? 0,
      },
      experimentalOver200K: model.cost?.context_over_200k
        ? {
            cache: {
              read: model.cost.context_over_200k.cache_read ?? 0,
              write: model.cost.context_over_200k.cache_write ?? 0,
            },
            input: model.cost.context_over_200k.input,
            output: model.cost.context_over_200k.output,
          }
        : undefined,
    },
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
      input: {
        text: model.modalities?.input?.includes("text") ?? false,
        audio: model.modalities?.input?.includes("audio") ?? false,
        image: model.modalities?.input?.includes("image") ?? false,
        video: model.modalities?.input?.includes("video") ?? false,
        pdf: model.modalities?.input?.includes("pdf") ?? false,
      },
      output: {
        text: model.modalities?.output?.includes("text") ?? false,
        audio: model.modalities?.output?.includes("audio") ?? false,
        image: model.modalities?.output?.includes("image") ?? false,
        video: model.modalities?.output?.includes("video") ?? false,
        pdf: model.modalities?.output?.includes("pdf") ?? false,
      },
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

const state = Instance.state(async () => {
  using _ = log.time("state")
  const config = await Config.get()
  const modelsDev = await ModelsDev.get()
  const database = mapValues(modelsDev, fromModelsDevProvider)

  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null

  function isProviderAllowed(providerID: ProviderID): boolean {
    if (enabled && !enabled.has(providerID)) return false
    if (disabled.has(providerID)) return false
    return true
  }

  const providers: { [providerID: string]: _Info } = {}
  const languages = new Map<string, LanguageModelV2>()
  const modelLoaders: {
    [providerID: string]: CustomModelLoader
  } = {}
  const varsLoaders: {
    [providerID: string]: CustomVarsLoader
  } = {}
  const sdk = new Map<string, SDK>()

  log.info("init")

  const configProviders = Object.entries(config.provider ?? {})

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

  function mergeProvider(providerID: ProviderID, provider: Partial<_Info>) {
    const existing = providers[providerID]
    if (existing) {
      // @ts-expect-error
      providers[providerID] = mergeDeep(existing, provider)
      return
    }
    const match = database[providerID]
    if (!match) return
    // @ts-expect-error
    providers[providerID] = mergeDeep(match, provider)
  }

  // extend database from config
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
      const name = iife(() => {
        if (model.name) return model.name
        if (model.id && model.id !== modelID) return modelID
        return existingModel?.name ?? modelID
      })
      const parsedModel: _Model = {
        id: ModelID.make(modelID),
        api: {
          id: model.id ?? existingModel?.api.id ?? modelID,
          npm:
            model.provider?.npm ??
            provider.npm ??
            existingModel?.api.npm ??
            modelsDev[providerID]?.npm ??
            "@ai-sdk/openai-compatible",
          url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
        },
        status: model.status ?? existingModel?.status ?? "active",
        name,
        providerID: ProviderID.make(providerID),
        capabilities: {
          temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
          reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
          attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
          toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
          input: {
            text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
            audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
            image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
            video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
            pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
          },
          output: {
            text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
            audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
            image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
            video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
            pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
          },
          interleaved: model.interleaved ?? false,
        },
        cost: {
          input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
          output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
          cache: {
            read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
            write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
          },
        },
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
      parsed.models[modelID] = parsedModel
    }
    database[providerID] = parsed
  }

  // load env
  const env = Env.all()
  for (const [id, provider] of Object.entries(database)) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    const apiKey = provider.env.map((item) => env[item]).find(Boolean)
    if (!apiKey) continue
    mergeProvider(providerID, {
      source: "env",
      key: provider.env.length === 1 ? apiKey : undefined,
    })
  }

  // load apikeys
  for (const [id, provider] of Object.entries(await Auth.all())) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    if (provider.type === "api") {
      mergeProvider(providerID, {
        source: "api",
        key: provider.key,
      })
    }
  }

  for (const plugin of await Plugin.list()) {
    if (!plugin.auth) continue
    const providerID = ProviderID.make(plugin.auth.provider)
    if (disabled.has(providerID)) continue

    // For github-copilot plugin, check if auth exists for either github-copilot or github-copilot-enterprise
    let hasAuth = false
    const auth = await Auth.get(providerID)
    if (auth) hasAuth = true

    // Special handling for github-copilot: also check for enterprise auth
    if (providerID === ProviderID.githubCopilot && !hasAuth) {
      const enterpriseAuth = await Auth.get("github-copilot-enterprise")
      if (enterpriseAuth) hasAuth = true
    }

    if (!hasAuth) continue
    if (!plugin.auth.loader) continue

    // Load for the main provider if auth exists
    if (auth) {
      const options = await plugin.auth.loader(() => Auth.get(providerID) as any, database[plugin.auth.provider])
      const opts = options ?? {}
      const patch: Partial<_Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
      mergeProvider(providerID, patch)
    }

    // If this is github-copilot plugin, also register for github-copilot-enterprise if auth exists
    if (providerID === ProviderID.githubCopilot) {
      const enterpriseProviderID = ProviderID.githubCopilotEnterprise
      if (!disabled.has(enterpriseProviderID)) {
        const enterpriseAuth = await Auth.get(enterpriseProviderID)
        if (enterpriseAuth) {
          const enterpriseOptions = await plugin.auth.loader(
            () => Auth.get(enterpriseProviderID) as any,
            database[enterpriseProviderID],
          )
          const opts = enterpriseOptions ?? {}
          const patch: Partial<_Info> = providers[enterpriseProviderID]
            ? { options: opts }
            : { source: "custom", options: opts }
          mergeProvider(enterpriseProviderID, patch)
        }
      }
    }
  }

  for (const [id, fn] of Object.entries(CUSTOM_LOADERS)) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    const data = database[providerID]
    if (!data) {
      log.error("Provider does not exist in model list " + providerID)
      continue
    }
    const result = await fn(data)
    if (result && (result.autoload || providers[providerID])) {
      if (result.getModel) modelLoaders[providerID] = result.getModel
      if (result.vars) varsLoaders[providerID] = result.vars
      const opts = result.options ?? {}
      const patch: Partial<_Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
      mergeProvider(providerID, patch)
    }
  }

  // load config
  for (const [id, provider] of configProviders) {
    const providerID = ProviderID.make(id)
    const partial: Partial<_Info> = { source: "config" }
    if (provider.env) partial.env = provider.env
    if (provider.name) partial.name = provider.name
    if (provider.options) partial.options = provider.options
    mergeProvider(providerID, partial)
  }

  for (const [id, provider] of Object.entries(providers)) {
    const providerID = ProviderID.make(id)
    if (!isProviderAllowed(providerID)) {
      delete providers[providerID]
      continue
    }

    const configProvider = config.provider?.[providerID]

    for (const [modelID, model] of Object.entries(provider.models)) {
      model.api.id = model.api.id ?? model.id ?? modelID
      if (
        modelID === "gpt-5-chat-latest" ||
        (providerID === ProviderID.openrouter && modelID === "openai/gpt-5-chat")
      )
        delete provider.models[modelID]
      if (model.status === "alpha" && !Flag.LIBRECODE_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
      if (model.status === "deprecated") delete provider.models[modelID]
      if (
        (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
        (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
      )
        delete provider.models[modelID]

      model.variants = mapValues(ProviderTransform.variants(model), (v) => v)

      // Filter out disabled variants from config
      const configVariants = configProvider?.models?.[modelID]?.variants
      if (configVariants && model.variants) {
        const merged = mergeDeep(model.variants, configVariants)
        model.variants = mapValues(
          pickBy(merged, (v) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
      }
    }

    if (Object.keys(provider.models).length === 0) {
      delete providers[providerID]
      continue
    }

    log.info("found", { providerID })
  }

  return {
    models: languages,
    providers,
    sdk,
    modelLoaders,
    varsLoaders,
  }
})

export async function list() {
  return state().then((state) => state.providers)
}

async function getSDK(model: _Model) {
  try {
    using _ = log.time("getSDK", {
      providerID: model.providerID,
    })
    const s = await state()
    const provider = s.providers[model.providerID]
    const options = { ...provider.options }

    if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
      delete options.fetch
    }

    if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
      options["includeUsage"] = true
    }

    const baseURL = iife(() => {
      let url =
        typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : model.api.url
      if (!url) return

      // some models/providers have variable urls, ex: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1"
      // We track this in models.dev, and then when we are resolving the baseURL
      // we need to string replace that literal: "${AZURE_RESOURCE_NAME}"
      const loader = s.varsLoaders[model.providerID]
      if (loader) {
        const vars = loader(options)
        for (const [key, value] of Object.entries(vars)) {
          const field = "${" + key + "}"
          url = url.replaceAll(field, value)
        }
      }

      url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
        const val = Env.get(String(key))
        return val ?? item
      })
      return url
    })

    if (baseURL !== undefined) options["baseURL"] = baseURL
    if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
    if (model.headers)
      options["headers"] = {
        ...options["headers"],
        ...model.headers,
      }

    const key = Hash.fast(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
    const existing = s.sdk.get(key)
    if (existing) return existing

    const customFetch = options["fetch"]
    const chunkTimeout = options["chunkTimeout"] || DEFAULT_CHUNK_TIMEOUT
    delete options["chunkTimeout"]

    options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
      // Preserve custom fetch if it exists, wrap it with timeout logic
      const fetchFn = customFetch ?? fetch
      const opts = init ?? {}
      const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
      const signals: AbortSignal[] = []

      if (opts.signal) signals.push(opts.signal)
      if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
      if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
        signals.push(AbortSignal.timeout(options["timeout"]))

      const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
      if (combined) opts.signal = combined

      // Strip openai itemId metadata following what codex does
      // Codex uses #[serde(skip_serializing)] on id fields for all item types:
      // Message, Reasoning, FunctionCall, LocalShellCall, CustomToolCall, WebSearchCall
      // IDs are only re-attached for Azure with store=true
      if (model.api.npm === "@ai-sdk/openai" && opts.body && opts.method === "POST") {
        const body = JSON.parse(opts.body as string)
        const isAzure = model.providerID.includes("azure")
        const keepIds = isAzure && body.store === true
        if (!keepIds && Array.isArray(body.input)) {
          for (const item of body.input) {
            if ("id" in item) {
              delete item.id
            }
          }
          opts.body = JSON.stringify(body)
        }
      }

      const res = await fetchFn(input, {
        ...opts,
        // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
        timeout: false,
      })

      if (!chunkAbortCtl) return res
      return wrapSSE(res, chunkTimeout, chunkAbortCtl)
    }

    const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
    if (bundledFn) {
      log.info("using bundled provider", { providerID: model.providerID, pkg: model.api.npm })
      const loaded = bundledFn({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded)
      return loaded as SDK
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
    const loaded = fn({
      name: model.providerID,
      ...options,
    })
    s.sdk.set(key, loaded)
    return loaded as SDK
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
    const language = s.modelLoaders[model.providerID]
      ? await s.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
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

export async function getSmallModel(providerID: ProviderID) {
  const cfg = await Config.get()

  if (cfg.small_model) {
    const parsed = parseModel(cfg.small_model)
    return getModel(parsed.providerID, parsed.modelID)
  }

  const provider = await state().then((state) => state.providers[providerID])
  if (provider) {
    let priority = [
      "claude-haiku-4-5",
      "claude-haiku-4.5",
      "3-5-haiku",
      "3.5-haiku",
      "gemini-3-flash",
      "gemini-2.5-flash",
      "gpt-5-nano",
    ]
    if (providerID.startsWith("github-copilot")) {
      // prioritize free models for github copilot
      priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
    }
    for (const item of priority) {
      if (providerID === ProviderID.amazonBedrock) {
        const crossRegionPrefixes = ["global.", "us.", "eu."]
        const candidates = Object.keys(provider.models).filter((m) => m.includes(item))

        // Model selection priority:
        // 1. global. prefix (works everywhere)
        // 2. User's region prefix (us., eu.)
        // 3. Unprefixed model
        const globalMatch = candidates.find((m) => m.startsWith("global."))
        if (globalMatch) return getModel(providerID, ModelID.make(globalMatch))

        const region = provider.options?.region
        if (region) {
          const regionPrefix = region.split("-")[0]
          if (regionPrefix === "us" || regionPrefix === "eu") {
            const regionalMatch = candidates.find((m) => m.startsWith(`${regionPrefix}.`))
            if (regionalMatch) return getModel(providerID, ModelID.make(regionalMatch))
          }
        }

        const unprefixed = candidates.find((m) => !crossRegionPrefixes.some((p) => m.startsWith(p)))
        if (unprefixed) return getModel(providerID, ModelID.make(unprefixed))
      } else {
        for (const model of Object.keys(provider.models)) {
          if (model.includes(item)) return getModel(providerID, ModelID.make(model))
        }
      }
    }
  }

  return undefined
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
