import type { Provider } from "./provider"
import { iife } from "@/util/iife"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"

const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

// ---------------------------------------------------------------------------
// Variant builder helpers
// ---------------------------------------------------------------------------

export function checkIsAnthropicAdaptive(model: Provider.Model): boolean {
  return ["opus-4-6", "opus-4.6", "sonnet-4-6", "sonnet-4.6"].some((v) => model.api.id.includes(v))
}

export function isNonVariantModel(id: string): boolean {
  return (
    id.includes("deepseek") ||
    id.includes("minimax") ||
    id.includes("glm") ||
    id.includes("mistral") ||
    id.includes("kimi") ||
    // TODO: Remove this after models.dev data is fixed to use "kimi-k2.5" instead of "k2p5"
    id.includes("k2p5")
  )
}

export function buildGrokVariants(id: string, model: Provider.Model): Record<string, Record<string, unknown>> {
  // see: https://docs.x.ai/docs/guides/reasoning#control-how-hard-the-model-thinks
  if (!id.includes("grok-3-mini")) return {}
  if (model.api.npm === "@openrouter/ai-sdk-provider") {
    return {
      low: { reasoning: { effort: "low" } },
      high: { reasoning: { effort: "high" } },
    }
  }
  return {
    low: { reasoningEffort: "low" },
    high: { reasoningEffort: "high" },
  }
}

export function buildOpenrouterVariants(model: Provider.Model): Record<string, Record<string, unknown>> {
  if (!model.id.includes("gpt") && !model.id.includes("gemini-3") && !model.id.includes("claude")) return {}
  return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoning: { effort } }]))
}

export function buildGatewayAnthropicVariants(
  model: Provider.Model,
  isAnthropicAdaptive: boolean,
  adaptiveEfforts: string[],
): Record<string, Record<string, unknown>> {
  if (isAnthropicAdaptive) {
    return Object.fromEntries(adaptiveEfforts.map((effort) => [effort, { thinking: { type: "adaptive" }, effort }]))
  }
  return {
    high: { thinking: { type: "enabled", budgetTokens: 16000 } },
    max: { thinking: { type: "enabled", budgetTokens: 31999 } },
  }
}

export function buildGatewayGoogleVariants(id: string): Record<string, Record<string, unknown>> {
  if (id.includes("2.5")) {
    return {
      high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
      max: { thinkingConfig: { includeThoughts: true, thinkingBudget: 24576 } },
    }
  }
  return Object.fromEntries(["low", "high"].map((effort) => [effort, { includeThoughts: true, thinkingLevel: effort }]))
}

export function buildGatewayVariants(
  model: Provider.Model,
  id: string,
  isAnthropicAdaptive: boolean,
  adaptiveEfforts: string[],
): Record<string, Record<string, unknown>> {
  if (model.id.includes("anthropic")) {
    return buildGatewayAnthropicVariants(model, isAnthropicAdaptive, adaptiveEfforts)
  }
  if (model.id.includes("google")) {
    return buildGatewayGoogleVariants(id)
  }
  return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
}

export function buildGithubCopilotVariants(model: Provider.Model, id: string): Record<string, Record<string, unknown>> {
  if (model.id.includes("gemini")) {
    // currently github copilot only returns thinking
    return {}
  }
  if (model.id.includes("claude")) {
    return { thinking: { thinking_budget: 4000 } }
  }
  const copilotEfforts = iife(() => {
    if (id.includes("5.1-codex-max") || id.includes("5.2") || id.includes("5.3"))
      return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
    const arr = [...WIDELY_SUPPORTED_EFFORTS]
    if (id.includes("gpt-5") && model.release_date >= "2025-12-04") arr.push("xhigh")
    return arr
  })
  return Object.fromEntries(
    copilotEfforts.map((effort) => [
      effort,
      {
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    ]),
  )
}

export function buildAzureVariants(id: string): Record<string, Record<string, unknown>> {
  // https://v5.ai-sdk.dev/providers/ai-sdk-providers/azure
  if (id === "o1-mini") return {}
  const azureEfforts = ["low", "medium", "high"]
  if (id.includes("gpt-5-") || id === "gpt-5") {
    azureEfforts.unshift("minimal")
  }
  return Object.fromEntries(
    azureEfforts.map((effort) => [
      effort,
      {
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    ]),
  )
}

function buildOpenAIEfforts(model: Provider.Model, id: string): string[] {
  if (id.includes("codex")) {
    if (id.includes("5.2") || id.includes("5.3")) return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
    return WIDELY_SUPPORTED_EFFORTS
  }
  const arr = [...WIDELY_SUPPORTED_EFFORTS]
  if (id.includes("gpt-5-") || id === "gpt-5") arr.unshift("minimal")
  if (model.release_date >= "2025-11-13") arr.unshift("none")
  if (model.release_date >= "2025-12-04") arr.push("xhigh")
  return arr
}

export function buildOpenAIVariants(model: Provider.Model, id: string): Record<string, Record<string, unknown>> {
  // https://v5.ai-sdk.dev/providers/ai-sdk-providers/openai
  if (id === "gpt-5-pro") return {}
  const efforts = buildOpenAIEfforts(model, id)
  return Object.fromEntries(
    efforts.map((effort) => [
      effort,
      {
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    ]),
  )
}

export function buildAnthropicVariants(
  model: Provider.Model,
  isAnthropicAdaptive: boolean,
  adaptiveEfforts: string[],
): Record<string, Record<string, unknown>> {
  if (isAnthropicAdaptive) {
    return Object.fromEntries(adaptiveEfforts.map((effort) => [effort, { thinking: { type: "adaptive" }, effort }]))
  }
  return {
    high: {
      thinking: {
        type: "enabled",
        budgetTokens: Math.min(16_000, Math.floor(model.limit.output / 2 - 1)),
      },
    },
    max: {
      thinking: {
        type: "enabled",
        budgetTokens: Math.min(31_999, model.limit.output - 1),
      },
    },
  }
}

export function buildBedrockVariants(
  model: Provider.Model,
  isAnthropicAdaptive: boolean,
  adaptiveEfforts: string[],
): Record<string, Record<string, unknown>> {
  // https://v5.ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock
  if (isAnthropicAdaptive) {
    return Object.fromEntries(
      adaptiveEfforts.map((effort) => [effort, { reasoningConfig: { type: "adaptive", maxReasoningEffort: effort } }]),
    )
  }
  // For Anthropic models on Bedrock, use reasoningConfig with budgetTokens
  if (model.api.id.includes("anthropic")) {
    return {
      high: { reasoningConfig: { type: "enabled", budgetTokens: 16000 } },
      max: { reasoningConfig: { type: "enabled", budgetTokens: 31999 } },
    }
  }
  // For Amazon Nova models, use reasoningConfig with maxReasoningEffort
  return Object.fromEntries(
    WIDELY_SUPPORTED_EFFORTS.map((effort) => [
      effort,
      { reasoningConfig: { type: "enabled", maxReasoningEffort: effort } },
    ]),
  )
}

export function buildGoogleVariants(id: string): Record<string, Record<string, unknown>> {
  // https://v5.ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
  if (id.includes("2.5")) {
    return {
      high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
      max: { thinkingConfig: { includeThoughts: true, thinkingBudget: 24576 } },
    }
  }
  let levels = ["low", "high"]
  if (id.includes("3.1")) {
    levels = ["low", "medium", "high"]
  }
  return Object.fromEntries(
    levels.map((effort) => [effort, { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }]),
  )
}

export function buildGroqVariants(): Record<string, Record<string, unknown>> {
  // https://v5.ai-sdk.dev/providers/ai-sdk-providers/groq
  const groqEffort = ["none", ...WIDELY_SUPPORTED_EFFORTS]
  return Object.fromEntries(groqEffort.map((effort) => [effort, { reasoningEffort: effort }]))
}

function buildSapAnthropicVariants(
  isAnthropicAdaptive: boolean,
  adaptiveEfforts: string[],
): Record<string, Record<string, unknown>> {
  if (isAnthropicAdaptive) {
    return Object.fromEntries(adaptiveEfforts.map((effort) => [effort, { thinking: { type: "adaptive" }, effort }]))
  }
  return {
    high: { thinking: { type: "enabled", budgetTokens: 16000 } },
    max: { thinking: { type: "enabled", budgetTokens: 31999 } },
  }
}

export function buildSapVariants(
  model: Provider.Model,
  id: string,
  isAnthropicAdaptive: boolean,
  adaptiveEfforts: string[],
): Record<string, Record<string, unknown>> {
  if (model.api.id.includes("anthropic")) {
    return buildSapAnthropicVariants(isAnthropicAdaptive, adaptiveEfforts)
  }
  if (model.api.id.includes("gemini") && id.includes("2.5")) {
    return {
      high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
      max: { thinkingConfig: { includeThoughts: true, thinkingBudget: 24576 } },
    }
  }
  if (model.api.id.includes("gpt") || /\bo[1-9]/.test(model.api.id)) {
    return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
  }
  return {}
}

// ---------------------------------------------------------------------------
// options() sub-helpers
// ---------------------------------------------------------------------------

export function applyOpenAIStoreOption(result: Record<string, unknown>, model: Provider.Model): void {
  if (
    model.providerID === "openai" ||
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/github-copilot"
  ) {
    result["store"] = false
  }
}

export function applyOpenrouterOptions(result: Record<string, unknown>, model: Provider.Model): void {
  if (model.api.npm !== "@openrouter/ai-sdk-provider") return
  result["usage"] = { include: true }
  if (model.api.id.includes("gemini-3")) {
    result["reasoning"] = { effort: "high" }
  }
}

export function applyBasetenOptions(result: Record<string, unknown>, model: Provider.Model): void {
  if (model.providerID === "baseten") {
    result["chat_template_args"] = { enable_thinking: true }
  }
}

export function applyZhipuOptions(result: Record<string, unknown>, model: Provider.Model): void {
  if (["zai", "zhipuai"].includes(model.providerID) && model.api.npm === "@ai-sdk/openai-compatible") {
    result["thinking"] = { type: "enabled", clear_thinking: false }
  }
}

export function applyPromptCacheKeyOption(
  result: Record<string, unknown>,
  model: Provider.Model,
  sessionID: string,
  providerOptions?: Record<string, unknown>,
): void {
  if (model.providerID === "openai" || providerOptions?.setCacheKey) {
    result["promptCacheKey"] = sessionID
  }
}

export function applyGoogleThinkingOptions(result: Record<string, unknown>, model: Provider.Model): void {
  if (model.api.npm !== "@ai-sdk/google" && model.api.npm !== "@ai-sdk/google-vertex") return
  result["thinkingConfig"] = { includeThoughts: true }
  if (model.api.id.includes("gemini-3")) {
    ;(result["thinkingConfig"] as Record<string, unknown>)["thinkingLevel"] = "high"
  }
}

export function applyKimiAnthropicThinkingOptions(result: Record<string, unknown>, model: Provider.Model): void {
  // Enable thinking by default for kimi-k2.5/k2p5 models using anthropic SDK
  const modelId = model.api.id.toLowerCase()
  if (
    (model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/google-vertex/anthropic") &&
    (modelId.includes("k2p5") || modelId.includes("kimi-k2.5") || modelId.includes("kimi-k2p5"))
  ) {
    result["thinking"] = {
      type: "enabled",
      budgetTokens: Math.min(16_000, Math.floor(model.limit.output / 2 - 1)),
    }
  }
}

export function applyAlibabaCnThinkingOptions(result: Record<string, unknown>, model: Provider.Model): void {
  // Enable thinking for reasoning models on alibaba-cn (DashScope).
  // DashScope's OpenAI-compatible API requires `enable_thinking: true` in the request body
  // to return reasoning_content. Without it, models like kimi-k2.5, qwen-plus, qwen3, qwq,
  // deepseek-r1, etc. never output thinking/reasoning tokens.
  // Note: kimi-k2-thinking is excluded as it returns reasoning_content by default.
  const modelId = model.api.id.toLowerCase()
  if (
    model.providerID === "alibaba-cn" &&
    model.capabilities.reasoning &&
    model.api.npm === "@ai-sdk/openai-compatible" &&
    !modelId.includes("kimi-k2-thinking")
  ) {
    result["enable_thinking"] = true
  }
}

export function applyGpt5Options(result: Record<string, unknown>, model: Provider.Model): void {
  if (!model.api.id.includes("gpt-5") || model.api.id.includes("gpt-5-chat")) return
  if (!model.api.id.includes("gpt-5-pro")) {
    result["reasoningEffort"] = "medium"
    result["reasoningSummary"] = "auto"
  }
  // Only set textVerbosity for non-chat gpt-5.x models
  // Chat models (e.g. gpt-5.2-chat-latest) only support "medium" verbosity
  if (
    model.api.id.includes("gpt-5.") &&
    !model.api.id.includes("codex") &&
    !model.api.id.includes("-chat") &&
    model.providerID !== "azure"
  ) {
    result["textVerbosity"] = "low"
  }
}

export function applyVeniceOptions(result: Record<string, unknown>, model: Provider.Model, sessionID: string): void {
  if (model.providerID === "venice") {
    result["promptCacheKey"] = sessionID
  }
}

export function applyOpenrouterCacheOptions(
  result: Record<string, unknown>,
  model: Provider.Model,
  sessionID: string,
): void {
  if (model.providerID === "openrouter") {
    result["prompt_cache_key"] = sessionID
  }
}

export function applyGatewayOptions(result: Record<string, unknown>, model: Provider.Model): void {
  if (model.api.npm === "@ai-sdk/gateway") {
    result["gateway"] = { caching: "auto" }
  }
}

// ---------------------------------------------------------------------------
// smallOptions helpers
// ---------------------------------------------------------------------------

export function buildOpenAISmallOptions(model: Provider.Model): Record<string, unknown> {
  if (model.api.id.includes("gpt-5")) {
    if (model.api.id.includes("5.")) return { store: false, reasoningEffort: "low" }
    return { store: false, reasoningEffort: "minimal" }
  }
  return { store: false }
}

export function buildGoogleSmallOptions(model: Provider.Model): Record<string, unknown> {
  // gemini-3 uses thinkingLevel, gemini-2.5 uses thinkingBudget
  if (model.api.id.includes("gemini-3")) {
    return { thinkingConfig: { thinkingLevel: "minimal" } }
  }
  return { thinkingConfig: { thinkingBudget: 0 } }
}

export function buildOpenrouterSmallOptions(model: Provider.Model): Record<string, unknown> {
  if (model.api.id.includes("google")) {
    return { reasoning: { enabled: false } }
  }
  return { reasoningEffort: "minimal" }
}

// ---------------------------------------------------------------------------
// Gemini schema sanitization
// ---------------------------------------------------------------------------

function isPlainObject(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node)
}

function hasCombiner(node: unknown): boolean {
  return isPlainObject(node) && (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf))
}

function hasSchemaIntent(node: unknown): boolean {
  if (!isPlainObject(node)) return false
  if (hasCombiner(node)) return true
  return [
    "type",
    "properties",
    "items",
    "prefixItems",
    "enum",
    "const",
    "$ref",
    "additionalProperties",
    "patternProperties",
    "required",
    "not",
    "if",
    "then",
    "else",
  ].some((key) => key in node)
}

function sanitizeGeminiEnum(result: Record<string, unknown>, value: unknown[]): void {
  result["enum"] = value.map((v) => String(v))
  // If we have integer type with enum, change type to string
  if (result.type === "integer" || result.type === "number") {
    result.type = "string"
  }
}

function sanitizeGeminiObjectType(result: Record<string, unknown>): void {
  if (result.type === "object" && result.properties && Array.isArray(result.required)) {
    result.required = (result.required as string[]).filter(
      (field) => field in (result.properties as Record<string, unknown>),
    )
  }
}

function sanitizeGeminiArrayType(result: Record<string, unknown>): void {
  if (result.type !== "array" || hasCombiner(result)) return
  if (result.items == null) result.items = {}
  if (isPlainObject(result.items) && !hasSchemaIntent(result.items)) {
    result.items = { ...result.items, type: "string" }
  }
}

function sanitizeGeminiNonObjectType(result: Record<string, unknown>): void {
  if (result.type && result.type !== "object" && !hasCombiner(result)) {
    delete result.properties
    delete result.required
  }
}

export function sanitizeGeminiSchema(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj
  if (Array.isArray(obj)) return obj.map(sanitizeGeminiSchema)

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "enum" && Array.isArray(value)) {
      sanitizeGeminiEnum(result, value)
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeGeminiSchema(value)
    } else {
      result[key] = value
    }
  }

  sanitizeGeminiObjectType(result)
  sanitizeGeminiArrayType(result)
  sanitizeGeminiNonObjectType(result)

  return result
}
