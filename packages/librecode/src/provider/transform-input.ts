import type { ModelMessage, TextPart, ImagePart, FilePart } from "ai"
import type { Provider } from "./provider"
import type { ModelsDev } from "./models"

type Modality = NonNullable<ModelsDev.Model["modalities"]>["input"][number]

export function mimeToModality(mime: string): Modality | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

// ---------------------------------------------------------------------------
// Anthropic message filtering
// ---------------------------------------------------------------------------

function filterAnthropicEmptyContent(part: { type: string; text?: string }): boolean {
  if (part.type === "text" || part.type === "reasoning") {
    return part.text !== ""
  }
  return true
}

export function filterAnthropicEmptyMessages(msgs: ModelMessage[]): ModelMessage[] {
  return msgs
    .map((msg) => {
      if (typeof msg.content === "string") {
        if (msg.content === "") return undefined
        return msg
      }
      if (!Array.isArray(msg.content)) return msg
      const filtered = (msg.content as Array<{ type: string; text?: string }>).filter(filterAnthropicEmptyContent)
      if (filtered.length === 0) return undefined
      return { ...msg, content: filtered }
    })
    .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "")
}

// ---------------------------------------------------------------------------
// Claude tool call ID sanitization
// ---------------------------------------------------------------------------

export function sanitizeClaudeToolCallIds(msg: ModelMessage): ModelMessage {
  if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
    msg.content = msg.content.map((part) => {
      if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
        return {
          ...part,
          toolCallId: (part as { toolCallId: string }).toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
        }
      }
      return part
    })
  }
  return msg
}

// ---------------------------------------------------------------------------
// Mistral message normalization
// ---------------------------------------------------------------------------

export function isMistralModel(model: Provider.Model): boolean {
  return (
    model.providerID === "mistral" ||
    model.api.id.toLowerCase().includes("mistral") ||
    model.api.id.toLocaleLowerCase().includes("devstral")
  )
}

function normalizeMistralToolCallId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9]/g, "") // Remove non-alphanumeric characters
    .substring(0, 9) // Take first 9 characters
    .padEnd(9, "0") // Pad with zeros if less than 9 characters
}

export function normalizeMistralMessages(msgs: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const nextMsg = msgs[i + 1]

    if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
          return {
            ...part,
            toolCallId: normalizeMistralToolCallId((part as { toolCallId: string }).toolCallId),
          }
        }
        return part
      })
    }

    result.push(msg)

    // Fix message sequence: tool messages cannot be followed by user messages
    if (msg.role === "tool" && nextMsg?.role === "user") {
      result.push({ role: "assistant", content: [{ type: "text", text: "Done." }] })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Interleaved reasoning normalization
// ---------------------------------------------------------------------------

export function normalizeInterleavedReasoning(msgs: ModelMessage[], field: string): ModelMessage[] {
  return msgs.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg

    // Using type cast here: AssistantContent parts include ReasoningPart which has a `text` field
    const content = msg.content as Array<{ type: string; text?: string }>
    const reasoningText = content.filter((p) => p.type === "reasoning").map((p) => p.text ?? "").join("")
    const filteredContent = content.filter((p) => p.type !== "reasoning")

    if (reasoningText) {
      return {
        ...msg,
        content: filteredContent,
        providerOptions: {
          ...(msg.providerOptions as Record<string, unknown> | undefined),
          openaiCompatible: {
            ...(msg.providerOptions as Record<string, Record<string, unknown>> | undefined)?.openaiCompatible,
            [field]: reasoningText,
          },
        },
      } as ModelMessage
    }

    return { ...msg, content: filteredContent } as ModelMessage
  })
}

// ---------------------------------------------------------------------------
// Unsupported part filtering
// ---------------------------------------------------------------------------

function checkEmptyBase64Image(imageStr: string): { type: "text"; text: string } | null {
  if (!imageStr.startsWith("data:")) return null
  const match = imageStr.match(/^data:([^;]+);base64,(.*)$/)
  if (match && (!match[2] || match[2].length === 0)) {
    return {
      type: "text" as const,
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    }
  }
  return null
}

export function filterUnsupportedPart(
  part: TextPart | ImagePart | FilePart,
  model: Provider.Model,
): TextPart | ImagePart | FilePart {
  if (part.type !== "file" && part.type !== "image") return part

  // Check for empty base64 image data
  if (part.type === "image") {
    const imageStr = part.image.toString()
    const emptyError = checkEmptyBase64Image(imageStr)
    if (emptyError) return emptyError
  }

  const mime =
    part.type === "image"
      ? part.image.toString().split(";")[0].replace("data:", "")
      : part.mediaType
  const filename = part.type === "file" ? part.filename : undefined
  const modality = mimeToModality(mime)
  if (!modality) return part
  if (model.capabilities.input[modality]) return part

  const name = filename ? `"${filename}"` : modality
  return {
    type: "text" as const,
    text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
  }
}

// ---------------------------------------------------------------------------
// Provider options key remapping
// ---------------------------------------------------------------------------

export function remapProviderOptionsKeys(
  msgs: ModelMessage[],
  fromKey: string,
  toKey: string,
): ModelMessage[] {
  const remap = (opts: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (!opts) return opts
    if (!(fromKey in opts)) return opts
    const result = { ...opts }
    result[toKey] = result[fromKey]
    delete result[fromKey]
    return result
  }

  return msgs.map((msg) => {
    if (!Array.isArray(msg.content)) {
      return { ...msg, providerOptions: remap(msg.providerOptions) } as ModelMessage
    }
    return {
      ...msg,
      providerOptions: remap(msg.providerOptions),
      content: msg.content.map((part) => ({
        ...part,
        providerOptions: remap((part as { providerOptions?: Record<string, unknown> }).providerOptions),
      })),
    } as ModelMessage
  })
}
