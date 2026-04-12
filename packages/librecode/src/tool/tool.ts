import z from "zod"
import type { AgentInfo } from "../agent/agent"
import type { PermissionNext } from "../permission/next"
import type { MessageV2 } from "../session/message-v2"
import type { MessageID, SessionID } from "../session/schema"
import { Truncate } from "./truncation"

interface Metadata {
  [key: string]: any
}

export interface ToolInitContext {
  agent?: AgentInfo
}

export type ToolContext<M extends Metadata = Metadata> = {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  abort: AbortSignal
  callID?: string
  extra?: { [key: string]: any }
  messages: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): void
  ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
}

export interface ToolInfo<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: (ctx?: ToolInitContext) => Promise<{
    description: string
    parameters: Parameters
    execute(
      args: z.infer<Parameters>,
      ctx: ToolContext,
    ): Promise<{
      title: string
      metadata: M
      output: string
      attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
    }>
    formatValidationError?(error: z.ZodError): string
  }>
}

export type ToolInferParameters<T extends ToolInfo> = T extends ToolInfo<infer P> ? z.infer<P> : never
export type ToolInferMetadata<T extends ToolInfo> = T extends ToolInfo<any, infer M> ? M : never

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Tool {
  type InitContext = ToolInitContext
  type Context<M extends Metadata = Metadata> = ToolContext<M>
  interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata>
    extends ToolInfo<Parameters, M> {}
  type InferParameters<T extends Info> = ToolInferParameters<T>
  type InferMetadata<T extends Info> = ToolInferMetadata<T>
}

function toolDefine<Parameters extends z.ZodType, Result extends Metadata>(
  id: string,
  init: ToolInfo<Parameters, Result>["init"] | Awaited<ReturnType<ToolInfo<Parameters, Result>["init"]>>,
): ToolInfo<Parameters, Result> {
  return {
    id,
    init: async (initCtx) => {
      const toolInfo = init instanceof Function ? await init(initCtx) : init
      const execute = toolInfo.execute
      toolInfo.execute = async (args, ctx) => {
        try {
          toolInfo.parameters.parse(args)
        } catch (error) {
          if (error instanceof z.ZodError && toolInfo.formatValidationError) {
            throw new Error(toolInfo.formatValidationError(error), { cause: error })
          }
          throw new Error(
            `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
            { cause: error },
          )
        }
        const result = await execute(args, ctx)
        // skip truncation for tools that handle it themselves
        if (result.metadata.truncated !== undefined) {
          return result
        }
        const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
        return {
          ...result,
          output: truncated.content,
          metadata: {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          },
        }
      }
      return toolInfo
    },
  }
}

export const Tool = {
  define: toolDefine,
} as const
