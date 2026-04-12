import {
  type APICallError,
  InvalidResponseDataError,
  type LanguageModelV2,
  type LanguageModelV2CallWarning,
  type LanguageModelV2Content,
  type LanguageModelV2FinishReason,
  type LanguageModelV2StreamPart,
  type SharedV2ProviderMetadata,
} from "@ai-sdk/provider"
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  type FetchFunction,
  generateId,
  isParsableJson,
  type ParseResult,
  parseProviderOptions,
  postJsonToApi,
  type ResponseHandler,
} from "@ai-sdk/provider-utils"
import { z } from "zod/v4"
import { defaultOpenAICompatibleErrorStructure, type ProviderErrorStructure } from "../openai-compatible-error"
import { convertToOpenAICompatibleChatMessages } from "./convert-to-openai-compatible-chat-messages"
import { getResponseMetadata } from "./get-response-metadata"
import { mapOpenAICompatibleFinishReason } from "./map-openai-compatible-finish-reason"
import { type OpenAICompatibleChatModelId, openaiCompatibleProviderOptions } from "./openai-compatible-chat-options"
import type { MetadataExtractor } from "./openai-compatible-metadata-extractor"
import { prepareTools } from "./openai-compatible-prepare-tools"

export type OpenAICompatibleChatConfig = {
  provider: string
  headers: () => Record<string, string | undefined>
  url: (options: { modelId: string; path: string }) => string
  fetch?: FetchFunction
  includeUsage?: boolean
  // biome-ignore lint/suspicious/noExplicitAny: ProviderErrorStructure vendor generic requires any
  errorStructure?: ProviderErrorStructure<any>
  metadataExtractor?: MetadataExtractor

  /**
   * Whether the model supports structured outputs.
   */
  supportsStructuredOutputs?: boolean

  /**
   * The supported URLs for the model.
   */
  supportedUrls?: () => LanguageModelV2["supportedUrls"]
}

// ---------------------------------------------------------------------------
// Types shared between module-level helpers
// ---------------------------------------------------------------------------

type StreamToolCall = {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
  hasFinished: boolean
}

type StreamUsage = {
  completionTokens: number | undefined
  completionTokensDetails: {
    reasoningTokens: number | undefined
    acceptedPredictionTokens: number | undefined
    rejectedPredictionTokens: number | undefined
  }
  promptTokens: number | undefined
  promptTokensDetails: {
    cachedTokens: number | undefined
  }
  totalTokens: number | undefined
}

type StreamState = {
  toolCalls: StreamToolCall[]
  finishReason: LanguageModelV2FinishReason
  usage: StreamUsage
  isFirstChunk: boolean
  isActiveReasoning: boolean
  isActiveText: boolean
  reasoningOpaque: string | undefined
}

// ---------------------------------------------------------------------------
// doGenerate helpers
// ---------------------------------------------------------------------------

function buildGenerateContent(
  choice: z.infer<typeof OpenAICompatibleChatResponseSchema>["choices"][number],
): Array<LanguageModelV2Content> {
  const content: Array<LanguageModelV2Content> = []
  const opaqueMetadata = choice.message.reasoning_opaque
    ? { copilot: { reasoningOpaque: choice.message.reasoning_opaque } }
    : undefined

  const text = choice.message.content
  if (text != null && text.length > 0) {
    content.push({ type: "text", text, providerMetadata: opaqueMetadata })
  }

  const reasoning = choice.message.reasoning_text
  if (reasoning != null && reasoning.length > 0) {
    content.push({ type: "reasoning", text: reasoning, providerMetadata: opaqueMetadata })
  }

  if (choice.message.tool_calls != null) {
    for (const toolCall of choice.message.tool_calls) {
      content.push({
        type: "tool-call",
        toolCallId: toolCall.id ?? generateId(),
        toolName: toolCall.function.name,
        // biome-ignore lint/style/noNonNullAssertion: tool call arguments are always present in OpenAI chat responses
        input: toolCall.function.arguments!,
        providerMetadata: opaqueMetadata,
      })
    }
  }

  return content
}

function applyPredictionTokenMetadata(
  providerMetadata: SharedV2ProviderMetadata,
  providerOptionsName: string,
  completionTokenDetails:
    | {
        accepted_prediction_tokens?: number | null
        rejected_prediction_tokens?: number | null
      }
    | null
    | undefined,
): void {
  if (completionTokenDetails?.accepted_prediction_tokens != null) {
    providerMetadata[providerOptionsName].acceptedPredictionTokens = completionTokenDetails.accepted_prediction_tokens
  }
  if (completionTokenDetails?.rejected_prediction_tokens != null) {
    providerMetadata[providerOptionsName].rejectedPredictionTokens = completionTokenDetails.rejected_prediction_tokens
  }
}

// ---------------------------------------------------------------------------
// Stream chunk value type — the non-error branch of the chunk union
// TODO: lost type safety due to error schema generic (same caveat as original)
// ---------------------------------------------------------------------------

type StreamChunkValue = {
  id?: string | null
  created?: number | null
  model?: string | null
  choices: Array<{
    delta?: {
      role?: "assistant" | null
      content?: string | null
      reasoning_text?: string | null
      reasoning_opaque?: string | null
      tool_calls?: Array<{
        index: number
        id?: string | null
        function: { name?: string | null; arguments?: string | null }
      }> | null
    } | null
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number | null
    completion_tokens?: number | null
    total_tokens?: number | null
    prompt_tokens_details?: { cached_tokens?: number | null } | null
    completion_tokens_details?: {
      reasoning_tokens?: number | null
      accepted_prediction_tokens?: number | null
      rejected_prediction_tokens?: number | null
    } | null
  } | null
}

// ---------------------------------------------------------------------------
// doStream: usage accumulation helper
// ---------------------------------------------------------------------------

function accumulateStreamUsage(usage: StreamUsage, rawUsage: StreamChunkValue["usage"]): void {
  if (rawUsage == null) return
  const { prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details, completion_tokens_details } = rawUsage
  usage.promptTokens = prompt_tokens ?? undefined
  usage.completionTokens = completion_tokens ?? undefined
  usage.totalTokens = total_tokens ?? undefined
  if (completion_tokens_details?.reasoning_tokens != null) {
    usage.completionTokensDetails.reasoningTokens = completion_tokens_details.reasoning_tokens
  }
  if (completion_tokens_details?.accepted_prediction_tokens != null) {
    usage.completionTokensDetails.acceptedPredictionTokens = completion_tokens_details.accepted_prediction_tokens
  }
  if (completion_tokens_details?.rejected_prediction_tokens != null) {
    usage.completionTokensDetails.rejectedPredictionTokens = completion_tokens_details.rejected_prediction_tokens
  }
  if (prompt_tokens_details?.cached_tokens != null) {
    usage.promptTokensDetails.cachedTokens = prompt_tokens_details.cached_tokens
  }
}

// ---------------------------------------------------------------------------
// doStream: reasoning delta helper
// ---------------------------------------------------------------------------

function handleReasoningOpaque(delta: { reasoning_opaque?: string | null }, state: StreamState): void {
  if (!delta.reasoning_opaque) return
  if (state.reasoningOpaque != null) {
    throw new InvalidResponseDataError({
      data: delta,
      message:
        "Multiple reasoning_opaque values received in a single response. Only one thinking part per response is supported.",
    })
  }
  state.reasoningOpaque = delta.reasoning_opaque
}

function handleReasoningDelta(
  reasoningContent: string | null | undefined,
  state: StreamState,
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
): void {
  if (!reasoningContent) return
  if (!state.isActiveReasoning) {
    controller.enqueue({ type: "reasoning-start", id: "reasoning-0" })
    state.isActiveReasoning = true
  }
  controller.enqueue({ type: "reasoning-delta", id: "reasoning-0", delta: reasoningContent })
}

// ---------------------------------------------------------------------------
// doStream: text delta helper
// ---------------------------------------------------------------------------

function handleTextDelta(
  content: string | null | undefined,
  state: StreamState,
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
): void {
  if (!content) return
  const opaqueMetadata = state.reasoningOpaque ? { copilot: { reasoningOpaque: state.reasoningOpaque } } : undefined

  if (state.isActiveReasoning && !state.isActiveText) {
    controller.enqueue({ type: "reasoning-end", id: "reasoning-0", providerMetadata: opaqueMetadata })
    state.isActiveReasoning = false
  }

  if (!state.isActiveText) {
    controller.enqueue({ type: "text-start", id: "txt-0", providerMetadata: opaqueMetadata })
    state.isActiveText = true
  }

  controller.enqueue({ type: "text-delta", id: "txt-0", delta: content })
}

// ---------------------------------------------------------------------------
// doStream: tool call helpers
// ---------------------------------------------------------------------------

type ToolCallDelta = {
  index: number
  id?: string | null
  function: { name?: string | null; arguments?: string | null }
}

function initNewToolCall(
  toolCallDelta: ToolCallDelta,
  state: StreamState,
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
): void {
  if (toolCallDelta.id == null) {
    throw new InvalidResponseDataError({ data: toolCallDelta, message: `Expected 'id' to be a string.` })
  }
  if (toolCallDelta.function?.name == null) {
    throw new InvalidResponseDataError({ data: toolCallDelta, message: `Expected 'function.name' to be a string.` })
  }

  controller.enqueue({ type: "tool-input-start", id: toolCallDelta.id, toolName: toolCallDelta.function.name })

  const newCall: StreamToolCall = {
    id: toolCallDelta.id,
    type: "function",
    function: { name: toolCallDelta.function.name, arguments: toolCallDelta.function.arguments ?? "" },
    hasFinished: false,
  }
  state.toolCalls[toolCallDelta.index] = newCall

  if (newCall.function.arguments.length > 0) {
    controller.enqueue({ type: "tool-input-delta", id: newCall.id, delta: newCall.function.arguments })
  }

  if (isParsableJson(newCall.function.arguments)) {
    const opaqueMetadata = state.reasoningOpaque ? { copilot: { reasoningOpaque: state.reasoningOpaque } } : undefined
    controller.enqueue({ type: "tool-input-end", id: newCall.id })
    controller.enqueue({
      type: "tool-call",
      toolCallId: newCall.id ?? generateId(),
      toolName: newCall.function.name,
      input: newCall.function.arguments,
      providerMetadata: opaqueMetadata,
    })
    newCall.hasFinished = true
  }
}

function mergeExistingToolCall(
  toolCall: StreamToolCall,
  toolCallDelta: ToolCallDelta,
  state: StreamState,
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
): void {
  if (toolCall.hasFinished) return

  if (toolCallDelta.function?.arguments != null) {
    toolCall.function.arguments += toolCallDelta.function.arguments
  }

  controller.enqueue({
    type: "tool-input-delta",
    id: toolCall.id,
    delta: toolCallDelta.function.arguments ?? "",
  })

  if (
    toolCall.function?.name != null &&
    toolCall.function?.arguments != null &&
    isParsableJson(toolCall.function.arguments)
  ) {
    const opaqueMetadata = state.reasoningOpaque ? { copilot: { reasoningOpaque: state.reasoningOpaque } } : undefined
    controller.enqueue({ type: "tool-input-end", id: toolCall.id })
    controller.enqueue({
      type: "tool-call",
      toolCallId: toolCall.id ?? generateId(),
      toolName: toolCall.function.name,
      input: toolCall.function.arguments,
      providerMetadata: opaqueMetadata,
    })
    toolCall.hasFinished = true
  }
}

function handleToolCallDeltas(
  toolCallDeltas: ToolCallDelta[] | null | undefined,
  state: StreamState,
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
): void {
  if (toolCallDeltas == null) return

  if (state.isActiveReasoning) {
    const opaqueMetadata = state.reasoningOpaque ? { copilot: { reasoningOpaque: state.reasoningOpaque } } : undefined
    controller.enqueue({ type: "reasoning-end", id: "reasoning-0", providerMetadata: opaqueMetadata })
    state.isActiveReasoning = false
  }

  for (const toolCallDelta of toolCallDeltas) {
    const existing = state.toolCalls[toolCallDelta.index]
    if (existing == null) {
      initNewToolCall(toolCallDelta, state, controller)
    } else {
      mergeExistingToolCall(existing, toolCallDelta, state, controller)
    }
  }
}

// ---------------------------------------------------------------------------
// doStream: transform and flush helpers
// ---------------------------------------------------------------------------

function processStreamChunk(
  chunk: ParseResult<unknown>,
  state: StreamState,
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
  options: { includeRawChunks?: boolean },
  metadataExtractor: ReturnType<NonNullable<MetadataExtractor["createStreamExtractor"]>> | undefined,
): void {
  if (options.includeRawChunks) {
    controller.enqueue({ type: "raw", rawValue: chunk.rawValue })
  }

  if (!chunk.success) {
    state.finishReason = "error"
    controller.enqueue({ type: "error", error: chunk.error })
    return
  }

  // TODO: lost type safety on chunk.value due to error schema generic — same caveat as original
  const value = chunk.value as StreamChunkValue & { error?: { message: string } }
  metadataExtractor?.processChunk(chunk.rawValue)

  if ("error" in value && value.error != null) {
    state.finishReason = "error"
    controller.enqueue({ type: "error", error: value.error.message })
    return
  }

  if (state.isFirstChunk) {
    state.isFirstChunk = false
    controller.enqueue({ type: "response-metadata", ...getResponseMetadata(value) })
  }

  accumulateStreamUsage(state.usage, value.usage)

  const choice = value.choices[0]
  if (choice?.finish_reason != null) {
    state.finishReason = mapOpenAICompatibleFinishReason(choice.finish_reason)
  }
  if (choice?.delta == null) return

  const delta = choice.delta
  handleReasoningOpaque(delta, state)
  handleReasoningDelta(delta.reasoning_text, state, controller)
  handleTextDelta(delta.content, state, controller)
  handleToolCallDeltas(delta.tool_calls, state, controller)
}

function flushUnfinishedToolCalls(
  toolCalls: StreamToolCall[],
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
): void {
  for (const toolCall of toolCalls.filter((tc) => !tc.hasFinished)) {
    controller.enqueue({ type: "tool-input-end", id: toolCall.id })
    controller.enqueue({
      type: "tool-call",
      toolCallId: toolCall.id ?? generateId(),
      toolName: toolCall.function.name,
      input: toolCall.function.arguments,
    })
  }
}

function buildFlushProviderMetadata(
  providerOptionsName: string,
  usage: StreamUsage,
  reasoningOpaque: string | undefined,
  metadataExtractor: ReturnType<NonNullable<MetadataExtractor["createStreamExtractor"]>> | undefined,
): SharedV2ProviderMetadata {
  const providerMetadata: SharedV2ProviderMetadata = {
    [providerOptionsName]: {},
    ...(reasoningOpaque ? { copilot: { reasoningOpaque } } : {}),
    ...metadataExtractor?.buildMetadata(),
  }
  if (usage.completionTokensDetails.acceptedPredictionTokens != null) {
    providerMetadata[providerOptionsName].acceptedPredictionTokens =
      usage.completionTokensDetails.acceptedPredictionTokens
  }
  if (usage.completionTokensDetails.rejectedPredictionTokens != null) {
    providerMetadata[providerOptionsName].rejectedPredictionTokens =
      usage.completionTokensDetails.rejectedPredictionTokens
  }
  return providerMetadata
}

function flushStream(
  state: StreamState,
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
  providerOptionsName: string,
  metadataExtractor: ReturnType<NonNullable<MetadataExtractor["createStreamExtractor"]>> | undefined,
): void {
  if (state.isActiveReasoning) {
    const opaqueMetadata = state.reasoningOpaque ? { copilot: { reasoningOpaque: state.reasoningOpaque } } : undefined
    controller.enqueue({ type: "reasoning-end", id: "reasoning-0", providerMetadata: opaqueMetadata })
  }

  if (state.isActiveText) {
    controller.enqueue({ type: "text-end", id: "txt-0" })
  }

  flushUnfinishedToolCalls(state.toolCalls, controller)

  const providerMetadata = buildFlushProviderMetadata(
    providerOptionsName,
    state.usage,
    state.reasoningOpaque,
    metadataExtractor,
  )

  controller.enqueue({
    type: "finish",
    finishReason: state.finishReason,
    usage: {
      inputTokens: state.usage.promptTokens ?? undefined,
      outputTokens: state.usage.completionTokens ?? undefined,
      totalTokens: state.usage.totalTokens ?? undefined,
      reasoningTokens: state.usage.completionTokensDetails.reasoningTokens ?? undefined,
      cachedInputTokens: state.usage.promptTokensDetails.cachedTokens ?? undefined,
    },
    providerMetadata,
  })
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class OpenAICompatibleChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"

  readonly supportsStructuredOutputs: boolean

  readonly modelId: OpenAICompatibleChatModelId
  private readonly config: OpenAICompatibleChatConfig
  private readonly failedResponseHandler: ResponseHandler<APICallError>
  private readonly chunkSchema // type inferred via constructor

  constructor(modelId: OpenAICompatibleChatModelId, config: OpenAICompatibleChatConfig) {
    this.modelId = modelId
    this.config = config

    // initialize error handling:
    const errorStructure = config.errorStructure ?? defaultOpenAICompatibleErrorStructure
    this.chunkSchema = createOpenAICompatibleChatChunkSchema(errorStructure.errorSchema)
    this.failedResponseHandler = createJsonErrorResponseHandler(errorStructure)

    this.supportsStructuredOutputs = config.supportsStructuredOutputs ?? false
  }

  get provider(): string {
    return this.config.provider
  }

  private get providerOptionsName(): string {
    return this.config.provider.split(".")[0].trim()
  }

  get supportedUrls() {
    return this.config.supportedUrls?.() ?? {}
  }

  private async getArgs({
    prompt,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    providerOptions,
    stopSequences,
    responseFormat,
    seed,
    toolChoice,
    tools,
  }: Parameters<LanguageModelV2["doGenerate"]>[0]) {
    const warnings: LanguageModelV2CallWarning[] = []

    // Parse provider options
    const compatibleOptions = Object.assign(
      (await parseProviderOptions({
        provider: "copilot",
        providerOptions,
        schema: openaiCompatibleProviderOptions,
      })) ?? {},
      (await parseProviderOptions({
        provider: this.providerOptionsName,
        providerOptions,
        schema: openaiCompatibleProviderOptions,
      })) ?? {},
    )

    if (topK != null) {
      warnings.push({ type: "unsupported-setting", setting: "topK" })
    }

    if (responseFormat?.type === "json" && responseFormat.schema != null && !this.supportsStructuredOutputs) {
      warnings.push({
        type: "unsupported-setting",
        setting: "responseFormat",
        details: "JSON response format schema is only supported with structuredOutputs",
      })
    }

    const {
      tools: openaiTools,
      toolChoice: openaiToolChoice,
      toolWarnings,
    } = prepareTools({
      tools,
      toolChoice,
    })

    return {
      args: {
        // model id:
        model: this.modelId,

        // model specific settings:
        user: compatibleOptions.user,

        // standardized settings:
        max_tokens: maxOutputTokens,
        temperature,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        response_format:
          responseFormat?.type === "json"
            ? this.supportsStructuredOutputs === true && responseFormat.schema != null
              ? {
                  type: "json_schema",
                  json_schema: {
                    schema: responseFormat.schema,
                    name: responseFormat.name ?? "response",
                    description: responseFormat.description,
                  },
                }
              : { type: "json_object" }
            : undefined,

        stop: stopSequences,
        seed,
        ...Object.fromEntries(
          Object.entries(providerOptions?.[this.providerOptionsName] ?? {}).filter(
            ([key]) => !Object.keys(openaiCompatibleProviderOptions.shape).includes(key),
          ),
        ),

        reasoning_effort: compatibleOptions.reasoningEffort,
        verbosity: compatibleOptions.textVerbosity,

        // messages:
        messages: convertToOpenAICompatibleChatMessages(prompt),

        // tools:
        tools: openaiTools,
        tool_choice: openaiToolChoice,

        // thinking_budget
        thinking_budget: compatibleOptions.thinking_budget,
      },
      warnings: [...warnings, ...toolWarnings],
    }
  }

  async doGenerate(
    options: Parameters<LanguageModelV2["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const { args, warnings } = await this.getArgs({ ...options })

    const body = JSON.stringify(args)

    const {
      responseHeaders,
      value: responseBody,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: this.config.url({
        path: "/chat/completions",
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: this.failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(OpenAICompatibleChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const choice = responseBody.choices[0]
    const content = buildGenerateContent(choice)

    const providerMetadata: SharedV2ProviderMetadata = {
      [this.providerOptionsName]: {},
      ...(await this.config.metadataExtractor?.extractMetadata?.({
        parsedBody: rawResponse,
      })),
    }
    applyPredictionTokenMetadata(
      providerMetadata,
      this.providerOptionsName,
      responseBody.usage?.completion_tokens_details,
    )

    return {
      content,
      finishReason: mapOpenAICompatibleFinishReason(choice.finish_reason),
      usage: {
        inputTokens: responseBody.usage?.prompt_tokens ?? undefined,
        outputTokens: responseBody.usage?.completion_tokens ?? undefined,
        totalTokens: responseBody.usage?.total_tokens ?? undefined,
        reasoningTokens: responseBody.usage?.completion_tokens_details?.reasoning_tokens ?? undefined,
        cachedInputTokens: responseBody.usage?.prompt_tokens_details?.cached_tokens ?? undefined,
      },
      providerMetadata,
      request: { body },
      response: {
        ...getResponseMetadata(responseBody),
        headers: responseHeaders,
        body: rawResponse,
      },
      warnings,
    }
  }

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const { args, warnings } = await this.getArgs({ ...options })

    const body = {
      ...args,
      stream: true,

      // only include stream_options when in strict compatibility mode:
      stream_options: this.config.includeUsage ? { include_usage: true } : undefined,
    }

    const metadataExtractor = this.config.metadataExtractor?.createStreamExtractor()

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({
        path: "/chat/completions",
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: this.failedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(this.chunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const state: StreamState = {
      toolCalls: [],
      finishReason: "unknown",
      usage: {
        completionTokens: undefined,
        completionTokensDetails: {
          reasoningTokens: undefined,
          acceptedPredictionTokens: undefined,
          rejectedPredictionTokens: undefined,
        },
        promptTokens: undefined,
        promptTokensDetails: { cachedTokens: undefined },
        totalTokens: undefined,
      },
      isFirstChunk: true,
      isActiveReasoning: false,
      isActiveText: false,
      reasoningOpaque: undefined,
    }

    const providerOptionsName = this.providerOptionsName

    return {
      stream: response.pipeThrough(
        new TransformStream<ParseResult<z.infer<typeof this.chunkSchema>>, LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings })
          },

          // TODO we lost type safety on Chunk, most likely due to the error schema. MUST FIX
          transform(chunk, controller) {
            processStreamChunk(chunk, state, controller, options, metadataExtractor)
          },

          flush(controller) {
            flushStream(state, controller, providerOptionsName, metadataExtractor)
          },
        }),
      ),
      request: { body },
      response: { headers: responseHeaders },
    }
  }
}

const openaiCompatibleTokenUsageSchema = z
  .object({
    prompt_tokens: z.number().nullish(),
    completion_tokens: z.number().nullish(),
    total_tokens: z.number().nullish(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().nullish(),
      })
      .nullish(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: z.number().nullish(),
        accepted_prediction_tokens: z.number().nullish(),
        rejected_prediction_tokens: z.number().nullish(),
      })
      .nullish(),
  })
  .nullish()

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const OpenAICompatibleChatResponseSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal("assistant").nullish(),
        content: z.string().nullish(),
        // Copilot-specific reasoning fields
        reasoning_text: z.string().nullish(),
        reasoning_opaque: z.string().nullish(),
        tool_calls: z
          .array(
            z.object({
              id: z.string().nullish(),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            }),
          )
          .nullish(),
      }),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: openaiCompatibleTokenUsageSchema,
})

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const createOpenAICompatibleChatChunkSchema = <ERROR_SCHEMA extends z.core.$ZodType>(errorSchema: ERROR_SCHEMA) =>
  z.union([
    z.object({
      id: z.string().nullish(),
      created: z.number().nullish(),
      model: z.string().nullish(),
      choices: z.array(
        z.object({
          delta: z
            .object({
              role: z.enum(["assistant"]).nullish(),
              content: z.string().nullish(),
              // Copilot-specific reasoning fields
              reasoning_text: z.string().nullish(),
              reasoning_opaque: z.string().nullish(),
              tool_calls: z
                .array(
                  z.object({
                    index: z.number(),
                    id: z.string().nullish(),
                    function: z.object({
                      name: z.string().nullish(),
                      arguments: z.string().nullish(),
                    }),
                  }),
                )
                .nullish(),
            })
            .nullish(),
          finish_reason: z.string().nullish(),
        }),
      ),
      usage: openaiCompatibleTokenUsageSchema,
    }),
    errorSchema,
  ])
