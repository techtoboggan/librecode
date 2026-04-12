import { NamedError } from "@librecode/util/error"
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"
import type { SystemError } from "bun"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { ProviderError } from "@/provider/error"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Snapshot } from "@/snapshot"
import { and, Database, desc, eq, inArray, lt, NotFoundError, or } from "@/storage/db"
import { fn } from "@/util/fn"
import { iife } from "@/util/iife"
import type {
  FilePart as FilePart_,
  Part as Part_,
  ToolPart as ToolPart_,
  ToolStateCompleted as ToolStateCompleted_,
} from "./message-v2-parts"
// Import everything from parts module for local use
import {
  AbortedError as _AbortedError,
  AgentPart as _AgentPart,
  APIError as _APIError,
  AuthError as _AuthError,
  CompactionPart as _CompactionPart,
  ContextOverflowError as _ContextOverflowError,
  FilePart as _FilePart,
  FilePartSource as _FilePartSource,
  FileSource as _FileSource,
  OutputLengthError as _OutputLengthError,
  Part as _Part,
  PatchPart as _PatchPart,
  ReasoningPart as _ReasoningPart,
  ResourceSource as _ResourceSource,
  RetryPart as _RetryPart,
  SnapshotPart as _SnapshotPart,
  StepFinishPart as _StepFinishPart,
  StepStartPart as _StepStartPart,
  StructuredOutputError as _StructuredOutputError,
  SubtaskPart as _SubtaskPart,
  SymbolSource as _SymbolSource,
  TextPart as _TextPart,
  ToolPart as _ToolPart,
  ToolState as _ToolState,
  ToolStateCompleted as _ToolStateCompleted,
  ToolStateError as _ToolStateError,
  ToolStatePending as _ToolStatePending,
  ToolStateRunning as _ToolStateRunning,
} from "./message-v2-parts"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageTable, PartTable, SessionTable } from "./session.sql"

// Re-export everything from parts module so callers don't need to change
export {
  AbortedError,
  AgentPart,
  APIError,
  AuthError,
  CompactionPart,
  ContextOverflowError,
  FilePart,
  FilePartSource,
  FileSource,
  OutputLengthError,
  Part,
  PatchPart,
  ReasoningPart,
  ResourceSource,
  RetryPart,
  SnapshotPart,
  StepFinishPart,
  StepStartPart,
  StructuredOutputError,
  SubtaskPart,
  SymbolSource,
  TextPart,
  ToolPart,
  ToolState,
  ToolStateCompleted,
  ToolStateError,
  ToolStatePending,
  ToolStateRunning,
} from "./message-v2-parts"

type _APIErrorData = z.infer<typeof _APIError.Schema>

export function isMedia(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf"
}

export const OutputFormatText = z
  .object({
    type: z.literal("text"),
  })
  .meta({
    ref: "OutputFormatText",
  })

export const OutputFormatJsonSchema = z
  .object({
    type: z.literal("json_schema"),
    schema: z.record(z.string(), z.any()).meta({ ref: "JSONSchema" }),
    retryCount: z.number().int().min(0).default(2),
  })
  .meta({
    ref: "OutputFormatJsonSchema",
  })

export const Format = z.discriminatedUnion("type", [OutputFormatText, OutputFormatJsonSchema]).meta({
  ref: "OutputFormat",
})
type _OutputFormat = z.infer<typeof Format>

const Base = z.object({
  id: MessageID.zod,
  sessionID: SessionID.zod,
})

export const User = Base.extend({
  role: z.literal("user"),
  time: z.object({
    created: z.number(),
  }),
  format: Format.optional(),
  summary: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      diffs: Snapshot.FileDiff.array(),
    })
    .optional(),
  agent: z.string(),
  model: z.object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
  }),
  system: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  variant: z.string().optional(),
}).meta({
  ref: "UserMessage",
})
type _User = z.infer<typeof User>

export const Assistant = Base.extend({
  role: z.literal("assistant"),
  time: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
  error: z
    .discriminatedUnion("name", [
      _AuthError.Schema,
      NamedError.Unknown.Schema,
      _OutputLengthError.Schema,
      _AbortedError.Schema,
      _StructuredOutputError.Schema,
      _ContextOverflowError.Schema,
      _APIError.Schema,
    ])
    .optional(),
  parentID: MessageID.zod,
  modelID: ModelID.zod,
  providerID: ProviderID.zod,
  /**
   * @deprecated
   */
  mode: z.string(),
  agent: z.string(),
  path: z.object({
    cwd: z.string(),
    root: z.string(),
  }),
  summary: z.boolean().optional(),
  cost: z.number(),
  tokens: z.object({
    total: z.number().optional(),
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
  structured: z.any().optional(),
  variant: z.string().optional(),
  finish: z.string().optional(),
}).meta({
  ref: "AssistantMessage",
})
type _Assistant = z.infer<typeof Assistant>

export const Info = z.discriminatedUnion("role", [User, Assistant]).meta({
  ref: "Message",
})
type _Info = z.infer<typeof Info>

export const Event = {
  Updated: BusEvent.define(
    "message.updated",
    z.object({
      info: Info,
    }),
  ),
  Removed: BusEvent.define(
    "message.removed",
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
  ),
  PartUpdated: BusEvent.define(
    "message.part.updated",
    z.object({
      part: _Part,
    }),
  ),
  PartDelta: BusEvent.define(
    "message.part.delta",
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
  ),
  PartRemoved: BusEvent.define(
    "message.part.removed",
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
  ),
}

export const WithParts = z.object({
  info: Info,
  parts: z.array(_Part),
})
type _WithParts = z.infer<typeof WithParts>

const Cursor = z.object({
  id: MessageID.zod,
  time: z.number(),
})
type Cursor = z.infer<typeof Cursor>

export const cursor = {
  encode(input: Cursor) {
    return Buffer.from(JSON.stringify(input)).toString("base64url")
  },
  decode(input: string) {
    return Cursor.parse(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

const info = (row: typeof MessageTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
  }) as MessageV2.Info

const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  }) as MessageV2.Part

const older = (row: Cursor) =>
  or(lt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), lt(MessageTable.id, row.id)))

async function hydrate(rows: (typeof MessageTable.$inferSelect)[]) {
  const ids = rows.map((row) => row.id)
  const partByMessage = new Map<string, MessageV2.Part[]>()
  if (ids.length > 0) {
    const partRows = Database.use((db) =>
      db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.message_id, ids))
        .orderBy(PartTable.message_id, PartTable.id)
        .all(),
    )
    for (const row of partRows) {
      const next = part(row)
      const list = partByMessage.get(row.message_id)
      if (list) list.push(next)
      else partByMessage.set(row.message_id, [next])
    }
  }

  return rows.map((row) => ({
    info: info(row),
    parts: partByMessage.get(row.id) ?? [],
  }))
}

// OpenAI-compatible APIs only support string content in tool results, so we need
// to extract media and inject as user messages. Other SDKs (anthropic, google,
// bedrock) handle type: "content" with media parts natively.
//
// Only apply this workaround if the model actually supports image input -
// otherwise there's no point extracting images.
function checkSupportsMediaInToolResults(model: Provider.Model): boolean {
  if (model.api.npm === "@ai-sdk/anthropic") return true
  if (model.api.npm === "@ai-sdk/openai") return true
  if (model.api.npm === "@ai-sdk/amazon-bedrock") return true
  if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
  if (model.api.npm === "@ai-sdk/google") {
    const id = model.api.id.toLowerCase()
    return id.includes("gemini-3") && !id.includes("gemini-2")
  }
  return false
}

function toModelOutput(output: unknown): { type: string; value: unknown } {
  if (typeof output === "string") {
    return { type: "text", value: output }
  }

  if (typeof output === "object" && output !== null) {
    const outputObject = output as {
      text: string
      attachments?: Array<{ mime: string; url: string }>
    }
    const attachments = (outputObject.attachments ?? []).filter((attachment) => {
      return attachment.url.startsWith("data:") && attachment.url.includes(",")
    })

    return {
      type: "content",
      value: [
        { type: "text", text: outputObject.text },
        ...attachments.map((attachment) => ({
          type: "media",
          mediaType: attachment.mime,
          data: iife(() => {
            const commaIndex = attachment.url.indexOf(",")
            return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
          }),
        })),
      ],
    }
  }

  return { type: "json", value: output as never }
}

function processUserPart(part: Part_, userMessage: UIMessage, options: { stripMedia?: boolean } | undefined): void {
  if (part.type === "text" && !part.ignored) {
    userMessage.parts.push({ type: "text", text: part.text })
    return
  }
  // text/plain and directory files are converted into text parts, ignore them
  if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory") {
    if (options?.stripMedia && isMedia(part.mime)) {
      userMessage.parts.push({ type: "text", text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` })
    } else {
      userMessage.parts.push({ type: "file", url: part.url, mediaType: part.mime, filename: part.filename })
    }
    return
  }
  if (part.type === "compaction") {
    userMessage.parts.push({ type: "text", text: "What did we do so far?" })
    return
  }
  if (part.type === "subtask") {
    userMessage.parts.push({ type: "text", text: "The following tool was executed by the user" })
  }
}

function buildUserMessage(
  msg: _WithParts & { info: { role: "user"; id: string } },
  options: { stripMedia?: boolean } | undefined,
): UIMessage {
  const userMessage: UIMessage = { id: msg.info.id, role: "user", parts: [] }
  for (const p of msg.parts) {
    processUserPart(p, userMessage, options)
  }
  return userMessage
}

function appendCompletedToolPart(
  assistantMessage: UIMessage,
  part: ToolPart_ & { state: ToolStateCompleted_ },
  differentModel: boolean,
  supportsMediaInToolResults: boolean,
  media: Array<{ mime: string; url: string }>,
  options: { stripMedia?: boolean } | undefined,
): void {
  const outputText = part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output
  const attachments = part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])

  // For providers that don't support media in tool results, extract media files
  // (images, PDFs) to be sent as a separate user message
  const mediaAttachments = attachments.filter((a) => isMedia(a.mime))
  const nonMediaAttachments = attachments.filter((a) => !isMedia(a.mime))
  if (!supportsMediaInToolResults && mediaAttachments.length > 0) {
    media.push(...mediaAttachments)
  }
  const finalAttachments = supportsMediaInToolResults ? attachments : nonMediaAttachments
  const output = finalAttachments.length > 0 ? { text: outputText, attachments: finalAttachments } : outputText

  assistantMessage.parts.push({
    type: (`tool-${part.tool}`) as `tool-${string}`,
    state: "output-available",
    toolCallId: part.callID,
    input: part.state.input,
    output,
    ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
  })
}

function appendToolPart(
  assistantMessage: UIMessage,
  part: ToolPart_,
  differentModel: boolean,
  supportsMediaInToolResults: boolean,
  media: Array<{ mime: string; url: string }>,
  options: { stripMedia?: boolean } | undefined,
): void {
  if (part.state.status === "completed") {
    appendCompletedToolPart(
      assistantMessage,
      part as ToolPart_ & { state: ToolStateCompleted_ },
      differentModel,
      supportsMediaInToolResults,
      media,
      options,
    )
    return
  }
  if (part.state.status === "error") {
    assistantMessage.parts.push({
      type: (`tool-${part.tool}`) as `tool-${string}`,
      state: "output-error",
      toolCallId: part.callID,
      input: part.state.input,
      errorText: part.state.error,
      ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
    })
    return
  }
  // Handle pending/running tool calls to prevent dangling tool_use blocks
  // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
  if (part.state.status === "pending" || part.state.status === "running") {
    assistantMessage.parts.push({
      type: (`tool-${part.tool}`) as `tool-${string}`,
      state: "output-error",
      toolCallId: part.callID,
      input: part.state.input,
      errorText: "[Tool execution was interrupted]",
      ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
    })
  }
}

function providerMeta(metadata: Record<string, unknown> | undefined, differentModel: boolean): Record<string, unknown> {
  return differentModel ? {} : { providerMetadata: metadata }
}

function appendAssistantPart(
  part: Part_,
  assistantMessage: UIMessage,
  differentModel: boolean,
  supportsMediaInToolResults: boolean,
  media: Array<{ mime: string; url: string }>,
  toolNames: Set<string>,
  options: { stripMedia?: boolean } | undefined,
): void {
  if (part.type === "text") {
    assistantMessage.parts.push({ type: "text", text: part.text, ...providerMeta(part.metadata, differentModel) })
  } else if (part.type === "step-start") {
    assistantMessage.parts.push({ type: "step-start" })
  } else if (part.type === "tool") {
    toolNames.add(part.tool)
    appendToolPart(assistantMessage, part as ToolPart_, differentModel, supportsMediaInToolResults, media, options)
  } else if (part.type === "reasoning") {
    assistantMessage.parts.push({ type: "reasoning", text: part.text, ...providerMeta(part.metadata, differentModel) })
  }
}

function appendAssistantParts(
  assistantMessage: UIMessage,
  msg: _WithParts,
  differentModel: boolean,
  supportsMediaInToolResults: boolean,
  media: Array<{ mime: string; url: string }>,
  toolNames: Set<string>,
  options: { stripMedia?: boolean } | undefined,
): void {
  for (const part of msg.parts) {
    appendAssistantPart(part, assistantMessage, differentModel, supportsMediaInToolResults, media, toolNames, options)
  }
}

function buildMediaInjectionMessage(media: Array<{ mime: string; url: string }>): UIMessage {
  return {
    id: MessageID.ascending(),
    role: "user",
    parts: [
      { type: "text" as const, text: "Attached image(s) from tool result:" },
      ...media.map((attachment) => ({
        type: "file" as const,
        url: attachment.url,
        mediaType: attachment.mime,
      })),
    ],
  }
}

function shouldSkipAssistantMessage(msg: _WithParts & { info: _Assistant }): boolean {
  if (!msg.info.error) return false
  // Keep aborted messages that have content beyond step-start/reasoning
  if (
    MessageV2.AbortedError.isInstance(msg.info.error) &&
    msg.parts.some((p) => p.type !== "step-start" && p.type !== "reasoning")
  ) {
    return false
  }
  return true
}

function processAssistantMessage(
  msg: _WithParts & { info: _Assistant },
  model: Provider.Model,
  result: UIMessage[],
  toolNames: Set<string>,
  supportsMediaInToolResults: boolean,
  options: { stripMedia?: boolean } | undefined,
): void {
  if (shouldSkipAssistantMessage(msg)) return

  const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
  const media: Array<{ mime: string; url: string }> = []
  const assistantMessage: UIMessage = { id: msg.info.id, role: "assistant", parts: [] }
  appendAssistantParts(assistantMessage, msg, differentModel, supportsMediaInToolResults, media, toolNames, options)

  if (assistantMessage.parts.length > 0) {
    result.push(assistantMessage)
    // Inject pending media as a user message for providers that don't support
    // media (images, PDFs) in tool results
    if (media.length > 0) {
      result.push(buildMediaInjectionMessage(media))
    }
  }
}

export function toModelMessages(
  input: _WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean },
): ModelMessage[] {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  const supportsMediaInToolResults = checkSupportsMediaInToolResults(model)

  for (const msg of input) {
    if (msg.parts.length === 0) continue
    if (msg.info.role === "user") {
      result.push(buildUserMessage(msg as _WithParts & { info: { role: "user"; id: string } }, options))
    } else if (msg.info.role === "assistant") {
      processAssistantMessage(
        msg as _WithParts & { info: _Assistant },
        model,
        result,
        toolNames,
        supportsMediaInToolResults,
        options,
      )
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return convertToModelMessages(
    result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
    {
      //@ts-expect-error (convertToModelMessages expects a ToolSet but only actually needs tools[name]?.toModelOutput)
      tools,
    },
  )
}

export const page = fn(
  z.object({
    sessionID: SessionID.zod,
    limit: z.number().int().positive(),
    before: z.string().optional(),
  }),
  async (input) => {
    const before = input.before ? cursor.decode(input.before) : undefined
    const where = before
      ? and(eq(MessageTable.session_id, input.sessionID), older(before))
      : eq(MessageTable.session_id, input.sessionID)
    const rows = Database.use((db) =>
      db
        .select()
        .from(MessageTable)
        .where(where)
        .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
        .limit(input.limit + 1)
        .all(),
    )
    if (rows.length === 0) {
      const row = Database.use((db) =>
        db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
      )
      if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
      return {
        items: [] as MessageV2.WithParts[],
        more: false,
      }
    }

    const more = rows.length > input.limit
    const page = more ? rows.slice(0, input.limit) : rows
    const items = await hydrate(page)
    items.reverse()
    const tail = page.at(-1)
    return {
      items,
      more,
      cursor: more && tail ? cursor.encode({ id: tail.id, time: tail.time_created }) : undefined,
    }
  },
)

export const stream = fn(SessionID.zod, async function* (sessionID) {
  const size = 50
  let before: string | undefined
  while (true) {
    const next = await page({ sessionID, limit: size, before })
    if (next.items.length === 0) break
    for (let i = next.items.length - 1; i >= 0; i--) {
      yield next.items[i]
    }
    if (!next.more || !next.cursor) break
    before = next.cursor
  }
})

export const parts = fn(MessageID.zod, async (message_id) => {
  const rows = Database.use((db) =>
    db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all(),
  )
  return rows.map(
    (row) => ({ ...row.data, id: row.id, sessionID: row.session_id, messageID: row.message_id }) as MessageV2.Part,
  )
})

export const get = fn(
  z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod,
  }),
  async (input): Promise<_WithParts> => {
    const row = Database.use((db) =>
      db
        .select()
        .from(MessageTable)
        .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
        .get(),
    )
    if (!row) throw new NotFoundError({ message: `Message not found: ${input.messageID}` })
    return {
      info: info(row),
      parts: await parts(input.messageID),
    }
  },
)

export async function filterCompacted(stream: AsyncIterable<MessageV2.WithParts>) {
  const result = [] as MessageV2.WithParts[]
  const completed = new Set<string>()
  for await (const msg of stream) {
    result.push(msg)
    if (msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some((part) => part.type === "compaction"))
      break
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error)
      completed.add(msg.info.parentID)
  }
  result.reverse()
  return result
}

function parsedAPICallErrorToObject(
  parsed: ProviderError.ParsedAPICallError,
  e: unknown,
): NonNullable<_Assistant["error"]> {
  if (parsed.type === "context_overflow") {
    return new MessageV2.ContextOverflowError(
      { message: parsed.message, responseBody: parsed.responseBody },
      { cause: e },
    ).toObject()
  }
  return new MessageV2.APIError(
    {
      message: parsed.message,
      statusCode: parsed.statusCode,
      isRetryable: parsed.isRetryable,
      responseHeaders: parsed.responseHeaders,
      responseBody: parsed.responseBody,
      metadata: parsed.metadata,
    },
    { cause: e },
  ).toObject()
}

function parsedStreamErrorToObject(
  parsed: ProviderError.ParsedStreamError,
  e: unknown,
): NonNullable<_Assistant["error"]> {
  if (parsed.type === "context_overflow") {
    return new MessageV2.ContextOverflowError(
      { message: parsed.message, responseBody: parsed.responseBody },
      { cause: e },
    ).toObject()
  }
  return new MessageV2.APIError(
    { message: parsed.message, isRetryable: parsed.isRetryable, responseBody: parsed.responseBody },
    { cause: e },
  ).toObject()
}

function fromStreamError(e: unknown): NonNullable<_Assistant["error"]> | undefined {
  try {
    const parsed = ProviderError.parseStreamError(e)
    if (parsed) return parsedStreamErrorToObject(parsed, e)
  } catch {}
  return undefined
}

export function fromError(e: unknown, ctx: { providerID: ProviderID }): NonNullable<_Assistant["error"]> {
  if (e instanceof DOMException && e.name === "AbortError") {
    return new MessageV2.AbortedError({ message: e.message }, { cause: e }).toObject()
  }
  if (MessageV2.OutputLengthError.isInstance(e)) return e
  if (LoadAPIKeyError.isInstance(e)) {
    return new MessageV2.AuthError({ providerID: ctx.providerID, message: e.message }, { cause: e }).toObject()
  }
  if ((e as SystemError)?.code === "ECONNRESET") {
    const sys = e as SystemError
    return new MessageV2.APIError(
      {
        message: "Connection reset by server",
        isRetryable: true,
        metadata: { code: sys.code ?? "", syscall: sys.syscall ?? "", message: sys.message ?? "" },
      },
      { cause: e },
    ).toObject()
  }
  if (APICallError.isInstance(e)) {
    const parsed = ProviderError.parseAPICallError({ providerID: ctx.providerID, error: e })
    return parsedAPICallErrorToObject(parsed, e)
  }
  if (e instanceof Error) return new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()

  return fromStreamError(e) ?? new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
}

// Barrel export preserving MessageV2.X access pattern for consumers
export const MessageV2 = {
  APIError: _APIError,
  AbortedError: _AbortedError,
  AgentPart: _AgentPart,
  Assistant,
  AuthError: _AuthError,
  CompactionPart: _CompactionPart,
  ContextOverflowError: _ContextOverflowError,
  Event,
  FilePart: _FilePart,
  FilePartSource: _FilePartSource,
  FileSource: _FileSource,
  Format,
  Info,
  OutputFormatJsonSchema,
  OutputFormatText,
  OutputLengthError: _OutputLengthError,
  Part: _Part,
  PatchPart: _PatchPart,
  ReasoningPart: _ReasoningPart,
  ResourceSource: _ResourceSource,
  RetryPart: _RetryPart,
  SnapshotPart: _SnapshotPart,
  StepFinishPart: _StepFinishPart,
  StepStartPart: _StepStartPart,
  StructuredOutputError: _StructuredOutputError,
  SubtaskPart: _SubtaskPart,
  SymbolSource: _SymbolSource,
  TextPart: _TextPart,
  ToolPart: _ToolPart,
  ToolState: _ToolState,
  ToolStateCompleted: _ToolStateCompleted,
  ToolStateError: _ToolStateError,
  ToolStatePending: _ToolStatePending,
  ToolStateRunning: _ToolStateRunning,
  User,
  WithParts,
  cursor,
  filterCompacted,
  fromError,
  get,
  isMedia,
  page,
  parts,
  stream,
  toModelMessages,
} as const

// Type companion — declaration merging lets consumers write MessageV2.TextPart as a type
// biome-ignore lint/style/noNamespace: type companion — declaration merging for MessageV2 type aliases
export namespace MessageV2 {
  export type APIError = _APIErrorData
  export type AgentPart = z.infer<typeof _AgentPart>
  export type Assistant = _Assistant
  export type CompactionPart = z.infer<typeof _CompactionPart>
  export type FilePart = FilePart_
  export type Info = _Info
  export type Part = Part_
  export type PatchPart = z.infer<typeof _PatchPart>
  export type ReasoningPart = z.infer<typeof _ReasoningPart>
  export type RetryPart = z.infer<typeof _RetryPart>
  export type SnapshotPart = z.infer<typeof _SnapshotPart>
  export type StepFinishPart = z.infer<typeof _StepFinishPart>
  export type StepStartPart = z.infer<typeof _StepStartPart>
  export type SubtaskPart = z.infer<typeof _SubtaskPart>
  export type TextPart = z.infer<typeof _TextPart>
  export type ToolPart = ToolPart_
  export type ToolStateCompleted = ToolStateCompleted_
  export type ToolStateError = z.infer<typeof _ToolStateError>
  export type ToolStatePending = z.infer<typeof _ToolStatePending>
  export type ToolStateRunning = z.infer<typeof _ToolStateRunning>
  export type User = _User
  export type WithParts = _WithParts
  export type OutputFormat = _OutputFormat
}
