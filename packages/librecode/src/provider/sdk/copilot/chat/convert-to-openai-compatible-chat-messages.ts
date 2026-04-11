import {
  type LanguageModelV2Prompt,
  type SharedV2ProviderMetadata,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider"
import type { OpenAICompatibleChatPrompt } from "./openai-compatible-api-types"
import { convertToBase64 } from "@ai-sdk/provider-utils"

function getOpenAIMetadata(message: { providerOptions?: SharedV2ProviderMetadata }) {
  return message?.providerOptions?.copilot ?? {}
}

function convertFilePart(
  part: Extract<LanguageModelV2Prompt[number] & { role: "user" }, { role: "user" }>["content"][number] & {
    type: "file"
  },
  partMetadata: Record<string, unknown>,
): Record<string, unknown> {
  if (!part.mediaType.startsWith("image/")) {
    throw new UnsupportedFunctionalityError({
      functionality: `file part media type ${part.mediaType}`,
    })
  }
  const mediaType = part.mediaType === "image/*" ? "image/jpeg" : part.mediaType
  return {
    type: "image_url",
    image_url: {
      url:
        part.data instanceof URL ? part.data.toString() : `data:${mediaType};base64,${convertToBase64(part.data)}`,
    },
    ...partMetadata,
  }
}

function convertUserContentPart(
  part: LanguageModelV2Prompt[number] & { role: "user" } extends { content: Array<infer P> } ? P : never,
): Record<string, unknown> {
  const partMetadata = getOpenAIMetadata(part)
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text, ...partMetadata }
    case "file":
      return convertFilePart(part as Parameters<typeof convertFilePart>[0], partMetadata)
    default:
      throw new UnsupportedFunctionalityError({ functionality: `user part type: ${(part as { type: string }).type}` })
  }
}

function buildSystemMessage(
  content: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return { role: "system", content, ...metadata }
}

function buildUserMessage(
  content: LanguageModelV2Prompt[number] & { role: "user" } extends { content: infer C } ? C : never,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (content.length === 1 && content[0].type === "text") {
    return { role: "user", content: content[0].text, ...getOpenAIMetadata(content[0]) }
  }
  return {
    role: "user",
    content: content.map(convertUserContentPart),
    ...metadata,
  }
}

interface ToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

interface AssistantParts {
  text: string
  reasoningText: string | undefined
  reasoningOpaque: string | undefined
  toolCalls: ToolCall[]
}

function extractReasoningOpaque(part: { providerOptions?: unknown }): string | undefined {
  return (part.providerOptions as { copilot?: { reasoningOpaque?: string } } | undefined)?.copilot?.reasoningOpaque
}

function processAssistantPart(
  part: LanguageModelV2Prompt[number] & { role: "assistant" } extends { content: Array<infer P> } ? P : never,
  acc: AssistantParts,
): void {
  const partMetadata = getOpenAIMetadata(part)
  const partOpaque = extractReasoningOpaque(part)
  if (partOpaque && !acc.reasoningOpaque) acc.reasoningOpaque = partOpaque

  switch (part.type) {
    case "text":
      acc.text += part.text
      break
    case "reasoning":
      if (part.text) acc.reasoningText = part.text
      break
    case "tool-call":
      acc.toolCalls.push({
        id: part.toolCallId,
        type: "function",
        function: { name: part.toolName, arguments: JSON.stringify(part.input) },
        ...partMetadata,
      } as ToolCall)
      break
  }
}

function buildAssistantMessage(
  content: LanguageModelV2Prompt[number] & { role: "assistant" } extends { content: infer C } ? C : never,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const acc: AssistantParts = { text: "", reasoningText: undefined, reasoningOpaque: undefined, toolCalls: [] }
  for (const part of content) processAssistantPart(part as Parameters<typeof processAssistantPart>[0], acc)
  return {
    role: "assistant",
    content: acc.text || null,
    tool_calls: acc.toolCalls.length > 0 ? acc.toolCalls : undefined,
    reasoning_text: acc.reasoningOpaque ? acc.reasoningText : undefined,
    reasoning_opaque: acc.reasoningOpaque,
    ...metadata,
  }
}

function resolveToolOutputContent(output: { type: string; value: unknown }): string {
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value as string
    default:
      return JSON.stringify(output.value)
  }
}

function buildToolMessages(
  content: LanguageModelV2Prompt[number] & { role: "tool" } extends { content: infer C } ? C : never,
): Array<Record<string, unknown>> {
  return (content as Array<{ toolCallId: string; output: { type: string; value: unknown }; providerOptions?: SharedV2ProviderMetadata }>).map(
    (toolResponse) => ({
      role: "tool",
      tool_call_id: toolResponse.toolCallId,
      content: resolveToolOutputContent(toolResponse.output),
      ...getOpenAIMetadata(toolResponse),
    }),
  )
}

export function convertToOpenAICompatibleChatMessages(prompt: LanguageModelV2Prompt): OpenAICompatibleChatPrompt {
  const messages: OpenAICompatibleChatPrompt = []
  for (const { role, content, ...message } of prompt) {
    const metadata = getOpenAIMetadata({ ...message })
    switch (role) {
      case "system":
        messages.push(buildSystemMessage(content as string, metadata) as (typeof messages)[number])
        break
      case "user":
        messages.push(
          buildUserMessage(
            content as Parameters<typeof buildUserMessage>[0],
            metadata,
          ) as (typeof messages)[number],
        )
        break
      case "assistant":
        messages.push(
          buildAssistantMessage(
            content as Parameters<typeof buildAssistantMessage>[0],
            metadata,
          ) as (typeof messages)[number],
        )
        break
      case "tool": {
        const toolMessages = buildToolMessages(
          content as Parameters<typeof buildToolMessages>[0],
        ) as (typeof messages)[number][]
        messages.push(...toolMessages)
        break
      }
      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return messages
}
