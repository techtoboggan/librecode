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

export const litellm: CustomLoader = async (provider) => {
  const baseURL = provider.options?.baseURL as string
    ?? Env.get("LITELLM_BASE_URL")
    ?? DEFAULT_BASE_URL

  const apiKey = provider.options?.apiKey as string
    ?? Env.get("LITELLM_API_KEY")
    ?? undefined

  // Try to discover models from the LiteLLM endpoint
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT)

    const headers: Record<string, string> = {}
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

    const response = await fetch(`${baseURL}/models`, {
      headers,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      log.info("LiteLLM endpoint returned non-OK", { status: response.status, baseURL })
      return { autoload: false }
    }

    const data = await response.json() as { data?: Array<{ id: string }> }
    const models = data.data ?? []

    if (models.length === 0) {
      log.info("LiteLLM endpoint returned no models", { baseURL })
      return { autoload: false }
    }

    log.info("LiteLLM autodiscovered", { baseURL, modelCount: models.length, models: models.map(m => m.id) })

    // Inject discovered models into the provider
    for (const model of models) {
      if (!provider.models[model.id]) {
        provider.models[model.id] = {
          id: model.id,
          name: model.id,
          cost: { input: 0, output: 0 },
        } as any
      }
    }

    return {
      autoload: true,
      options: {
        baseURL,
        ...(apiKey && { apiKey }),
      },
      async getModel(sdk: any, modelID: string) {
        return sdk.languageModel(modelID)
      },
    }
  } catch (e) {
    if ((e as any)?.name === "AbortError") {
      log.info("LiteLLM autodiscovery timed out", { baseURL })
    } else {
      log.info("LiteLLM not available", { baseURL, error: (e as Error).message })
    }
    return { autoload: false }
  }
}
