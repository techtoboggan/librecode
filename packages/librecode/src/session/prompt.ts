import path from "path"
import z from "zod"
import { type SessionID, MessageID, PartID } from "./schema"
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
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { ulid } from "ulid"
import { spawn } from "child_process"
import { Command } from "../command"
import { SessionSummary } from "./summary"
import { NamedError } from "@librecode/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import type { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "./status"
import { Shell } from "@/shell/shell"
import { getShellArgs } from "./prompt/shell-invocations"
import { InstructionPrompt } from "./instruction"
import { PromptInput, LoopInput, ShellInput, CommandInput, STRUCTURED_OUTPUT_DESCRIPTION } from "./prompt-schema"
import type { LoopControl, ScanResult, NormalStepResult, PartDraft } from "./prompt-schema"
import {
  resolvePromptParts,
  createUserMessage,
  buildSystemPromptParts,
  insertReminders,
  wrapQueuedUserMessages,
  buildMcpToolExecute,
  interpolateTemplate,
  expandShellInTemplate,
  resolveCommandModel,
  validateCommandAgent,
  validateModelExists,
  buildCommandParts,
  resolveCommandUserModelAndAgent,
  checkAndHandleOverflow,
  argsRegex,
  quoteTrimRegex,
  finalizeSubtaskResult,
  addSubtaskSummaryMessage,
  executeSubtask,
  ensureTitle,
} from "./prompt-builder"

globalThis.AI_SDK_LOG_WARNINGS = false

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

// Re-export schemas and types for consumers that import from this module
export { PromptInput, LoopInput, ShellInput, CommandInput }
export { resolvePromptParts }

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

// ─── Scan helpers ─────────────────────────────────────────────────────────────

function collectPendingTasks(msg: MessageV2.WithParts): (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] {
  return msg.parts.filter(
    (part): part is MessageV2.CompactionPart | MessageV2.SubtaskPart =>
      part.type === "compaction" || part.type === "subtask",
  )
}

function updateScanState(msg: MessageV2.WithParts, acc: Omit<ScanResult, "tasks">): void {
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

// ─── Tool resolution ──────────────────────────────────────────────────────────

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

// ─── Normal step processing ───────────────────────────────────────────────────

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
  using _clearInstruction = defer(() => {
    InstructionPrompt.clear(processor.message.id)
  })

  const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
  const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

  const tools = await resolveTools({
    agent,
    session,
    model,
    tools: lastUser.tools,
    processor,
    bypassAgentCheck,
    messages: msgs,
  })

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

// ─── Loop helpers ─────────────────────────────────────────────────────────────

async function loadSessionModel(lastUser: MessageV2.User, sessionID: SessionID): Promise<Provider.Model> {
  return Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
    if (Provider.ModelNotFoundError.isInstance(e)) {
      const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
      Bus.publish(Session.Event.Error, {
        sessionID,
        error: new NamedError.Unknown({
          message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}`,
        }).toObject(),
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
    messages: msgs,
    parentID: lastUser.id,
    abort,
    sessionID,
    auto: task.auto,
    overflow: task.overflow,
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
    lastAssistant?.finish && !["tool-calls", "unknown"].includes(lastAssistant.finish) && lastUser.id < lastAssistant.id
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

  const handled = await checkAndHandleOverflow({ lastFinished, sessionID, lastUser, model })
  if (handled) return "continue"

  const stepResult = await runNormalStep({
    lastUser,
    lastFinished,
    msgs,
    model,
    session,
    sessionID,
    abort,
    step,
    structuredOutput: ctx.structuredOutput,
  })
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

// ─── shell command ────────────────────────────────────────────────────────────

export async function shell(input: z.infer<typeof ShellInput>) {
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
  const shellBin = Shell.preferred()
  const shellName = (
    process.platform === "win32" ? path.win32.basename(shellBin, ".exe") : path.basename(shellBin)
  ).toLowerCase()

  const args = getShellArgs(shellName, input.command)

  const cwd = Instance.directory
  const shellEnv = await Plugin.trigger(
    "shell.env",
    { cwd, sessionID: input.sessionID, callID: part.callID },
    { env: {} },
  )
  const proc = spawn(shellBin, args, {
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

// ─── command ──────────────────────────────────────────────────────────────────

export async function command(input: z.infer<typeof CommandInput>) {
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

// ─── Public API ───────────────────────────────────────────────────────────────

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
