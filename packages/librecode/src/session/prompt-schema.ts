import z from "zod"
import { SessionID, MessageID } from "./schema"
import { MessageV2 } from "./message-v2"
import { ModelID, ProviderID } from "../provider/schema"
import { Agent } from "../agent/agent"
import type { ToolCallOptions } from "ai"
import { Tool } from "@/tool/tool"
import { SessionProcessor } from "./processor"

export const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

export const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export const PromptInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  agent: z.string().optional(),
  noReply: z.boolean().optional(),
  tools: z
    .record(z.string(), z.boolean())
    .optional()
    .describe("@deprecated tools and permissions have been merged, you can set permissions on the session itself now"),
  format: MessageV2.Format.optional(),
  system: z.string().optional(),
  variant: z.string().optional(),
  parts: z.array(
    z.discriminatedUnion("type", [
      MessageV2.TextPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "TextPartInput",
        }),
      MessageV2.FilePart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "FilePartInput",
        }),
      MessageV2.AgentPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "AgentPartInput",
        }),
      MessageV2.SubtaskPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "SubtaskPartInput",
        }),
    ]),
  ),
})
export type PromptInputType = z.infer<typeof PromptInput>

export const LoopInput = z.object({
  sessionID: SessionID.zod,
  resume_existing: z.boolean().optional(),
})

export const ShellInput = z.object({
  sessionID: SessionID.zod,
  agent: z.string(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  command: z.string(),
})
export type ShellInputType = z.infer<typeof ShellInput>

export const CommandInput = z.object({
  messageID: MessageID.zod.optional(),
  sessionID: SessionID.zod,
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.string(),
  command: z.string(),
  variant: z.string().optional(),
  parts: z
    .array(
      z.discriminatedUnion("type", [
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        }).partial({
          id: true,
        }),
      ]),
    )
    .optional(),
})
export type CommandInputType = z.infer<typeof CommandInput>

export type LoopControl = "stop" | "continue"

export type ScanResult = {
  lastUser: MessageV2.User | undefined
  lastAssistant: MessageV2.Assistant | undefined
  lastFinished: MessageV2.Assistant | undefined
  tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[]
}

export type NormalStepResult =
  | { control: "stop" }
  | { control: "continue" }
  | { control: "structured"; output: unknown }

export type ToolContextFactory = (args: unknown, opts: ToolCallOptions) => Tool.Context

export type McpToolContent =
  | {
      type: "text"
      text: string
    }
  | {
      type: "image"
      mimeType: string
      data: string
    }
  | {
      type: "resource"
      resource: {
        text?: string
        blob?: string
        mimeType?: string
        uri: string
      }
    }

export type McpParsedOutput = {
  textParts: string[]
  attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
}

export type PartDraft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never

export type PartBuildCtx = {
  messageID: MessageID
  sessionID: SessionID
  agentName: string
  agentPermission: Agent.Info["permission"]
  model: MessageV2.User["model"]
}

export type BuildMcpToolOpts = {
  key: string
  execute: NonNullable<import("ai").Tool["execute"]>
  context: ToolContextFactory
  agent: Agent.Info
  processor: SessionProcessor.Info
}
