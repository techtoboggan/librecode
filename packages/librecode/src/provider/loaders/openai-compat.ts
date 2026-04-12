/**
 * Loaders for OpenAI-compatible providers (OpenAI, GitHub Copilot, Azure).
 */

import { iife } from "@/util/iife"
import { Env } from "../../env"
import type { CustomLoader } from "./types"

/** Detect if a model should use OpenAI Responses API (v5+) */
function shouldUseCopilotResponsesApi(modelID: string) {
  const match = modelID.match(/^(?:o|gpt)-(\d+)/)
  if (!match) return false
  return parseInt(match[1], 10) >= 5
}

function useLanguageModel(sdk: any) {
  return sdk.responses === undefined && sdk.chat === undefined
}

export const openai: CustomLoader = async () => ({
  autoload: false,
  async getModel(sdk: any, modelID: string) {
    return sdk.responses(modelID)
  },
  options: {},
})

export const githubCopilot: CustomLoader = async () => ({
  autoload: false,
  async getModel(sdk: any, modelID: string) {
    if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
    return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID)
  },
  options: {},
})

export const githubCopilotEnterprise: CustomLoader = async () => ({
  autoload: false,
  async getModel(sdk: any, modelID: string) {
    if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
    return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID)
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
    async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
      if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
      if (options?.useCompletionUrls) {
        return sdk.chat(modelID)
      } else {
        return sdk.responses(modelID)
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
    async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
      if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
      if (options?.useCompletionUrls) {
        return sdk.chat(modelID)
      } else {
        return sdk.responses(modelID)
      }
    },
    options: {
      baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
    },
  }
}
