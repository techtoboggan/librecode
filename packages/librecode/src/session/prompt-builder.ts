import fs from "node:fs/promises"
import path from "node:path"
import { NamedError } from "@librecode/util/error"
import { $ } from "bun"
import { ulid } from "ulid"
import { PermissionNext } from "@/permission/next"
import { TaskTool } from "@/tool/task"
import type { Tool } from "@/tool/tool"
import { iife } from "@/util/iife"
import { Agent, type AgentInfo } from "../agent/agent"
import { Bus } from "../bus"
import { appContextSegments, getAllAppContexts } from "../mcp/app-context"
import type { Command } from "../command"
import { ConfigMarkdown } from "../config/markdown"
import { Flag } from "../flag/flag"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import type { ModelID, ProviderID } from "../provider/schema"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { Session } from "."
import { SessionCompaction } from "./compaction"
import { InstructionPrompt } from "./instruction"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { planModeTemplate } from "./prompt/plan-mode-template"
import { resolvePromptParts } from "./prompt-parts"
import { MessageID, PartID, type SessionID } from "./schema"
import { SystemPrompt } from "./system"

export { createUserMessage, resolvePromptParts } from "./prompt-parts"

import type {
  BuildMcpToolOpts,
  CommandInputType,
  McpParsedOutput,
  McpToolContent,
  PromptInputType,
} from "./prompt-schema"
import { STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "./prompt-schema"

const log = Log.create({ service: "session.prompt" })

async function lastModelForBuilder(sessionID: SessionID) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

// ─── MCP content parsing ─────────────────────────────────────────────────────

export function parseMcpResourceContent(resource: McpToolContent & { type: "resource" }, out: McpParsedOutput): void {
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

export function parseMcpContent(content: McpToolContent[]): McpParsedOutput {
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

export function buildMcpToolExecute(opts: BuildMcpToolOpts): import("ai").Tool["execute"] {
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
    const { Truncate } = await import("@/tool/truncation")
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

// ─── System prompt assembly ───────────────────────────────────────────────────

export async function buildSystemPromptParts(
  agent: AgentInfo,
  model: Provider.Model,
  format: NonNullable<MessageV2.User["format"]>,
  sessionID?: SessionID,
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
  // ADR-005 §7 + v0.9.47: append per-app contexts pushed via
  // ui/update-model-context. Replace-on-write semantics live in the
  // store; here we just snapshot whatever's currently set for this
  // session and emit one delimited segment per app.
  if (sessionID) {
    const ctxSegments = appContextSegments(getAllAppContexts(sessionID))
    if (ctxSegments.length > 0) system.push(...ctxSegments)
  }
  return system
}

// ─── Reminder insertion ───────────────────────────────────────────────────────

export function wrapTextPart(part: MessageV2.Part): void {
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

export function wrapQueuedUserMessages(msgs: MessageV2.WithParts[], lastFinished: MessageV2.Assistant): void {
  for (const msg of msgs) {
    if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
    msg.parts.forEach(wrapTextPart)
  }
}

async function insertLegacyPlanReminder(
  messages: MessageV2.WithParts[],
  userMessage: MessageV2.WithParts,
  agent: AgentInfo,
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
  agent: AgentInfo,
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
        text: `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`,
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

export async function insertReminders(input: {
  messages: MessageV2.WithParts[]
  agent: AgentInfo
  session: Session.Info
}) {
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  if (!Flag.LIBRECODE_EXPERIMENTAL_PLAN_MODE) {
    await insertLegacyPlanReminder(input.messages, userMessage, input.agent)
    return input.messages
  }

  await insertPlanModeReminder(input.messages, userMessage, input.agent, input.session)
  return input.messages
}

// ─── Command processing helpers ───────────────────────────────────────────────

export const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
export const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
export const quoteTrimRegex = /^["']|["']$/g

export async function interpolateTemplate(
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
    template = `${template}\n\n${rawArguments}`
  }
  return template
}

export async function expandShellInTemplate(template: string): Promise<string> {
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

export async function resolveCommandModel(
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
  return await lastModelForBuilder(sessionID)
}

export async function validateCommandAgent(agentName: string, sessionID: SessionID): Promise<AgentInfo> {
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

export async function validateModelExists(
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

export async function buildCommandParts(
  cmd: Awaited<ReturnType<typeof Command.get>>,
  agent: AgentInfo,
  taskModel: { providerID: ProviderID; modelID: ModelID },
  template: string,
  input: CommandInputType,
): Promise<PromptInputType["parts"]> {
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
      // Task tool currently only accepts a string prompt. If a command template
      // contains image/file parts, they are dropped here — only the first text
      // part is forwarded. Lifting this requires: (a) TaskTool's zod input to
      // accept MessageV2.Part[] rather than a bare string, (b) task-runner to
      // forward those parts into the new session's first user message.
      // Blocked on: deciding whether TaskTool inputs should match user-message
      // inputs 1:1 or be a stricter subset.
      prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
    },
  ]
}

export async function resolveCommandUserModelAndAgent(
  cmd: Awaited<ReturnType<typeof Command.get>>,
  agent: AgentInfo,
  agentName: string,
  taskModel: { providerID: ProviderID; modelID: ModelID },
  input: CommandInputType,
): Promise<{ userAgent: string; userModel: { providerID: ProviderID; modelID: ModelID } }> {
  const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
  if (!isSubtask) return { userAgent: agentName, userModel: taskModel }

  const userAgent = input.agent ?? (await Agent.defaultAgent())
  const userModel = input.model ? Provider.parseModel(input.model) : await lastModelForBuilder(input.sessionID)
  return { userAgent, userModel }
}

// ─── Session compaction overflow check ────────────────────────────────────────

export async function checkAndHandleOverflow(input: {
  lastFinished: MessageV2.Assistant | undefined
  sessionID: SessionID
  lastUser: MessageV2.User
  model: Provider.Model
}): Promise<boolean> {
  const { lastFinished, sessionID, lastUser, model } = input
  const isOverflow =
    lastFinished &&
    lastFinished.summary !== true &&
    (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
  if (isOverflow) {
    await SessionCompaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
    return true
  }
  return false
}

// ─── Subtask execution helpers ────────────────────────────────────────────────

export async function finalizeSubtaskResult(
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

  await Plugin.trigger("tool.execute.after", { tool: "task", sessionID, callID: part.id, args: taskArgs }, result)

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

export async function addSubtaskSummaryMessage(lastUser: MessageV2.User, sessionID: SessionID): Promise<void> {
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

export async function executeSubtask(
  task: MessageV2.SubtaskPart,
  model: Provider.Model,
  lastUser: MessageV2.User,
  msgs: MessageV2.WithParts[],
  sessionID: SessionID,
  abort: AbortSignal,
  sessionPermission: PermissionNext.Ruleset,
): Promise<void> {
  // The init + message-update + execute sequence below is effectively a
  // bespoke reimplementation of the logic inside Session.prompt()'s tool
  // dispatcher. Extracting a shared `invokeTool(ctx, tool, input)` helper
  // would remove ~20 lines of duplication here and in similar paths
  // (e.g. skill invocation). Deferred because the invoker signatures
  // differ slightly — each caller constructs its own assistant-message
  // stub with different parent/mode wiring.
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
  if (!taskAgent) throw new Error(`task agent "${task.agent}" not found`)
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

// ─── ensureTitle ──────────────────────────────────────────────────────────────

export async function ensureTitle(input: {
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

    const title = cleaned.length > 100 ? `${cleaned.substring(0, 97)}...` : cleaned
    return Session.setTitle({ sessionID: input.session.id, title })
  }
}
