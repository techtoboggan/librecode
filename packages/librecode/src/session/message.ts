import { NamedError } from "@librecode/util/error"
import z from "zod"
import { ModelID, ProviderID } from "../provider/schema"
import { SessionID } from "./schema"

export const MessageOutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
export const MessageAuthError = NamedError.create(
  "ProviderAuthError",
  z.object({
    providerID: z.string(),
    message: z.string(),
  }),
)

export const MessageToolCall = z
  .object({
    state: z.literal("call"),
    step: z.number().optional(),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.custom<Required<unknown>>(),
  })
  .meta({
    ref: "ToolCall",
  })
export type MessageToolCall = z.infer<typeof MessageToolCall>

export const MessageToolPartialCall = z
  .object({
    state: z.literal("partial-call"),
    step: z.number().optional(),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.custom<Required<unknown>>(),
  })
  .meta({
    ref: "ToolPartialCall",
  })
export type MessageToolPartialCall = z.infer<typeof MessageToolPartialCall>

export const MessageToolResult = z
  .object({
    state: z.literal("result"),
    step: z.number().optional(),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.custom<Required<unknown>>(),
    result: z.string(),
  })
  .meta({
    ref: "ToolResult",
  })
export type MessageToolResult = z.infer<typeof MessageToolResult>

export const MessageToolInvocation = z
  .discriminatedUnion("state", [MessageToolCall, MessageToolPartialCall, MessageToolResult])
  .meta({
    ref: "ToolInvocation",
  })
export type MessageToolInvocation = z.infer<typeof MessageToolInvocation>

export const MessageTextPart = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .meta({
    ref: "TextPart",
  })
export type MessageTextPart = z.infer<typeof MessageTextPart>

export const MessageReasoningPart = z
  .object({
    type: z.literal("reasoning"),
    text: z.string(),
    providerMetadata: z.record(z.string(), z.any()).optional(),
  })
  .meta({
    ref: "ReasoningPart",
  })
export type MessageReasoningPart = z.infer<typeof MessageReasoningPart>

export const MessageToolInvocationPart = z
  .object({
    type: z.literal("tool-invocation"),
    toolInvocation: MessageToolInvocation,
  })
  .meta({
    ref: "ToolInvocationPart",
  })
export type MessageToolInvocationPart = z.infer<typeof MessageToolInvocationPart>

export const MessageSourceUrlPart = z
  .object({
    type: z.literal("source-url"),
    sourceId: z.string(),
    url: z.string(),
    title: z.string().optional(),
    providerMetadata: z.record(z.string(), z.any()).optional(),
  })
  .meta({
    ref: "SourceUrlPart",
  })
export type MessageSourceUrlPart = z.infer<typeof MessageSourceUrlPart>

export const MessageFilePart = z
  .object({
    type: z.literal("file"),
    mediaType: z.string(),
    filename: z.string().optional(),
    url: z.string(),
  })
  .meta({
    ref: "FilePart",
  })
export type MessageFilePart = z.infer<typeof MessageFilePart>

export const MessageStepStartPart = z
  .object({
    type: z.literal("step-start"),
  })
  .meta({
    ref: "StepStartPart",
  })
export type MessageStepStartPart = z.infer<typeof MessageStepStartPart>

export const MessagePart = z
  .discriminatedUnion("type", [
    MessageTextPart,
    MessageReasoningPart,
    MessageToolInvocationPart,
    MessageSourceUrlPart,
    MessageFilePart,
    MessageStepStartPart,
  ])
  .meta({
    ref: "MessagePart",
  })
export type MessagePart = z.infer<typeof MessagePart>

export const MessageInfo = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    parts: z.array(MessagePart),
    metadata: z
      .object({
        time: z.object({
          created: z.number(),
          completed: z.number().optional(),
        }),
        error: z
          .discriminatedUnion("name", [
            MessageAuthError.Schema,
            NamedError.Unknown.Schema,
            MessageOutputLengthError.Schema,
          ])
          .optional(),
        sessionID: SessionID.zod,
        tool: z.record(
          z.string(),
          z
            .object({
              title: z.string(),
              snapshot: z.string().optional(),
              time: z.object({
                start: z.number(),
                end: z.number(),
              }),
            })
            .catchall(z.any()),
        ),
        assistant: z
          .object({
            system: z.string().array(),
            modelID: ModelID.zod,
            providerID: ProviderID.zod,
            path: z.object({
              cwd: z.string(),
              root: z.string(),
            }),
            cost: z.number(),
            summary: z.boolean().optional(),
            tokens: z.object({
              input: z.number(),
              output: z.number(),
              reasoning: z.number(),
              cache: z.object({
                read: z.number(),
                write: z.number(),
              }),
            }),
          })
          .optional(),
        snapshot: z.string().optional(),
      })
      .meta({ ref: "MessageMetadata" }),
  })
  .meta({
    ref: "Message",
  })
export type MessageInfo = z.infer<typeof MessageInfo>

export const Message = {
  OutputLengthError: MessageOutputLengthError,
  AuthError: MessageAuthError,
  ToolCall: MessageToolCall,
  ToolPartialCall: MessageToolPartialCall,
  ToolResult: MessageToolResult,
  ToolInvocation: MessageToolInvocation,
  TextPart: MessageTextPart,
  ReasoningPart: MessageReasoningPart,
  ToolInvocationPart: MessageToolInvocationPart,
  SourceUrlPart: MessageSourceUrlPart,
  FilePart: MessageFilePart,
  StepStartPart: MessageStepStartPart,
  MessagePart,
  Info: MessageInfo,
} as const
