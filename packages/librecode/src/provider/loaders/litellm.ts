/**
 * LiteLLM Provider Loader
 *
 * LiteLLM is an OpenAI-compatible proxy that provides unified access to
 * 100+ LLM providers. It runs on port 4000 by default.
 *
 * Autodiscovery: checks localhost:4000/v1/models on startup.
 * Config: provider.litellm.options.baseURL + optional apiKey
 * Env: LITELLM_API_KEY, LITELLM_BASE_URL
 */

import { Env } from "../../env"
import { Log } from "../../util/log"
import type { CustomLoader } from "./types"

const log = Log.create({ service: "provider.litellm" })

const DEFAULT_BASE_URL = "http://localhost:4000/v1"
const DISCOVERY_TIMEOUT = 3000 // 3 seconds

async function fetchLiteLLMModels(baseURL: string, apiKey: string | undefined): Promise<Array<{ id: string }> | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT)
  const headers: Record<string, string> = {}
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
  try {
    const response = await fetch(`${baseURL}/models`, { headers, signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) {
      log.info("LiteLLM endpoint returned non-OK", { status: response.status, baseURL })
      return null
    }
    const data = (await response.json()) as { data?: Array<{ id: string }> }
    return data.data ?? []
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") {
      log.info("LiteLLM autodiscovery timed out", { baseURL })
    } else {
      log.info("LiteLLM not available", { baseURL, error: (e as Error).message })
    }
    return null
  }
}

function injectLiteLLMModel(provider: Parameters<CustomLoader>[0], model: { id: string }, baseURL: string): void {
  if (provider.models[model.id]) return
  provider.models[model.id] = {
    id: model.id,
    name: model.id,
    providerID: "litellm",
    family: "",
    api: { id: model.id, url: baseURL, npm: "@ai-sdk/openai-compatible" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 4096 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  } as unknown as (typeof provider.models)[string]
}

export const litellm: CustomLoader = async (provider) => {
  const baseURL = (provider.options?.baseURL as string | undefined) ?? Env.get("LITELLM_BASE_URL") ?? DEFAULT_BASE_URL
  const apiKey = (provider.options?.apiKey as string | undefined) ?? Env.get("LITELLM_API_KEY") ?? undefined

  const models = await fetchLiteLLMModels(baseURL, apiKey)
  if (!models || models.length === 0) {
    if (models !== null) log.info("LiteLLM endpoint returned no models", { baseURL })
    return { autoload: false }
  }

  log.info("LiteLLM autodiscovered", { baseURL, modelCount: models.length, models: models.map((m) => m.id) })
  for (const model of models) injectLiteLLMModel(provider, model, baseURL)

  return {
    autoload: true,
    options: { baseURL, ...(apiKey && { apiKey }) },
    async getModel(sdk: unknown, modelID: string) {
      return (sdk as { languageModel: (id: string) => unknown }).languageModel(modelID)
    },
  }
}
