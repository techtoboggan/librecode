import {
  type LanguageModelV2CallOptions,
  type LanguageModelV2CallWarning,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider"
import type { OpenAIResponsesTool } from "./openai-responses-api-types"
import { codeInterpreterArgsSchema } from "./tool/code-interpreter"
import { fileSearchArgsSchema } from "./tool/file-search"
import { imageGenerationArgsSchema } from "./tool/image-generation"
import { webSearchArgsSchema } from "./tool/web-search"
import { webSearchPreviewArgsSchema } from "./tool/web-search-preview"

type ProviderDefinedTool = Extract<
  NonNullable<LanguageModelV2CallOptions["tools"]>[number],
  { type: "provider-defined" }
>

function prepareFileSearchTool(tool: ProviderDefinedTool): OpenAIResponsesTool {
  const args = fileSearchArgsSchema.parse(tool.args)
  return {
    type: "file_search",
    vector_store_ids: args.vectorStoreIds,
    max_num_results: args.maxNumResults,
    ranking_options: args.ranking
      ? { ranker: args.ranking.ranker, score_threshold: args.ranking.scoreThreshold }
      : undefined,
    filters: args.filters,
  }
}

function prepareWebSearchPreviewTool(tool: ProviderDefinedTool): OpenAIResponsesTool {
  const args = webSearchPreviewArgsSchema.parse(tool.args)
  return {
    type: "web_search_preview",
    search_context_size: args.searchContextSize,
    user_location: args.userLocation,
  }
}

function prepareWebSearchTool(tool: ProviderDefinedTool): OpenAIResponsesTool {
  const args = webSearchArgsSchema.parse(tool.args)
  return {
    type: "web_search",
    filters: args.filters != null ? { allowed_domains: args.filters.allowedDomains } : undefined,
    search_context_size: args.searchContextSize,
    user_location: args.userLocation,
  }
}

function prepareCodeInterpreterTool(tool: ProviderDefinedTool): OpenAIResponsesTool {
  const args = codeInterpreterArgsSchema.parse(tool.args)
  return {
    type: "code_interpreter",
    container:
      args.container == null
        ? { type: "auto", file_ids: undefined }
        : typeof args.container === "string"
          ? args.container
          : { type: "auto", file_ids: args.container.fileIds },
  }
}

function prepareImageGenerationTool(tool: ProviderDefinedTool): OpenAIResponsesTool {
  const args = imageGenerationArgsSchema.parse(tool.args)
  return {
    type: "image_generation",
    background: args.background,
    input_fidelity: args.inputFidelity,
    input_image_mask: args.inputImageMask
      ? { file_id: args.inputImageMask.fileId, image_url: args.inputImageMask.imageUrl }
      : undefined,
    model: args.model,
    moderation: args.moderation,
    partial_images: args.partialImages,
    quality: args.quality,
    output_compression: args.outputCompression,
    output_format: args.outputFormat,
    size: args.size,
  }
}

function convertProviderDefinedTool(
  tool: ProviderDefinedTool,
  toolWarnings: LanguageModelV2CallWarning[],
  openaiTools: Array<OpenAIResponsesTool>,
): void {
  switch (tool.id) {
    case "openai.file_search":
      openaiTools.push(prepareFileSearchTool(tool))
      break
    case "openai.local_shell":
      openaiTools.push({ type: "local_shell" })
      break
    case "openai.web_search_preview":
      openaiTools.push(prepareWebSearchPreviewTool(tool))
      break
    case "openai.web_search":
      openaiTools.push(prepareWebSearchTool(tool))
      break
    case "openai.code_interpreter":
      openaiTools.push(prepareCodeInterpreterTool(tool))
      break
    case "openai.image_generation":
      openaiTools.push(prepareImageGenerationTool(tool))
      break
    default:
      toolWarnings.push({ type: "unsupported-tool", tool })
  }
}

type PreparedToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "file_search" }
  | { type: "web_search_preview" }
  | { type: "web_search" }
  | { type: "function"; name: string }
  | { type: "code_interpreter" }
  | { type: "image_generation" }

const NAMED_TOOL_CHOICES = new Set([
  "code_interpreter",
  "file_search",
  "image_generation",
  "web_search_preview",
  "web_search",
])

function resolveToolChoice(
  toolChoice: NonNullable<LanguageModelV2CallOptions["toolChoice"]>,
  openaiTools: Array<OpenAIResponsesTool>,
  toolWarnings: LanguageModelV2CallWarning[],
): { tools?: Array<OpenAIResponsesTool>; toolChoice?: PreparedToolChoice; toolWarnings: LanguageModelV2CallWarning[] } {
  const type = toolChoice.type
  switch (type) {
    case "auto":
    case "none":
    case "required":
      return { tools: openaiTools, toolChoice: type, toolWarnings }
    case "tool":
      return {
        tools: openaiTools,
        toolChoice: NAMED_TOOL_CHOICES.has(toolChoice.toolName)
          ? ({ type: toolChoice.toolName } as PreparedToolChoice)
          : { type: "function", name: toolChoice.toolName },
        toolWarnings,
      }
    default: {
      const _exhaustiveCheck: never = type
      throw new UnsupportedFunctionalityError({
        functionality: `tool choice type: ${_exhaustiveCheck}`,
      })
    }
  }
}

export function prepareResponsesTools({
  tools,
  toolChoice,
  strictJsonSchema,
}: {
  tools: LanguageModelV2CallOptions["tools"]
  toolChoice?: LanguageModelV2CallOptions["toolChoice"]
  strictJsonSchema: boolean
}): {
  tools?: Array<OpenAIResponsesTool>
  toolChoice?: PreparedToolChoice
  toolWarnings: LanguageModelV2CallWarning[]
} {
  // when the tools array is empty, change it to undefined to prevent errors:
  tools = tools?.length ? tools : undefined

  const toolWarnings: LanguageModelV2CallWarning[] = []

  if (tools == null) {
    return { tools: undefined, toolChoice: undefined, toolWarnings }
  }

  const openaiTools: Array<OpenAIResponsesTool> = []

  for (const tool of tools) {
    switch (tool.type) {
      case "function":
        openaiTools.push({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: strictJsonSchema,
        })
        break
      case "provider-defined":
        convertProviderDefinedTool(tool, toolWarnings, openaiTools)
        break
      default:
        toolWarnings.push({ type: "unsupported-tool", tool })
        break
    }
  }

  if (toolChoice == null) {
    return { tools: openaiTools, toolChoice: undefined, toolWarnings }
  }

  return resolveToolChoice(toolChoice, openaiTools, toolWarnings)
}
