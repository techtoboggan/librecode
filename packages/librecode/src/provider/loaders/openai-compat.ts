/**
 * Loaders for OpenAI-compatible providers (OpenAI, GitHub Copilot, Azure).
 */

import type { LanguageModelV2 } from "@ai-sdk/provider"
import { iife } from "@/util/iife"
import { Env } from "../../env"
import type { CustomLoader } from "./types"

/** Detect if a model should use OpenAI Responses API (v5+) */
function shouldUseCopilotResponsesApi(modelID: string) {
  const match = modelID.match(/^(?:o|gpt)-(\d+)/)
  if (!match) return false
  return parseInt(match[1], 10) >= 5
}

type SdkLike = {
  responses?: (modelID: string) => LanguageModelV2
  chat?: (modelID: string) => LanguageModelV2
  languageModel?: (modelID: string) => LanguageModelV2
}

function useLanguageModel(sdk: SdkLike) {
  return sdk.responses === undefined && sdk.chat === undefined
}

export const openai: CustomLoader = async () => ({
  autoload: false,
  async getModel(sdk: unknown, modelID: string) {
    return (sdk as SdkLike).responses!(modelID)  },
  options: {},
})

export const githubCopilot: CustomLoader = async () => ({
  autoload: false,
  async getModel(sdk: unknown, modelID: string) {
    const s = sdk as SdkLike
    if (useLanguageModel(s)) return s.languageModel!(modelID)
    return shouldUseCopilotResponsesApi(modelID) ? s.responses!(modelID) : s.chat!(modelID)
  },
  options: {},
})

export const githubCopilotEnterprise: CustomLoader = async () => ({
  autoload: false,
  async getModel(sdk: unknown, modelID: string) {
    const s = sdk as SdkLike
    if (useLanguageModel(s)) return s.languageModel!(modelID)
    return shouldUseCopilotResponsesApi(modelID) ? s.responses!(modelID) : s.chat!(modelID)
  },
  options: {},
})

export const azure: CustomLoader = async (provider) => {
  const resource = iife(() => {
    const name = provider.options?.resourceName
    if (typeof name === "string" && name.trim() !== "") return name
    return Env.get("AZURE_RESOURCE_NAME")
  })

  return {
    autoload: false,
    async getModel(sdk: unknown, modelID: string, options?: Record<string, unknown>) {
      const s = sdk as SdkLike
      if (useLanguageModel(s)) return s.languageModel!(modelID)
      if (options?.useCompletionUrls) {
        return s.chat!(modelID)
      } else {
        return s.responses!(modelID)
      }
    },
    options: {},
    vars() {
      return {
        ...(resource && { AZURE_RESOURCE_NAME: resource }),
      }
    },
  }
}

export const azureCognitiveServices: CustomLoader = async () => {
  const resourceName = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
  return {
    autoload: false,
    async getModel(sdk: unknown, modelID: string, options?: Record<string, unknown>) {
      const s = sdk as SdkLike
      if (useLanguageModel(s)) return s.languageModel!(modelID)
      if (options?.useCompletionUrls) {
        return s.chat!(modelID)
      } else {
        return s.responses!(modelID)
      }
    },
    options: {
      baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
    },
  }
}
