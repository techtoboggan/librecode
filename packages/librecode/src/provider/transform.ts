import type { ModelMessage, TextPart, ImagePart, FilePart } from "ai"
import { mergeDeep, unique } from "remeda"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"
import type { Provider } from "./provider"
import { Flag } from "@/flag/flag"
import {
  filterAnthropicEmptyMessages,
  sanitizeClaudeToolCallIds,
  isMistralModel,
  normalizeMistralMessages,
  normalizeInterleavedReasoning,
  filterUnsupportedPart,
  remapProviderOptionsKeys,
} from "./transform-input"
import {
  checkIsAnthropicAdaptive,
  isNonVariantModel,
  buildGrokVariants,
  buildOpenrouterVariants,
  buildGatewayVariants,
  buildGithubCopilotVariants,
  buildAzureVariants,
  buildOpenAIVariants,
  buildAnthropicVariants,
  buildBedrockVariants,
  buildGoogleVariants,
  buildGroqVariants,
  buildSapVariants,
  applyOpenAIStoreOption,
  applyOpenrouterOptions,
  applyBasetenOptions,
  applyZhipuOptions,
  applyPromptCacheKeyOption,
  applyGoogleThinkingOptions,
  applyKimiAnthropicThinkingOptions,
  applyAlibabaCnThinkingOptions,
  applyGpt5Options,
  applyVeniceOptions,
  applyOpenrouterCacheOptions,
  applyGatewayOptions,
  buildOpenAISmallOptions,
  buildGoogleSmallOptions,
  buildOpenrouterSmallOptions,
  sanitizeGeminiSchema,
} from "./transform-output"

export namespace ProviderTransform {
  export const OUTPUT_TOKEN_MAX = Flag.LIBRECODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  // Maps npm package to the key the AI SDK expects for providerOptions
  function sdkKey(npm: string): string | undefined {
    switch (npm) {
      case "@ai-sdk/github-copilot":
        return "copilot"
      case "@ai-sdk/openai":
      case "@ai-sdk/azure":
        return "openai"
      case "@ai-sdk/amazon-bedrock":
        return "bedrock"
      case "@ai-sdk/anthropic":
      case "@ai-sdk/google-vertex/anthropic":
        return "anthropic"
      case "@ai-sdk/google-vertex":
      case "@ai-sdk/google":
        return "google"
      case "@ai-sdk/gateway":
        return "gateway"
      case "@openrouter/ai-sdk-provider":
        return "openrouter"
    }
    return undefined
  }

  function normalizeMessages(
    msgs: ModelMessage[],
    model: Provider.Model,
    options: Record<string, unknown>,
  ): ModelMessage[] {
    if (model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/amazon-bedrock") {
      msgs = filterAnthropicEmptyMessages(msgs)
    }

    if (model.api.id.includes("claude")) {
      return msgs.map((msg) => sanitizeClaudeToolCallIds(msg))
    }
    if (isMistralModel(model)) {
      return normalizeMistralMessages(msgs)
    }

    if (typeof model.capabilities.interleaved === "object" && model.capabilities.interleaved.field) {
      return normalizeInterleavedReasoning(msgs, model.capabilities.interleaved.field)
    }

    return msgs
  }

  function applyCaching(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
    const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

    const providerOptions = {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
      openrouter: {
        cacheControl: { type: "ephemeral" },
      },
      bedrock: {
        cachePoint: { type: "default" },
      },
      openaiCompatible: {
        cache_control: { type: "ephemeral" },
      },
      copilot: {
        copilot_cache_control: { type: "ephemeral" },
      },
    }

    for (const msg of unique([...system, ...final])) {
      const useMessageLevelOptions = model.providerID === "anthropic" || model.providerID.includes("bedrock")
      const shouldUseContentOptions = !useMessageLevelOptions && Array.isArray(msg.content) && msg.content.length > 0

      if (shouldUseContentOptions) {
        const lastContent = msg.content[msg.content.length - 1]
        if (lastContent && typeof lastContent === "object") {
          lastContent.providerOptions = mergeDeep(lastContent.providerOptions ?? {}, providerOptions)
          continue
        }
      }

      msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions)
    }

    return msgs
  }

  function unsupportedParts(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    return msgs.map((msg) => {
      if (msg.role !== "user" || !Array.isArray(msg.content)) return msg
      const filtered = (msg.content as Array<TextPart | ImagePart | FilePart>).map((part) =>
        filterUnsupportedPart(part, model),
      )
      return { ...msg, content: filtered } as ModelMessage
    })
  }

  export function message(msgs: ModelMessage[], model: Provider.Model, options: Record<string, unknown>) {
    msgs = unsupportedParts(msgs, model)
    msgs = normalizeMessages(msgs, model, options)
    if (isAnthropicModel(model)) {
      msgs = applyCaching(msgs, model)
    }

    // Remap providerOptions keys from stored providerID to expected SDK key
    const key = sdkKey(model.api.npm)
    if (key && key !== model.providerID && model.api.npm !== "@ai-sdk/azure") {
      msgs = remapProviderOptionsKeys(msgs, model.providerID, key)
    }

    return msgs
  }

  export function temperature(model: Provider.Model) {
    const id = model.id.toLowerCase()
    if (id.includes("qwen")) return 0.55
    if (id.includes("claude")) return undefined
    if (id.includes("gemini")) return 1.0
    if (id.includes("glm-4.6")) return 1.0
    if (id.includes("glm-4.7")) return 1.0
    if (id.includes("minimax-m2")) return 1.0
    if (id.includes("kimi-k2")) {
      // kimi-k2-thinking & kimi-k2.5 && kimi-k2p5 && kimi-k2-5
      if (["thinking", "k2.", "k2p", "k2-5"].some((s) => id.includes(s))) {
        return 1.0
      }
      return 0.6
    }
    return undefined
  }

  export function topP(model: Provider.Model) {
    const id = model.id.toLowerCase()
    if (id.includes("qwen")) return 1
    if (["minimax-m2", "gemini", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((s) => id.includes(s))) {
      return 0.95
    }
    return undefined
  }

  export function topK(model: Provider.Model) {
    const id = model.id.toLowerCase()
    if (id.includes("minimax-m2")) {
      if (["m2.", "m25", "m21"].some((s) => id.includes(s))) return 40
      return 20
    }
    if (id.includes("gemini")) return 64
    return undefined
  }

  const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
  const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

  export function variants(model: Provider.Model): Record<string, Record<string, unknown>> {
    if (!model.capabilities.reasoning) return {}

    const id = model.id.toLowerCase()
    const isAnthropicAdaptive = checkIsAnthropicAdaptive(model)
    const adaptiveEfforts = ["low", "medium", "high", "max"]

    if (isNonVariantModel(id)) return {}
    if (id.includes("grok")) return buildGrokVariants(id, model)

    switch (model.api.npm) {
      case "@openrouter/ai-sdk-provider":
        return buildOpenrouterVariants(model)

      case "@ai-sdk/gateway":
        return buildGatewayVariants(model, id, isAnthropicAdaptive, adaptiveEfforts)

      case "@ai-sdk/github-copilot":
        return buildGithubCopilotVariants(model, id)

      case "@ai-sdk/cerebras":
      // https://v5.ai-sdk.dev/providers/ai-sdk-providers/cerebras
      case "@ai-sdk/togetherai":
      // https://v5.ai-sdk.dev/providers/ai-sdk-providers/togetherai
      case "@ai-sdk/xai":
      // https://v5.ai-sdk.dev/providers/ai-sdk-providers/xai
      case "@ai-sdk/deepinfra":
      // https://v5.ai-sdk.dev/providers/ai-sdk-providers/deepinfra
      case "venice-ai-sdk-provider":
      // https://docs.venice.ai/overview/guides/reasoning-models#reasoning-effort
      case "@ai-sdk/openai-compatible":
        return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      case "@ai-sdk/azure":
        return buildAzureVariants(id)

      case "@ai-sdk/openai":
        return buildOpenAIVariants(model, id)

      case "@ai-sdk/anthropic":
      // https://v5.ai-sdk.dev/providers/ai-sdk-providers/anthropic
      case "@ai-sdk/google-vertex/anthropic":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/google-vertex#anthropic-provider
        return buildAnthropicVariants(model, isAnthropicAdaptive, adaptiveEfforts)

      case "@ai-sdk/amazon-bedrock":
        return buildBedrockVariants(model, isAnthropicAdaptive, adaptiveEfforts)

      case "@ai-sdk/google-vertex":
      // https://v5.ai-sdk.dev/providers/ai-sdk-providers/google-vertex
      case "@ai-sdk/google":
        return buildGoogleVariants(id)

      case "@ai-sdk/mistral":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/mistral
        return {}

      case "@ai-sdk/cohere":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/cohere
        return {}

      case "@ai-sdk/groq":
        return buildGroqVariants()

      case "@ai-sdk/perplexity":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/perplexity
        return {}

      case "@jerome-benoit/sap-ai-provider-v2":
        return buildSapVariants(model, id, isAnthropicAdaptive, adaptiveEfforts)
    }
    return {}
  }

  export function options(input: {
    model: Provider.Model
    sessionID: string
    providerOptions?: Record<string, unknown>
  }): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    applyOpenAIStoreOption(result, input.model)
    applyOpenrouterOptions(result, input.model)
    applyBasetenOptions(result, input.model)
    applyZhipuOptions(result, input.model)
    applyPromptCacheKeyOption(result, input.model, input.sessionID, input.providerOptions)
    applyGoogleThinkingOptions(result, input.model)
    applyKimiAnthropicThinkingOptions(result, input.model)
    applyAlibabaCnThinkingOptions(result, input.model)
    applyGpt5Options(result, input.model)
    applyVeniceOptions(result, input.model, input.sessionID)
    applyOpenrouterCacheOptions(result, input.model, input.sessionID)
    applyGatewayOptions(result, input.model)

    return result
  }

  export function smallOptions(model: Provider.Model) {
    if (
      model.providerID === "openai" ||
      model.api.npm === "@ai-sdk/openai" ||
      model.api.npm === "@ai-sdk/github-copilot"
    ) {
      return buildOpenAISmallOptions(model)
    }
    if (model.providerID === "google") {
      return buildGoogleSmallOptions(model)
    }
    if (model.providerID === "openrouter") {
      return buildOpenrouterSmallOptions(model)
    }
    if (model.providerID === "venice") {
      return { veniceParameters: { disableThinking: true } }
    }
    return {}
  }

  // Maps model ID prefix to provider slug used in providerOptions.
  // Example: "amazon/nova-2-lite" → "bedrock"
  const SLUG_OVERRIDES: Record<string, string> = {
    amazon: "bedrock",
  }

  export function providerOptions(model: Provider.Model, options: { [x: string]: unknown }) {
    if (model.api.npm === "@ai-sdk/gateway") {
      return buildGatewayProviderOptions(model, options)
    }

    const key = sdkKey(model.api.npm) ?? model.providerID
    return { [key]: options }
  }

  export function maxOutputTokens(model: Provider.Model): number {
    return Math.min(model.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX
  }

  export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema | JSONSchema7): JSONSchema7 {
    /*
    if (["openai", "azure"].includes(providerID)) {
      if (schema.type === "object" && schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          if (schema.required?.includes(key)) continue
          schema.properties[key] = {
            anyOf: [
              value as JSONSchema.JSONSchema,
              {
                type: "null",
              },
            ],
          }
        }
      }
    }
    */

    // Convert integer enums to string enums for Google/Gemini
    if (model.providerID === "google" || model.api.id.includes("gemini")) {
      schema = sanitizeGeminiSchema(schema) as JSONSchema.BaseSchema | JSONSchema7
    }

    return schema as JSONSchema7
  }

  // --- Private helpers inside namespace (thin wrappers only) ---

  function isAnthropicModel(model: Provider.Model): boolean {
    return (
      (model.providerID === "anthropic" ||
        model.api.id.includes("anthropic") ||
        model.api.id.includes("claude") ||
        model.id.includes("anthropic") ||
        model.id.includes("claude") ||
        model.api.npm === "@ai-sdk/anthropic") &&
      model.api.npm !== "@ai-sdk/gateway"
    )
  }

  function buildGatewayProviderOptions(
    model: Provider.Model,
    opts: { [x: string]: unknown },
  ): Record<string, unknown> {
    const i = model.api.id.indexOf("/")
    const rawSlug = i > 0 ? model.api.id.slice(0, i) : undefined
    const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined
    const gateway = opts.gateway
    const rest = Object.fromEntries(Object.entries(opts).filter(([k]) => k !== "gateway"))
    const has = Object.keys(rest).length > 0

    const result: Record<string, unknown> = {}
    if (gateway !== undefined) result.gateway = gateway

    if (has) {
      if (slug) {
        result[slug] = rest
      } else if (gateway && typeof gateway === "object" && !Array.isArray(gateway)) {
        result.gateway = { ...gateway, ...rest }
      } else {
        result.gateway = rest
      }
    }

    return result
  }
}
