import {
  type LanguageModelV2CallWarning,
  type LanguageModelV2Prompt,
  type LanguageModelV2ToolCallPart,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider"
import { convertToBase64, parseProviderOptions } from "@ai-sdk/provider-utils"
import { z } from "zod/v4"
import type {
  OpenAIResponsesInput,
  OpenAIResponsesReasoning,
  OpenAIResponsesUserMessage,
} from "./openai-responses-api-types"
import { localShellInputSchema, localShellOutputSchema } from "./tool/local-shell"

/**
 * Check if a string is a file ID based on the given prefixes
 * Returns false if prefixes is undefined (disables file ID detection)
 */
function isFileId(data: string, prefixes?: readonly string[]): boolean {
  if (!prefixes) return false
  return prefixes.some((prefix) => data.startsWith(prefix))
}

type UserContentPart = LanguageModelV2Prompt[number] & { role: "user" }
type UserFilePart = Extract<UserContentPart["content"][number], { type: "file" }>
type UserMessageContent = OpenAIResponsesUserMessage["content"][number]

function convertImageFilePart(
  part: UserFilePart & { mediaType: string },
  fileIdPrefixes?: readonly string[],
): UserMessageContent {
  const mediaType = part.mediaType === "image/*" ? "image/jpeg" : part.mediaType
  if (part.data instanceof URL) {
    return { type: "input_image", image_url: part.data.toString() }
  }
  if (typeof part.data === "string" && isFileId(part.data, fileIdPrefixes)) {
    return { type: "input_image", file_id: part.data }
  }
  return { type: "input_image", image_url: `data:${mediaType};base64,${convertToBase64(part.data)}` }
}

function convertPdfFilePart(part: UserFilePart, index: number, fileIdPrefixes?: readonly string[]): UserMessageContent {
  if (part.data instanceof URL) {
    return { type: "input_file", file_url: part.data.toString() }
  }
  if (typeof part.data === "string" && isFileId(part.data, fileIdPrefixes)) {
    return { type: "input_file", file_id: part.data }
  }
  return {
    type: "input_file",
    filename: part.filename ?? `part-${index}.pdf`,
    file_data: `data:application/pdf;base64,${convertToBase64(part.data)}`,
  }
}

function convertUserContentPart(
  part: UserContentPart["content"][number],
  index: number,
  fileIdPrefixes?: readonly string[],
): UserMessageContent {
  switch (part.type) {
    case "text":
      return { type: "input_text", text: part.text }
    case "file": {
      if (part.mediaType.startsWith("image/")) {
        return convertImageFilePart(part, fileIdPrefixes)
      }
      if (part.mediaType === "application/pdf") {
        return convertPdfFilePart(part, index, fileIdPrefixes)
      }
      throw new UnsupportedFunctionalityError({
        functionality: `file part media type ${part.mediaType}`,
      })
    }
  }
}

type AssistantContent = (LanguageModelV2Prompt[number] & { role: "assistant" })["content"]
type AssistantPart = AssistantContent[number]

function pushLocalShellCall(input: OpenAIResponsesInput, part: LanguageModelV2ToolCallPart): void {
  const parsedInput = localShellInputSchema.parse(part.input)
  input.push({
    type: "local_shell_call",
    call_id: part.toolCallId,
    id: (part.providerOptions?.openai?.itemId as string) ?? undefined,
    action: {
      type: "exec",
      command: parsedInput.action.command,
      timeout_ms: parsedInput.action.timeoutMs,
      user: parsedInput.action.user,
      working_directory: parsedInput.action.workingDirectory,
      env: parsedInput.action.env,
    },
  })
}

async function handleReasoningPart(
  part: Extract<AssistantPart, { type: "reasoning" }>,
  input: OpenAIResponsesInput,
  warnings: Array<LanguageModelV2CallWarning>,
  reasoningMessages: Record<string, OpenAIResponsesReasoning>,
  store: boolean,
): Promise<void> {
  const providerOptions = await parseProviderOptions({
    provider: "copilot",
    providerOptions: part.providerOptions,
    schema: openaiResponsesReasoningProviderOptionsSchema,
  })

  const reasoningId = providerOptions?.itemId

  if (reasoningId == null) {
    warnings.push({
      type: "other",
      message: `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${JSON.stringify(part)}.`,
    })
    return
  }

  const reasoningMessage = reasoningMessages[reasoningId]

  if (store) {
    if (reasoningMessage === undefined) {
      input.push({ type: "item_reference", id: reasoningId })
      reasoningMessages[reasoningId] = { type: "reasoning", id: reasoningId, summary: [] }
    }
    return
  }

  const summaryParts: Array<{ type: "summary_text"; text: string }> = []
  if (part.text.length > 0) {
    summaryParts.push({ type: "summary_text", text: part.text })
  } else if (reasoningMessage !== undefined) {
    warnings.push({
      type: "other",
      message: `Cannot append empty reasoning part to existing reasoning sequence. Skipping reasoning part: ${JSON.stringify(part)}.`,
    })
  }

  if (reasoningMessage === undefined) {
    reasoningMessages[reasoningId] = {
      type: "reasoning",
      id: reasoningId,
      encrypted_content: providerOptions?.reasoningEncryptedContent,
      summary: summaryParts,
    }
    input.push(reasoningMessages[reasoningId])
  } else {
    reasoningMessage.summary.push(...summaryParts)
  }
}

function handleAssistantTextPart(part: Extract<AssistantPart, { type: "text" }>, input: OpenAIResponsesInput): void {
  input.push({
    role: "assistant",
    content: [{ type: "output_text", text: part.text }],
    id: (part.providerOptions?.openai?.itemId as string) ?? undefined,
  })
}

function handleAssistantToolCallPart(
  part: LanguageModelV2ToolCallPart,
  input: OpenAIResponsesInput,
  toolCallParts: Record<string, LanguageModelV2ToolCallPart>,
  hasLocalShellTool: boolean,
): void {
  toolCallParts[part.toolCallId] = part
  if (part.providerExecuted) return
  if (hasLocalShellTool && part.toolName === "local_shell") {
    pushLocalShellCall(input, part)
    return
  }
  input.push({
    type: "function_call",
    call_id: part.toolCallId,
    name: part.toolName,
    arguments: JSON.stringify(part.input),
    id: (part.providerOptions?.openai?.itemId as string) ?? undefined,
  })
}

function handleAssistantToolResultPart(
  part: Extract<AssistantPart, { type: "tool-result" }>,
  input: OpenAIResponsesInput,
  warnings: Array<LanguageModelV2CallWarning>,
  store: boolean,
): void {
  if (store) {
    input.push({ type: "item_reference", id: part.toolCallId })
  } else {
    warnings.push({
      type: "other",
      message: `Results for OpenAI tool ${part.toolName} are not sent to the API when store is false`,
    })
  }
}

async function handleAssistantContent(
  content: AssistantContent,
  input: OpenAIResponsesInput,
  warnings: Array<LanguageModelV2CallWarning>,
  store: boolean,
  hasLocalShellTool: boolean,
): Promise<void> {
  const reasoningMessages: Record<string, OpenAIResponsesReasoning> = {}
  const toolCallParts: Record<string, LanguageModelV2ToolCallPart> = {}

  for (const part of content) {
    switch (part.type) {
      case "text":
        handleAssistantTextPart(part, input)
        break
      case "tool-call":
        handleAssistantToolCallPart(part, input, toolCallParts, hasLocalShellTool)
        break
      case "tool-result":
        handleAssistantToolResultPart(part, input, warnings, store)
        break
      case "reasoning":
        await handleReasoningPart(part, input, warnings, reasoningMessages, store)
        break
    }
  }
}

type ToolContent = (LanguageModelV2Prompt[number] & { role: "tool" })["content"]

function handleToolContent(content: ToolContent, input: OpenAIResponsesInput, hasLocalShellTool: boolean): void {
  for (const part of content) {
    const output = part.output

    if (hasLocalShellTool && part.toolName === "local_shell" && output.type === "json") {
      input.push({
        type: "local_shell_call_output",
        call_id: part.toolCallId,
        output: localShellOutputSchema.parse(output.value).output,
      })
      break
    }

    let contentValue: string
    switch (output.type) {
      case "text":
      case "error-text":
        contentValue = output.value
        break
      case "content":
      case "json":
      case "error-json":
        contentValue = JSON.stringify(output.value)
        break
    }

    input.push({
      type: "function_call_output",
      call_id: part.toolCallId,
      output: contentValue,
    })
  }
}

function handleSystemMessage(
  content: string,
  systemMessageMode: "system" | "developer" | "remove",
  input: OpenAIResponsesInput,
  warnings: Array<LanguageModelV2CallWarning>,
): void {
  switch (systemMessageMode) {
    case "system":
      input.push({ role: "system", content })
      break
    case "developer":
      input.push({ role: "developer", content })
      break
    case "remove":
      warnings.push({ type: "other", message: "system messages are removed for this model" })
      break
    default: {
      const _exhaustiveCheck: never = systemMessageMode
      throw new Error(`Unsupported system message mode: ${_exhaustiveCheck}`)
    }
  }
}

export async function convertToOpenAIResponsesInput({
  prompt,
  systemMessageMode,
  fileIdPrefixes,
  store,
  hasLocalShellTool = false,
}: {
  prompt: LanguageModelV2Prompt
  systemMessageMode: "system" | "developer" | "remove"
  fileIdPrefixes?: readonly string[]
  store: boolean
  hasLocalShellTool?: boolean
}): Promise<{
  input: OpenAIResponsesInput
  warnings: Array<LanguageModelV2CallWarning>
}> {
  const input: OpenAIResponsesInput = []
  const warnings: Array<LanguageModelV2CallWarning> = []

  for (const { role, content } of prompt) {
    switch (role) {
      case "system": {
        handleSystemMessage(content, systemMessageMode, input, warnings)
        break
      }

      case "user": {
        input.push({
          role: "user",
          content: content.map((part, index) => convertUserContentPart(part, index, fileIdPrefixes)),
        })
        break
      }

      case "assistant": {
        await handleAssistantContent(content, input, warnings, store, hasLocalShellTool)
        break
      }

      case "tool": {
        handleToolContent(content, input, hasLocalShellTool)
        break
      }

      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return { input, warnings }
}

const openaiResponsesReasoningProviderOptionsSchema = z.object({
  itemId: z.string().nullish(),
  reasoningEncryptedContent: z.string().nullish(),
})

export type OpenAIResponsesReasoningProviderOptions = z.infer<typeof openaiResponsesReasoningProviderOptionsSchema>
