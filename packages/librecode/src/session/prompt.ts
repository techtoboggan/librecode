import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema } from "ai"
import { SessionCompaction } from "./compaction"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"
import { FileTime } from "../file/time"
import { Flag } from "../flag/flag"
import { ulid } from "ulid"
import { spawn } from "child_process"
import { Command } from "../command"
import { $ } from "bun"
import { pathToFileURL, fileURLToPath } from "url"
import { ConfigMarkdown } from "../config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@librecode/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { Shell } from "@/shell/shell"
import { Truncate } from "@/tool/truncation"
import { decodeDataUrl } from "@/util/data-url"
import { planModeTemplate } from "./prompt/plan-mode-template"
import { getShellArgs } from "./prompt/shell-invocations"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

const log = Log.create({ service: "session.prompt" })

const state = Instance.state(
  () => {
    const data: Record<
      string,
      {
        abort: AbortController
        callbacks: {
          resolve(input: MessageV2.WithParts): void
          reject(reason?: any): void
        }[]
      }
    > = {}
    return data
  },
  async (current) => {
    for (const item of Object.values(current)) {
      item.abort.abort()
    }
  },
)

export function assertNotBusy(sessionID: SessionID) {
  const match = state()[sessionID]
  if (match) throw new Session.BusyError(sessionID)
}

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
    .describe(
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
    ),
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
type _PromptInput = z.infer<typeof PromptInput>

export const prompt = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  const message = await createUserMessage(input)
  await Session.touch(input.sessionID)

  // this is backwards compatibility for allowing `tools` to be specified when
  // prompting
  const permissions: PermissionNext.Ruleset = []
  for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
    permissions.push({
      permission: tool,
      action: enabled ? "allow" : "deny",
      pattern: "*",
    })
  }
  if (permissions.length > 0) {
    session.permission = permissions
    await Session.setPermission({ sessionID: session.id, permission: permissions })
  }

  if (input.noReply === true) {
    return message
  }

  return loop({ sessionID: input.sessionID })
})

export async function resolvePromptParts(template: string): Promise<_PromptInput["parts"]> {
  const parts: _PromptInput["parts"] = [
    {
      type: "text",
      text: template,
    },
  ]
  const files = ConfigMarkdown.files(template)
  const seen = new Set<string>()
  await Promise.all(
    files.map(async (match) => {
      const name = match[1]
      if (seen.has(name)) return
      seen.add(name)
      const filepath = name.startsWith("~/")
        ? path.join(os.homedir(), name.slice(2))
        : path.resolve(Instance.worktree, name)

      const stats = await fs.stat(filepath).catch(() => undefined)
      if (!stats) {
        const agent = await Agent.get(name)
        if (agent) {
          parts.push({
            type: "agent",
            name: agent.name,
          })
        }
        return
      }

      if (stats.isDirectory()) {
        parts.push({
          type: "file",
          url: pathToFileURL(filepath).href,
          filename: name,
          mime: "application/x-directory",
        })
        return
      }

      parts.push({
        type: "file",
        url: pathToFileURL(filepath).href,
        filename: name,
        mime: "text/plain",
      })
    }),
  )
  return parts
}

function start(sessionID: SessionID) {
  const s = state()
  if (s[sessionID]) return
  const controller = new AbortController()
  s[sessionID] = {
    abort: controller,
    callbacks: [],
  }
  return controller.signal
}

function resume(sessionID: SessionID) {
  const s = state()
  if (!s[sessionID]) return

  return s[sessionID].abort.signal
}

export function cancel(sessionID: SessionID) {
  log.info("cancel", { sessionID })
  const s = state()
  const match = s[sessionID]
  if (!match) {
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }
  match.abort.abort()
  delete s[sessionID]
  SessionStatus.set(sessionID, { type: "idle" })
  return
}

export const LoopInput = z.object({
  sessionID: SessionID.zod,
  resume_existing: z.boolean().optional(),
})
type LoopControl = "stop" | "continue"

type ScanResult = {
  lastUser: MessageV2.User | undefined
  lastAssistant: MessageV2.Assistant | undefined
  lastFinished: MessageV2.Assistant | undefined
  tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[]
}

function collectPendingTasks(
  msg: MessageV2.WithParts,
): (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] {
  return msg.parts.filter(
    (part): part is MessageV2.CompactionPart | MessageV2.SubtaskPart =>
      part.type === "compaction" || part.type === "subtask",
  )
}

function updateScanState(
  msg: MessageV2.WithParts,
  acc: Omit<ScanResult, "tasks">,
): void {
  if (!acc.lastUser && msg.info.role === "user") acc.lastUser = msg.info as MessageV2.User
  if (!acc.lastAssistant && msg.info.role === "assistant") acc.lastAssistant = msg.info as MessageV2.Assistant
  if (!acc.lastFinished && msg.info.role === "assistant" && msg.info.finish)
    acc.lastFinished = msg.info as MessageV2.Assistant
}

function scanMessages(msgs: MessageV2.WithParts[]): ScanResult {
  const acc: Omit<ScanResult, "tasks"> = {
    lastUser: undefined,
    lastAssistant: undefined,
    lastFinished: undefined,
  }
  const tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []

  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    updateScanState(msg, acc)
    if (acc.lastUser && acc.lastFinished) break
    if (!acc.lastFinished) tasks.push(...collectPendingTasks(msg))
  }

  return { ...acc, tasks }
}

async function finalizeSubtaskResult(
  result: Awaited<ReturnType<Awaited<ReturnType<typeof TaskTool.init>>["execute"]>> | undefined,
  part: MessageV2.ToolPart,
  assistantMessage: MessageV2.Assistant,
  executionError: Error | undefined,
  taskArgs: Record<string, unknown>,
  sessionID: SessionID,
): Promise<void> {
  const attachments = result?.attachments?.map((attachment) => ({
    ...attachment,
    id: PartID.ascending(),
    sessionID,
    messageID: assistantMessage.id,
  }))

  await Plugin.trigger(
    "tool.execute.after",
    { tool: "task", sessionID, callID: part.id, args: taskArgs },
    result,
  )

  assistantMessage.finish = "tool-calls"
  assistantMessage.time.completed = Date.now()
  await Session.updateMessage(assistantMessage)

  if (result && part.state.status === "running") {
    await Session.updatePart({
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        title: result.title,
        metadata: result.metadata,
        output: result.output,
        attachments,
        time: { ...part.state.time, end: Date.now() },
      },
    } satisfies MessageV2.ToolPart)
    return
  }

  if (!result) {
    await Session.updatePart({
      ...part,
      state: {
        status: "error",
        error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
        time: {
          start: part.state.status === "running" ? part.state.time.start : Date.now(),
          end: Date.now(),
        },
        metadata: "metadata" in part.state ? part.state.metadata : undefined,
        input: part.state.input,
      },
    } satisfies MessageV2.ToolPart)
  }
}

async function addSubtaskSummaryMessage(
  lastUser: MessageV2.User,
  sessionID: SessionID,
): Promise<void> {
  // Add synthetic user message to prevent certain reasoning models from erroring
  // If we create assistant messages w/ out user ones following mid loop thinking signatures
  // will be missing and it can cause errors for models like gemini for example
  const summaryUserMsg: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: lastUser.agent,
    model: lastUser.model,
  }
  await Session.updateMessage(summaryUserMsg)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: summaryUserMsg.id,
    sessionID,
    type: "text",
    text: "Summarize the task tool output above and continue with your task.",
    synthetic: true,
  } satisfies MessageV2.TextPart)
}

async function executeSubtask(
  task: MessageV2.SubtaskPart,
  model: Provider.Model,
  lastUser: MessageV2.User,
  msgs: MessageV2.WithParts[],
  sessionID: SessionID,
  abort: AbortSignal,
  sessionPermission: PermissionNext.Ruleset,
): Promise<void> {
  // TODO: centralize "invoke tool" logic
  const taskTool = await TaskTool.init()
  const taskModel = task.model ? await Provider.getModel(task.model.providerID, task.model.modelID) : model
  const assistantMessage = (await Session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: lastUser.id,
    sessionID,
    mode: task.agent,
    agent: task.agent,
    variant: lastUser.variant,
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: taskModel.id,
    providerID: taskModel.providerID,
    time: { created: Date.now() },
  })) as MessageV2.Assistant

  let part = (await Session.updatePart({
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(),
    tool: TaskTool.id,
    state: {
      status: "running",
      input: { prompt: task.prompt, description: task.description, subagent_type: task.agent, command: task.command },
      time: { start: Date.now() },
    },
  })) as MessageV2.ToolPart

  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }
  await Plugin.trigger("tool.execute.before", { tool: "task", sessionID, callID: part.id }, { args: taskArgs })

  let executionError: Error | undefined
  const taskAgent = await Agent.get(task.agent)
  const taskCtx: Tool.Context = {
    agent: task.agent,
    messageID: assistantMessage.id,
    sessionID,
    abort,
    callID: part.callID,
    extra: { bypassAgentCheck: true },
    messages: msgs,
    async metadata(partInput) {
      part = (await Session.updatePart({
        ...part,
        type: "tool",
        state: { ...part.state, ...partInput },
      } satisfies MessageV2.ToolPart)) as MessageV2.ToolPart
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID,
        ruleset: PermissionNext.merge(taskAgent.permission, sessionPermission),
      })
    },
  }

  const result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
    executionError = error
    log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
    return undefined
  })

  await finalizeSubtaskResult(result, part, assistantMessage, executionError, taskArgs, sessionID)

  if (task.command) {
    await addSubtaskSummaryMessage(lastUser, sessionID)
  }
}

function wrapTextPart(part: MessageV2.Part): void {
  if (part.type !== "text" || part.ignored || part.synthetic) return
  if (!part.text.trim()) return
  part.text = [
    "<system-reminder>",
    "The user sent the following message:",
    part.text,
    "",
    "Please address this message and continue with your tasks.",
    "</system-reminder>",
  ].join("\n")
}

function wrapQueuedUserMessages(
  msgs: MessageV2.WithParts[],
  lastFinished: MessageV2.Assistant,
): void {
  for (const msg of msgs) {
    if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
    msg.parts.forEach(wrapTextPart)
  }
}

async function buildSystemPromptParts(
  agent: Agent.Info,
  model: Provider.Model,
  format: NonNullable<MessageV2.User["format"]>,
): Promise<string[]> {
  const skills = await SystemPrompt.skills(agent)
  const system = [
    ...(await SystemPrompt.environment(model)),
    ...(skills ? [skills] : []),
    ...(await InstructionPrompt.system()),
  ]
  if (format.type === "json_schema") {
    system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
  }
  return system
}

type NormalStepResult = { control: "stop" } | { control: "continue" } | { control: "structured"; output: unknown }

async function evaluateStepResult(
  result: Awaited<ReturnType<SessionProcessor.Info["process"]>>,
  processor: SessionProcessor.Info,
  format: NonNullable<MessageV2.User["format"]>,
  structuredOutput: { value: unknown | undefined },
  lastUser: MessageV2.User,
  sessionID: SessionID,
): Promise<NormalStepResult> {
  // If structured output was captured, save it and exit
  // This takes priority because the StructuredOutput tool was called successfully
  if (structuredOutput.value !== undefined) {
    processor.message.structured = structuredOutput.value
    processor.message.finish = processor.message.finish ?? "stop"
    await Session.updateMessage(processor.message)
    return { control: "structured", output: structuredOutput.value }
  }

  const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)
  if (modelFinished && !processor.message.error && format.type === "json_schema") {
    // Model stopped without calling StructuredOutput tool
    processor.message.error = new MessageV2.StructuredOutputError({
      message: "Model did not produce structured output",
      retries: 0,
    }).toObject()
    await Session.updateMessage(processor.message)
    return { control: "stop" }
  }

  if (result === "stop") return { control: "stop" }
  if (result === "compact") {
    await SessionCompaction.create({
      sessionID,
      agent: lastUser.agent,
      model: lastUser.model,
      auto: true,
      overflow: !processor.message.finish,
    })
  }
  return { control: "continue" }
}

async function createAssistantProcessor(
  lastUser: MessageV2.User,
  model: Provider.Model,
  agent: Agent.Info,
  sessionID: SessionID,
  abort: AbortSignal,
): Promise<SessionProcessor.Info> {
  return SessionProcessor.create({
    assistantMessage: (await Session.updateMessage({
      id: MessageID.ascending(),
      parentID: lastUser.id,
      role: "assistant",
      mode: agent.name,
      agent: agent.name,
      variant: lastUser.variant,
      path: { cwd: Instance.directory, root: Instance.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
      sessionID,
    })) as MessageV2.Assistant,
    sessionID,
    model,
    abort,
  })
}

async function runNormalStep(input: {
  lastUser: MessageV2.User
  lastFinished: MessageV2.Assistant | undefined
  msgs: MessageV2.WithParts[]
  model: Provider.Model
  session: Session.Info
  sessionID: SessionID
  abort: AbortSignal
  step: number
  structuredOutput: { value: unknown | undefined }
}): Promise<NormalStepResult> {
  const { lastUser, lastFinished, msgs: rawMsgs, model, session, sessionID, abort, step } = input
  const agent = await Agent.get(lastUser.agent)
  const isLastStep = step >= (agent.steps ?? Infinity)
  const msgs = await insertReminders({ messages: rawMsgs, agent, session })

  const processor = await createAssistantProcessor(lastUser, model, agent, sessionID, abort)
  using _ = defer(() => InstructionPrompt.clear(processor.message.id))

  const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
  const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

  const tools = await resolveTools({ agent, session, model, tools: lastUser.tools, processor, bypassAgentCheck, messages: msgs })

  const format = lastUser.format ?? { type: "text" }

  // Inject StructuredOutput tool if JSON schema mode enabled
  if (format.type === "json_schema") {
    tools["StructuredOutput"] = createStructuredOutputTool({
      schema: format.schema,
      onSuccess(output) {
        input.structuredOutput.value = output
      },
    })
  }

  if (step === 1) SessionSummary.summarize({ sessionID, messageID: lastUser.id })
  if (step > 1 && lastFinished) wrapQueuedUserMessages(msgs, lastFinished)

  await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

  const system = await buildSystemPromptParts(agent, model, format)
  const result = await processor.process({
    user: lastUser,
    agent,
    abort,
    sessionID,
    system,
    messages: [
      ...MessageV2.toModelMessages(msgs, model),
      ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : []),
    ],
    tools,
    model,
    toolChoice: format.type === "json_schema" ? "required" : undefined,
  })

  return evaluateStepResult(result, processor, format, input.structuredOutput, lastUser, sessionID)
}

async function loadSessionModel(
  lastUser: MessageV2.User,
  sessionID: SessionID,
): Promise<Provider.Model> {
  return Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
    if (Provider.ModelNotFoundError.isInstance(e)) {
      const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
      Bus.publish(Session.Event.Error, {
        sessionID,
        error: new NamedError.Unknown({ message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}` }).toObject(),
      })
    }
    throw e
  })
}

async function dispatchLoopTask(
  task: MessageV2.CompactionPart | MessageV2.SubtaskPart,
  model: Provider.Model,
  lastUser: MessageV2.User,
  msgs: MessageV2.WithParts[],
  sessionID: SessionID,
  abort: AbortSignal,
  sessionPermission: PermissionNext.Ruleset,
): Promise<LoopControl> {
  if (task.type === "subtask") {
    await executeSubtask(task, model, lastUser, msgs, sessionID, abort, sessionPermission)
    return "continue"
  }

  const compactResult = await SessionCompaction.process({
    messages: msgs, parentID: lastUser.id, abort, sessionID, auto: task.auto, overflow: task.overflow,
  })
  return compactResult === "stop" ? "stop" : "continue"
}

async function runLoopIteration(ctx: {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  stepRef: { value: number }
  structuredOutput: { value: unknown | undefined }
}): Promise<LoopControl> {
  const { sessionID, session, abort } = ctx
  if (abort.aborted) return "stop"

  const msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
  const { lastUser, lastAssistant, lastFinished, tasks } = scanMessages(msgs)

  if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

  const alreadyFinished =
    lastAssistant?.finish &&
    !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
    lastUser.id < lastAssistant.id
  if (alreadyFinished) {
    log.info("exiting loop", { sessionID })
    return "stop"
  }

  ctx.stepRef.value++
  const step = ctx.stepRef.value

  if (step === 1) {
    ensureTitle({ session, modelID: lastUser.model.modelID, providerID: lastUser.model.providerID, history: msgs })
  }

  const model = await loadSessionModel(lastUser, sessionID)
  const task = tasks.pop()

  if (task) {
    return dispatchLoopTask(task, model, lastUser, msgs, sessionID, abort, session.permission ?? [])
  }

  const isOverflow = lastFinished && lastFinished.summary !== true &&
    (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
  if (isOverflow) {
    await SessionCompaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
    return "continue"
  }

  const stepResult = await runNormalStep({ lastUser, lastFinished, msgs, model, session, sessionID, abort, step, structuredOutput: ctx.structuredOutput })
  return stepResult.control === "stop" || stepResult.control === "structured" ? "stop" : "continue"
}

async function resolveLoopMessage(sessionID: SessionID): Promise<MessageV2.WithParts> {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user") continue
    const queued = state()[sessionID]?.callbacks ?? []
    for (const q of queued) {
      q.resolve(item)
    }
    return item
  }
  throw new Error("Impossible")
}

export const loop = fn(LoopInput, async (input) => {
  const { sessionID, resume_existing } = input

  const abort = resume_existing ? resume(sessionID) : start(sessionID)
  if (!abort) {
    return new Promise<MessageV2.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  using _ = defer(() => cancel(sessionID))

  // Structured output box: shared mutable reference so runNormalStep can set it via closure
  // Note: On session resumption, state is reset but outputFormat is preserved
  // on the user message and will be retrieved from lastUser below
  const structuredOutput: { value: unknown | undefined } = { value: undefined }

  const stepRef = { value: 0 }
  const session = await Session.get(sessionID)
  while (true) {
    SessionStatus.set(sessionID, { type: "busy" })
    log.info("loop", { step: stepRef.value, sessionID })
    const iterResult = await runLoopIteration({ sessionID, session, abort, stepRef, structuredOutput })
    if (iterResult === "stop") break
  }

  SessionCompaction.prune({ sessionID })
  return resolveLoopMessage(sessionID)
})

async function lastModel(sessionID: SessionID) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

type McpToolContent = {
  type: "text"
  text: string
} | {
  type: "image"
  mimeType: string
  data: string
} | {
  type: "resource"
  resource: {
    text?: string
    blob?: string
    mimeType?: string
    uri: string
  }
}

type McpParsedOutput = {
  textParts: string[]
  attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
}

function parseMcpResourceContent(
  resource: McpToolContent & { type: "resource" },
  out: McpParsedOutput,
): void {
  if (resource.resource.text) out.textParts.push(resource.resource.text)
  if (resource.resource.blob) {
    out.attachments.push({
      type: "file",
      mime: resource.resource.mimeType ?? "application/octet-stream",
      url: `data:${resource.resource.mimeType ?? "application/octet-stream"};base64,${resource.resource.blob}`,
      filename: resource.resource.uri,
    })
  }
}

function parseMcpContent(content: McpToolContent[]): McpParsedOutput {
  const out: McpParsedOutput = { textParts: [], attachments: [] }

  for (const item of content) {
    if (item.type === "text") {
      out.textParts.push(item.text)
    } else if (item.type === "image") {
      out.attachments.push({
        type: "file",
        mime: item.mimeType,
        url: `data:${item.mimeType};base64,${item.data}`,
      })
    } else if (item.type === "resource") {
      parseMcpResourceContent(item, out)
    }
  }

  return out
}

type ToolContextFactory = (args: unknown, opts: ToolCallOptions) => Tool.Context

function buildMcpToolExecute(opts: {
  key: string
  execute: NonNullable<AITool["execute"]>
  context: ToolContextFactory
  agent: Agent.Info
  processor: SessionProcessor.Info
}): AITool["execute"] {
  return async (args, callOpts) => {
    const ctx = opts.context(args, callOpts)

    await Plugin.trigger(
      "tool.execute.before",
      { tool: opts.key, sessionID: ctx.sessionID, callID: callOpts.toolCallId },
      { args },
    )

    await ctx.ask({ permission: opts.key, metadata: {}, patterns: ["*"], always: ["*"] })

    const result = await opts.execute(args, callOpts)

    await Plugin.trigger(
      "tool.execute.after",
      { tool: opts.key, sessionID: ctx.sessionID, callID: callOpts.toolCallId, args },
      result,
    )

    const { textParts, attachments } = parseMcpContent(result.content as McpToolContent[])
    const truncated = await Truncate.output(textParts.join("\n\n"), {}, opts.agent)
    const metadata = {
      ...(result.metadata ?? {}),
      truncated: truncated.truncated,
      ...(truncated.truncated && { outputPath: truncated.outputPath }),
    }

    return {
      title: "",
      metadata,
      output: truncated.content,
      attachments: attachments.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID: ctx.sessionID,
        messageID: opts.processor.message.id,
      })),
      content: result.content, // directly return content to preserve ordering when outputting to model
    }
  }
}

/** @internal Exported for testing */
export async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}

  const context = (args: any, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
    agent: input.agent.name,
    messages: input.messages,
    metadata: async (val: { title?: string; metadata?: any }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: {
              start: Date.now(),
            },
          },
        })
      }
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: input.session.id,
        tool: { messageID: input.processor.message.id, callID: options.toolCallId },
        ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
      })
    },
  })

  for (const item of await ToolRegistry.tools(
    { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
    input.agent,
  )) {
    const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        const ctx = context(args, options)
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          {
            args,
          },
        )
        const result = await item.execute(args, ctx)
        const output = {
          ...result,
          attachments: result.attachments?.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
        }
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
            args,
          },
          output,
        )
        return output
      },
    })
  }

  for (const [key, item] of Object.entries(await MCP.tools())) {
    const execute = item.execute
    if (!execute) continue

    const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
    item.inputSchema = jsonSchema(transformed)
    // Wrap execute to add plugin hooks and format output
    item.execute = buildMcpToolExecute({ key, execute, context, agent: input.agent, processor: input.processor })
    tools[key] = item
  }

  return tools
}

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema, ...toolSchema } = input.schema

  return tool({
    id: "StructuredOutput" as any,
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as any),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput(result) {
      return {
        type: "text",
        value: result.output,
      }
    },
  })
}

type PartDraft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never

type PartBuildCtx = {
  messageID: MessageID
  sessionID: SessionID
  agentName: string
  agentPermission: Agent.Info["permission"]
  model: MessageV2.User["model"]
}

async function resolveSymbolRange(
  filePathURI: string,
  start: number,
  end: number | undefined,
): Promise<{ start: number; end: number | undefined }> {
  if (start !== end) return { start, end }

  const symbols = await LSP.documentSymbol(filePathURI).catch(() => [])
  for (const symbol of symbols) {
    let range: LSP.Range | undefined
    if ("range" in symbol) {
      range = symbol.range
    } else if ("location" in symbol) {
      range = symbol.location.range
    }
    if (range?.start?.line && range?.start?.line === start) {
      return { start: range.start.line, end: range?.end?.line ?? start }
    }
  }
  return { start, end }
}

async function resolveFileReadRange(
  url: URL,
  partUrl: string,
): Promise<{ offset: number | undefined; limit: number | undefined }> {
  const rawStart = url.searchParams.get("start")
  if (rawStart == null) return { offset: undefined, limit: undefined }

  const rawEnd = url.searchParams.get("end")
  const filePathURI = partUrl.split("?")[0]
  let start = parseInt(rawStart)
  let end = rawEnd ? parseInt(rawEnd) : undefined

  const resolved = await resolveSymbolRange(filePathURI, start, end)
  start = resolved.start
  end = resolved.end

  const offset = Math.max(start, 1)
  const limit = end ? end - (offset - 1) : undefined
  return { offset, limit }
}

async function processTextFilePart(
  part: Extract<_PromptInput["parts"][number], { type: "file" }>,
  filepath: string,
  url: URL,
  ctx: PartBuildCtx,
): Promise<PartDraft<MessageV2.Part>[]> {
  const { offset, limit } = await resolveFileReadRange(url, part.url)
  const args = { filePath: filepath, offset, limit }

  const pieces: PartDraft<MessageV2.Part>[] = [
    {
      messageID: ctx.messageID,
      sessionID: ctx.sessionID,
      type: "text",
      synthetic: true,
      text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
    },
  ]

  await ReadTool.init()
    .then(async (t) => {
      const model = await Provider.getModel(ctx.model.providerID, ctx.model.modelID)
      const readCtx: Tool.Context = {
        sessionID: ctx.sessionID,
        abort: new AbortController().signal,
        agent: ctx.agentName,
        messageID: ctx.messageID,
        extra: { bypassCwdCheck: true, model },
        messages: [],
        metadata: async () => {},
        ask: async () => {},
      }
      const result = await t.execute(args, readCtx)
      pieces.push({
        messageID: ctx.messageID,
        sessionID: ctx.sessionID,
        type: "text",
        synthetic: true,
        text: result.output,
      })
      if (result.attachments?.length) {
        pieces.push(
          ...result.attachments.map((attachment) => ({
            ...attachment,
            synthetic: true,
            filename: attachment.filename ?? part.filename,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
          })),
        )
      } else {
        pieces.push({ ...part, messageID: ctx.messageID, sessionID: ctx.sessionID })
      }
    })
    .catch((error) => {
      log.error("failed to read file", { error })
      const message = error instanceof Error ? error.message : error.toString()
      Bus.publish(Session.Event.Error, {
        sessionID: ctx.sessionID,
        error: new NamedError.Unknown({ message }).toObject(),
      })
      pieces.push({
        messageID: ctx.messageID,
        sessionID: ctx.sessionID,
        type: "text",
        synthetic: true,
        text: `Read tool failed to read ${filepath} with the following error: ${message}`,
      })
    })

  return pieces
}

async function processDirectoryFilePart(
  part: Extract<_PromptInput["parts"][number], { type: "file" }>,
  filepath: string,
  ctx: PartBuildCtx,
): Promise<PartDraft<MessageV2.Part>[]> {
  const args = { filePath: filepath }
  const listCtx: Tool.Context = {
    sessionID: ctx.sessionID,
    abort: new AbortController().signal,
    agent: ctx.agentName,
    messageID: ctx.messageID,
    extra: { bypassCwdCheck: true },
    messages: [],
    metadata: async () => {},
    ask: async () => {},
  }
  const result = await ReadTool.init().then((t) => t.execute(args, listCtx))
  return [
    {
      messageID: ctx.messageID,
      sessionID: ctx.sessionID,
      type: "text",
      synthetic: true,
      text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
    },
    {
      messageID: ctx.messageID,
      sessionID: ctx.sessionID,
      type: "text",
      synthetic: true,
      text: result.output,
    },
    { ...part, messageID: ctx.messageID, sessionID: ctx.sessionID },
  ]
}

async function processFileUrlFilePart(
  part: Extract<_PromptInput["parts"][number], { type: "file" }>,
  url: URL,
  ctx: PartBuildCtx,
): Promise<PartDraft<MessageV2.Part>[]> {
  log.info("file", { mime: part.mime })
  // have to normalize, symbol search returns absolute paths
  // Decode the pathname since URL constructor doesn't automatically decode it
  const filepath = fileURLToPath(part.url)
  const s = Filesystem.stat(filepath)

  if (s?.isDirectory()) {
    part.mime = "application/x-directory"
  }

  if (part.mime === "text/plain") {
    return processTextFilePart(part, filepath, url, ctx)
  }

  if (part.mime === "application/x-directory") {
    return processDirectoryFilePart(part, filepath, ctx)
  }

  FileTime.read(ctx.sessionID, filepath)
  return [
    {
      messageID: ctx.messageID,
      sessionID: ctx.sessionID,
      type: "text",
      text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
      synthetic: true,
    },
    {
      id: part.id,
      messageID: ctx.messageID,
      sessionID: ctx.sessionID,
      type: "file",
      url: `data:${part.mime};base64,` + (await Filesystem.readBytes(filepath)).toString("base64"),
      mime: part.mime,
      filename: part.filename!,
      source: part.source,
    },
  ]
}

function appendMcpResourceContents(
  contents: { text?: unknown; blob?: unknown; mimeType?: unknown }[],
  partMime: string | undefined,
  ctx: PartBuildCtx,
  pieces: PartDraft<MessageV2.Part>[],
): void {
  for (const content of contents) {
    if ("text" in content && content.text) {
      pieces.push({
        messageID: ctx.messageID,
        sessionID: ctx.sessionID,
        type: "text",
        synthetic: true,
        text: content.text as string,
      })
    } else if ("blob" in content && content.blob) {
      // Handle binary content if needed
      const mimeType = "mimeType" in content ? content.mimeType : partMime
      pieces.push({
        messageID: ctx.messageID,
        sessionID: ctx.sessionID,
        type: "text",
        synthetic: true,
        text: `[Binary content: ${mimeType}]`,
      })
    }
  }
}

async function processMcpResourceFilePart(
  part: Extract<_PromptInput["parts"][number], { type: "file" }>,
  ctx: PartBuildCtx,
): Promise<PartDraft<MessageV2.Part>[]> {
  const source = part.source as { type: "resource"; clientName: string; uri: string }
  const { clientName, uri } = source
  log.info("mcp resource", { clientName, uri, mime: part.mime })

  const pieces: PartDraft<MessageV2.Part>[] = [
    {
      messageID: ctx.messageID,
      sessionID: ctx.sessionID,
      type: "text",
      synthetic: true,
      text: `Reading MCP resource: ${part.filename} (${uri})`,
    },
  ]

  try {
    const resourceContent = await MCP.readResource(clientName, uri)
    if (!resourceContent) throw new Error(`Resource not found: ${clientName}/${uri}`)

    const contents = Array.isArray(resourceContent.contents) ? resourceContent.contents : [resourceContent.contents]
    appendMcpResourceContents(contents, part.mime, ctx, pieces)
    pieces.push({ ...part, messageID: ctx.messageID, sessionID: ctx.sessionID })
  } catch (error: unknown) {
    log.error("failed to read MCP resource", { error, clientName, uri })
    const message = error instanceof Error ? error.message : String(error)
    pieces.push({
      messageID: ctx.messageID,
      sessionID: ctx.sessionID,
      type: "text",
      synthetic: true,
      text: `Failed to read MCP resource ${part.filename}: ${message}`,
    })
  }

  return pieces
}

async function processFilePart(
  part: Extract<_PromptInput["parts"][number], { type: "file" }>,
  ctx: PartBuildCtx,
): Promise<PartDraft<MessageV2.Part>[]> {
  if (part.source?.type === "resource") {
    return processMcpResourceFilePart(part, ctx)
  }

  const url = new URL(part.url)
  if (url.protocol === "data:" && part.mime === "text/plain") {
    return [
      {
        messageID: ctx.messageID,
        sessionID: ctx.sessionID,
        type: "text",
        synthetic: true,
        text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
      },
      {
        messageID: ctx.messageID,
        sessionID: ctx.sessionID,
        type: "text",
        synthetic: true,
        text: decodeDataUrl(part.url),
      },
      { ...part, messageID: ctx.messageID, sessionID: ctx.sessionID },
    ]
  }

  if (url.protocol === "file:") {
    return processFileUrlFilePart(part, url, ctx)
  }

  return [{ ...part, messageID: ctx.messageID, sessionID: ctx.sessionID }]
}

function processAgentPart(
  part: Extract<_PromptInput["parts"][number], { type: "agent" }>,
  ctx: PartBuildCtx,
): PartDraft<MessageV2.Part>[] {
  const perm = PermissionNext.evaluate("task", part.name, ctx.agentPermission)
  const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
  return [
    { ...part, messageID: ctx.messageID, sessionID: ctx.sessionID },
    {
      messageID: ctx.messageID,
      sessionID: ctx.sessionID,
      type: "text",
      synthetic: true,
      // An extra space is added here. Otherwise the 'Use' gets appended
      // to user's last word; making a combined word
      text:
        " Use the above message and context to generate a prompt and call the task tool with subagent: " +
        part.name +
        hint,
    },
  ]
}

async function createUserMessage(input: _PromptInput) {
  const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))

  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
  const full =
    !input.variant && agent.variant
      ? await Provider.getModel(model.providerID, model.modelID).catch(() => undefined)
      : undefined
  const variant = input.variant ?? (agent.variant && full?.variants?.[agent.variant] ? agent.variant : undefined)

  const info: MessageV2.Info = {
    id: input.messageID ?? MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    tools: input.tools,
    agent: agent.name,
    model,
    system: input.system,
    format: input.format,
    variant,
  }
  using _ = defer(() => InstructionPrompt.clear(info.id))

  const assign = (part: PartDraft<MessageV2.Part>): MessageV2.Part => ({
    ...part,
    id: part.id ? PartID.make(part.id) : PartID.ascending(),
  })

  const partCtx: PartBuildCtx = {
    messageID: info.id,
    sessionID: input.sessionID,
    agentName: agent.name,
    agentPermission: agent.permission,
    model,
  }

  const parts = await Promise.all(
    input.parts.map(async (part): Promise<PartDraft<MessageV2.Part>[]> => {
      if (part.type === "file") {
        return processFilePart(part, partCtx)
      }
      if (part.type === "agent") {
        return processAgentPart(part, partCtx)
      }
      return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
    }),
  ).then((x) => x.flat().map(assign))

  await Plugin.trigger(
    "chat.message",
    {
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      messageID: input.messageID,
      variant: input.variant,
    },
    {
      message: info,
      parts,
    },
  )

  await Session.updateMessage(info)
  for (const part of parts) {
    await Session.updatePart(part)
  }

  return {
    info,
    parts,
  }
}

async function insertLegacyPlanReminder(
  messages: MessageV2.WithParts[],
  userMessage: MessageV2.WithParts,
  agent: Agent.Info,
): Promise<void> {
  if (agent.name === "plan") {
    userMessage.parts.push({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: PROMPT_PLAN,
      synthetic: true,
    })
  }
  const wasPlan = messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
  if (wasPlan && agent.name === "build") {
    userMessage.parts.push({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: BUILD_SWITCH,
      synthetic: true,
    })
  }
}

async function insertPlanModeReminder(
  messages: MessageV2.WithParts[],
  userMessage: MessageV2.WithParts,
  agent: Agent.Info,
  session: Session.Info,
): Promise<void> {
  const assistantMessage = messages.findLast((msg) => msg.info.role === "assistant")

  if (agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const plan = Session.plan(session)
    const exists = await Filesystem.exists(plan)
    if (exists) {
      const part = await Session.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: BUILD_SWITCH + "\n\n" + `A plan file exists at ${plan}. You should execute on the plan defined within it`,
        synthetic: true,
      })
      userMessage.parts.push(part)
    }
    return
  }

  if (agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
    const plan = Session.plan(session)
    const exists = await Filesystem.exists(plan)
    if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
    const part = await Session.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: planModeTemplate({ planPath: plan, exists }),
      synthetic: true,
    })
    userMessage.parts.push(part)
  }
}

async function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info; session: Session.Info }) {
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  if (!Flag.LIBRECODE_EXPERIMENTAL_PLAN_MODE) {
    await insertLegacyPlanReminder(input.messages, userMessage, input.agent)
    return input.messages
  }

  await insertPlanModeReminder(input.messages, userMessage, input.agent, input.session)
  return input.messages
}

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
type _ShellInput = z.infer<typeof ShellInput>
export async function shell(input: _ShellInput) {
  const abort = start(input.sessionID)
  if (!abort) {
    throw new Session.BusyError(input.sessionID)
  }

  using _ = defer(() => {
    // If no queued callbacks, cancel (the default)
    const callbacks = state()[input.sessionID]?.callbacks ?? []
    if (callbacks.length === 0) {
      cancel(input.sessionID)
    } else {
      // Otherwise, trigger the session loop to process queued items
      loop({ sessionID: input.sessionID, resume_existing: true }).catch((error) => {
        log.error("session loop failed to resume after shell command", { sessionID: input.sessionID, error })
      })
    }
  })

  const session = await Session.get(input.sessionID)
  if (session.revert) {
    await SessionRevert.cleanup(session)
  }
  const agent = await Agent.get(input.agent)
  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
  const userMsg: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    role: "user",
    agent: input.agent,
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
    },
  }
  await Session.updateMessage(userMsg)
  const userPart: MessageV2.Part = {
    type: "text",
    id: PartID.ascending(),
    messageID: userMsg.id,
    sessionID: input.sessionID,
    text: "The following tool was executed by the user",
    synthetic: true,
  }
  await Session.updatePart(userPart)

  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    parentID: userMsg.id,
    mode: input.agent,
    agent: input.agent,
    cost: 0,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    time: {
      created: Date.now(),
    },
    role: "assistant",
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: model.modelID,
    providerID: model.providerID,
  }
  await Session.updateMessage(msg)
  const part: MessageV2.Part = {
    type: "tool",
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID: input.sessionID,
    tool: "bash",
    callID: ulid(),
    state: {
      status: "running",
      time: {
        start: Date.now(),
      },
      input: {
        command: input.command,
      },
    },
  }
  await Session.updatePart(part)
  const shell = Shell.preferred()
  const shellName = (
    process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
  ).toLowerCase()

  const args = getShellArgs(shellName, input.command)

  const cwd = Instance.directory
  const shellEnv = await Plugin.trigger(
    "shell.env",
    { cwd, sessionID: input.sessionID, callID: part.callID },
    { env: {} },
  )
  const proc = spawn(shell, args, {
    cwd,
    detached: process.platform !== "win32",
    windowsHide: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...shellEnv.env,
      TERM: "dumb",
    },
  })

  let output = ""

  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
    if (part.state.status === "running") {
      part.state.metadata = {
        output: output,
        description: "",
      }
      Session.updatePart(part)
    }
  })

  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString()
    if (part.state.status === "running") {
      part.state.metadata = {
        output: output,
        description: "",
      }
      Session.updatePart(part)
    }
  })

  let aborted = false
  let exited = false

  const kill = () => Shell.killTree(proc, { exited: () => exited })

  if (abort.aborted) {
    aborted = true
    await kill()
  }

  const abortHandler = () => {
    aborted = true
    void kill()
  }

  abort.addEventListener("abort", abortHandler, { once: true })

  await new Promise<void>((resolve) => {
    proc.on("close", () => {
      exited = true
      abort.removeEventListener("abort", abortHandler)
      resolve()
    })
  })

  if (aborted) {
    output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
  }
  msg.time.completed = Date.now()
  await Session.updateMessage(msg)
  if (part.state.status === "running") {
    part.state = {
      status: "completed",
      time: {
        ...part.state.time,
        end: Date.now(),
      },
      input: part.state.input,
      title: "",
      metadata: {
        output,
        description: "",
      },
      output,
    }
    await Session.updatePart(part)
  }
  return { info: msg, parts: [part] }
}

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
type _CommandInput = z.infer<typeof CommandInput>
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g
/**
 * Regular expression to match @ file references in text
 * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
 * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
 */

async function interpolateTemplate(
  templateCommand: string,
  args: string[],
  rawArguments: string,
): Promise<string> {
  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
  let template = withArgs.replaceAll("$ARGUMENTS", rawArguments)

  if (placeholders.length === 0 && !usesArgumentsPlaceholder && rawArguments.trim()) {
    template = template + "\n\n" + rawArguments
  }
  return template
}

async function expandShellInTemplate(template: string): Promise<string> {
  const shell = ConfigMarkdown.shell(template)
  if (shell.length === 0) return template.trim()

  const results = await Promise.all(
    shell.map(async ([, cmd]) => {
      try {
        return await $`${{ raw: cmd }}`.quiet().nothrow().text()
      } catch (error) {
        return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
      }
    }),
  )
  let index = 0
  return template.replace(bashRegex, () => results[index++]).trim()
}

async function resolveCommandModel(
  command: Awaited<ReturnType<typeof Command.get>>,
  inputModel: string | undefined,
  sessionID: SessionID,
): Promise<{ providerID: ProviderID; modelID: ModelID }> {
  if (command.model) return Provider.parseModel(command.model)
  if (command.agent) {
    const cmdAgent = await Agent.get(command.agent)
    if (cmdAgent?.model) return cmdAgent.model
  }
  if (inputModel) return Provider.parseModel(inputModel)
  return await lastModel(sessionID)
}

async function validateCommandAgent(agentName: string, sessionID: SessionID): Promise<Agent.Info> {
  const agent = await Agent.get(agentName)
  if (!agent) {
    const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
    Bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
    throw error
  }
  return agent
}

async function validateModelExists(
  model: { providerID: ProviderID; modelID: ModelID },
  sessionID: SessionID,
): Promise<void> {
  try {
    await Provider.getModel(model.providerID, model.modelID)
  } catch (e) {
    if (Provider.ModelNotFoundError.isInstance(e)) {
      const { providerID, modelID, suggestions } = e.data
      const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
      Bus.publish(Session.Event.Error, {
        sessionID,
        error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
      })
    }
    throw e
  }
}

async function buildCommandParts(
  cmd: Awaited<ReturnType<typeof Command.get>>,
  agent: Agent.Info,
  taskModel: { providerID: ProviderID; modelID: ModelID },
  template: string,
  input: _CommandInput,
): Promise<_PromptInput["parts"]> {
  const templateParts = await resolvePromptParts(template)
  const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
  if (!isSubtask) return [...templateParts, ...(input.parts ?? [])]

  return [
    {
      type: "subtask" as const,
      agent: agent.name,
      description: cmd.description ?? "",
      command: input.command,
      model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
      // TODO: how can we make task tool accept a more complex input?
      prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
    },
  ]
}

async function resolveCommandUserModelAndAgent(
  cmd: Awaited<ReturnType<typeof Command.get>>,
  agent: Agent.Info,
  agentName: string,
  taskModel: { providerID: ProviderID; modelID: ModelID },
  input: _CommandInput,
): Promise<{ userAgent: string; userModel: { providerID: ProviderID; modelID: ModelID } }> {
  const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
  if (!isSubtask) return { userAgent: agentName, userModel: taskModel }

  const userAgent = input.agent ?? (await Agent.defaultAgent())
  const userModel = input.model ? Provider.parseModel(input.model) : await lastModel(input.sessionID)
  return { userAgent, userModel }
}

export async function command(input: _CommandInput) {
  log.info("command", input)
  const cmd = await Command.get(input.command)
  const agentName = cmd.agent ?? input.agent ?? (await Agent.defaultAgent())

  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

  const templateCommand = await cmd.template
  const interpolated = await interpolateTemplate(templateCommand, args, input.arguments)
  const template = await expandShellInTemplate(interpolated)

  const taskModel = await resolveCommandModel(cmd, input.model, input.sessionID)
  await validateModelExists(taskModel, input.sessionID)

  const agent = await validateCommandAgent(agentName, input.sessionID)
  const parts = await buildCommandParts(cmd, agent, taskModel, template, input)
  const { userAgent, userModel } = await resolveCommandUserModelAndAgent(cmd, agent, agentName, taskModel, input)

  await Plugin.trigger(
    "command.execute.before",
    { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
    { parts },
  )

  const result = (await prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    model: userModel,
    agent: userAgent,
    parts,
    variant: input.variant,
  })) as MessageV2.WithParts

  Bus.publish(Command.Event.Executed, {
    name: input.command,
    sessionID: input.sessionID,
    arguments: input.arguments,
    messageID: result.info.id,
  })

  return result
}

async function ensureTitle(input: {
  session: Session.Info
  history: MessageV2.WithParts[]
  providerID: ProviderID
  modelID: ModelID
}) {
  if (input.session.parentID) return
  if (!Session.isDefaultTitle(input.session.title)) return

  // Find first non-synthetic user message
  const firstRealUserIdx = input.history.findIndex(
    (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
  )
  if (firstRealUserIdx === -1) return

  const isFirst =
    input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
      .length === 1
  if (!isFirst) return

  // Gather all messages up to and including the first real user message for context
  // This includes any shell/subtask executions that preceded the user's first prompt
  const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
  const firstRealUser = contextMessages[firstRealUserIdx]

  // For subtask-only messages (from command invocations), extract the prompt directly
  // since toModelMessage converts subtask parts to generic "The following tool was executed by the user"
  const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
  const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

  const agent = await Agent.get("title")
  if (!agent) return
  const model = await iife(async () => {
    if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
    return (
      (await Provider.getSmallModel(input.providerID)) ?? (await Provider.getModel(input.providerID, input.modelID))
    )
  })
  const result = await LLM.stream({
    agent,
    user: firstRealUser.info as MessageV2.User,
    system: [],
    small: true,
    tools: {},
    model,
    abort: new AbortController().signal,
    sessionID: input.session.id,
    retries: 2,
    messages: [
      {
        role: "user",
        content: "Generate a title for this conversation:\n",
      },
      ...(hasOnlySubtaskParts
        ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
        : MessageV2.toModelMessages(contextMessages, model)),
    ],
  })
  const text = await result.text.catch((err) => log.error("failed to generate title", { error: err }))
  if (text) {
    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    if (!cleaned) return

    const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
    return Session.setTitle({ sessionID: input.session.id, title })
  }
}

export const SessionPrompt = {
  assertNotBusy,
  PromptInput,
  prompt,
  resolvePromptParts,
  cancel,
  LoopInput,
  loop,
  resolveTools,
  createStructuredOutputTool,
  ShellInput,
  shell,
  CommandInput,
  command,
} as const
