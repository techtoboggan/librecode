import type { LanguageModelUsage, ProviderMetadata, TextStreamPart, ToolSet } from "ai"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { PermissionNext } from "@/permission/next"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import { Session } from "."
import { SessionCompaction } from "./compaction"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { SessionRetry } from "./retry"
import type { MessageID, SessionID } from "./schema"
import { PartID } from "./schema"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"

const processorLog = Log.create({ service: "session.processor" })

// Shape of the tool output returned by Tool.Info.execute and sent in tool-result events
type ToolResultOutput = {
  output: string
  title: string
  metadata: Record<string, unknown>
  attachments?: MessageV2.FilePart[]
}

// Narrowed shape of a tool-result stream event (the AI SDK types output as unknown)
type ToolResultEventShape = {
  toolCallId: string
  input?: unknown
  output: ToolResultOutput
}

// Mutable state passed through the stream dispatch loop
type StreamState = {
  toolcalls: Record<string, MessageV2.ToolPart>
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  currentText: MessageV2.TextPart | undefined
  reasoningMap: Record<string, MessageV2.ReasoningPart>
  shouldBreak: boolean
}

export namespace SessionProcessor {
  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: SessionID
    model: Provider.Model
    abort: AbortSignal
  }) {
    const state: StreamState = {
      toolcalls: {},
      snapshot: undefined,
      blocked: false,
      needsCompaction: false,
      currentText: undefined,
      reasoningMap: {},
      shouldBreak: false,
    }
    let attempt = 0

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return state.toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        processorLog.info("process")
        state.needsCompaction = false
        state.shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true
        return runProcessLoop(
          streamInput,
          state,
          input,
          () => attempt,
          (n) => {
            attempt = n
          },
        )
      },
    }
    return result
  }
}

type ProcessInput = {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
  abort: AbortSignal
}

async function runProcessLoop(
  streamInput: LLM.StreamInput,
  state: StreamState,
  input: ProcessInput,
  getAttempt: () => number,
  setAttempt: (n: number) => void,
): Promise<"compact" | "stop" | "continue"> {
  while (true) {
    const shouldRetry = await runStreamIteration(streamInput, state, input, getAttempt, setAttempt)
    if (shouldRetry) continue
    return resolveProcessResult(state, input.assistantMessage)
  }
}

async function runStreamIteration(
  streamInput: LLM.StreamInput,
  state: StreamState,
  input: ProcessInput,
  getAttempt: () => number,
  setAttempt: (n: number) => void,
): Promise<boolean> {
  try {
    state.currentText = undefined
    state.reasoningMap = {}
    const stream = await LLM.stream(streamInput)
    await drainStream(stream.fullStream, state, input)
  } catch (e: unknown) {
    const handled = await handleStreamError(
      e,
      input.assistantMessage,
      input.sessionID,
      input.model,
      getAttempt(),
      input.abort,
    )
    if (handled.type === "retry") {
      setAttempt(handled.attempt)
      return true
    }
    if (handled.type === "compact") state.needsCompaction = true
  }
  state.snapshot = await flushSnapshot(state.snapshot, input.assistantMessage, input.sessionID)
  await abortPendingTools(input.assistantMessage.id)
  input.assistantMessage.time.completed = Date.now()
  await Session.updateMessage(input.assistantMessage)
  return false
}

function resolveProcessResult(
  state: StreamState,
  assistantMessage: MessageV2.Assistant,
): "compact" | "stop" | "continue" {
  if (state.needsCompaction) return "compact"
  if (state.blocked) return "stop"
  if (assistantMessage.error) return "stop"
  return "continue"
}

async function drainStream(
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>,
  state: StreamState,
  input: {
    assistantMessage: MessageV2.Assistant
    sessionID: SessionID
    model: Provider.Model
    abort: AbortSignal
  },
): Promise<void> {
  for await (const value of fullStream) {
    input.abort.throwIfAborted()
    await dispatchStreamEvent(value, state, input)
    if (state.needsCompaction) break
  }
}

async function dispatchStreamEvent(
  value: TextStreamPart<ToolSet>,
  state: StreamState,
  input: {
    assistantMessage: MessageV2.Assistant
    sessionID: SessionID
    model: Provider.Model
    abort: AbortSignal
  },
): Promise<void> {
  switch (value.type) {
    case "start":
      await handleStart(input.sessionID)
      break
    case "reasoning-start":
      state.reasoningMap = await handleReasoningStart(value, state.reasoningMap, input.assistantMessage)
      break
    case "reasoning-delta":
      await handleReasoningDelta(value, state.reasoningMap)
      break
    case "reasoning-end":
      state.reasoningMap = await handleReasoningEnd(value, state.reasoningMap)
      break
    case "tool-input-start":
      state.toolcalls[value.id] = await handleToolInputStart(value, state.toolcalls, input.assistantMessage)
      break
    case "tool-input-delta":
      break
    case "tool-input-end":
      break
    case "tool-call":
      await handleToolCallEvent(value, state, input.assistantMessage)
      break
    case "tool-result":
      await handleToolResultEvent(value as ToolResultEventShape, state)
      break
    case "tool-error":
      await handleToolErrorEvent(value, state)
      break
    case "error":
      throw value.error
    case "start-step":
      state.snapshot = await handleStartStep(input.assistantMessage, input.sessionID)
      break
    case "finish-step":
      await handleFinishStepEvent(value, state, input.assistantMessage, input.sessionID, input.model)
      break
    case "text-start":
      state.currentText = await handleTextStart(input.assistantMessage)
      break
    case "text-delta":
      await handleTextDelta(value, state.currentText)
      break
    case "text-end":
      state.currentText = await handleTextEnd(value, state.currentText, input.sessionID, input.assistantMessage.id)
      break
    case "finish":
      break
    default:
      processorLog.info("unhandled", { ...value })
      break
  }
}

async function handleToolCallEvent(
  value: { toolCallId: string; toolName: string; input: unknown; providerMetadata?: ProviderMetadata },
  state: StreamState,
  assistantMessage: MessageV2.Assistant,
): Promise<void> {
  const doomResult = await handleToolCall(value, state.toolcalls, assistantMessage)
  if (doomResult) state.toolcalls[value.toolCallId] = doomResult
}

async function handleToolResultEvent(value: ToolResultEventShape, state: StreamState): Promise<void> {
  await handleToolResult(value, state.toolcalls)
  delete state.toolcalls[value.toolCallId]
}

async function handleToolErrorEvent(
  value: { toolCallId: string; input?: unknown; error: unknown },
  state: StreamState,
): Promise<void> {
  const wasRejected = await handleToolError(value, state.toolcalls)
  if (wasRejected) state.blocked = state.shouldBreak
  delete state.toolcalls[value.toolCallId]
}

async function handleFinishStepEvent(
  value: { finishReason: string; usage: LanguageModelUsage; providerMetadata?: ProviderMetadata },
  state: StreamState,
  assistantMessage: MessageV2.Assistant,
  sessionID: SessionID,
  model: Provider.Model,
): Promise<void> {
  state.needsCompaction = await handleFinishStep(value, assistantMessage, sessionID, model, state.snapshot)
  if (!state.needsCompaction) state.snapshot = undefined
}

async function handleStart(sessionID: SessionID): Promise<void> {
  SessionStatus.set(sessionID, { type: "busy" })
}

async function handleReasoningStart(
  value: { id: string; providerMetadata?: ProviderMetadata },
  reasoningMap: Record<string, MessageV2.ReasoningPart>,
  assistantMessage: MessageV2.Assistant,
): Promise<Record<string, MessageV2.ReasoningPart>> {
  if (value.id in reasoningMap) return reasoningMap
  const reasoningPart: MessageV2.ReasoningPart = {
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "reasoning" as const,
    text: "",
    time: { start: Date.now() },
    metadata: value.providerMetadata,
  }
  const updated = { ...reasoningMap }
  updated[value.id] = reasoningPart
  await Session.updatePart(reasoningPart)
  return updated
}

async function handleReasoningDelta(
  value: { id: string; text: string; providerMetadata?: ProviderMetadata },
  reasoningMap: Record<string, MessageV2.ReasoningPart>,
): Promise<void> {
  if (!(value.id in reasoningMap)) return
  const part = reasoningMap[value.id]
  part.text += value.text
  if (value.providerMetadata) part.metadata = value.providerMetadata
  await Session.updatePartDelta({
    sessionID: part.sessionID,
    messageID: part.messageID,
    partID: part.id,
    field: "text",
    delta: value.text,
  })
}

async function handleReasoningEnd(
  value: { id: string; providerMetadata?: ProviderMetadata },
  reasoningMap: Record<string, MessageV2.ReasoningPart>,
): Promise<Record<string, MessageV2.ReasoningPart>> {
  if (!(value.id in reasoningMap)) return reasoningMap
  const part = reasoningMap[value.id]
  part.text = part.text.trimEnd()
  part.time = { ...part.time, end: Date.now() }
  if (value.providerMetadata) part.metadata = value.providerMetadata
  await Session.updatePart(part)
  const updated = { ...reasoningMap }
  delete updated[value.id]
  return updated
}

async function handleToolInputStart(
  value: { id: string; toolName: string },
  toolcalls: Record<string, MessageV2.ToolPart>,
  assistantMessage: MessageV2.Assistant,
): Promise<MessageV2.ToolPart> {
  const part = await Session.updatePart({
    id: toolcalls[value.id]?.id ?? PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    tool: value.toolName,
    callID: value.id,
    state: { status: "pending", input: {}, raw: "" },
  })
  return part as MessageV2.ToolPart
}

async function checkDoomLoop(
  value: { toolCallId: string; toolName: string; input: unknown },
  assistantMessage: MessageV2.Assistant,
): Promise<void> {
  const parts = await MessageV2.parts(assistantMessage.id)
  const lastThree = parts.slice(-3)
  const isDoomLoop =
    lastThree.length === 3 &&
    lastThree.every(
      (p) =>
        p.type === "tool" &&
        p.tool === value.toolName &&
        p.state.status !== "pending" &&
        JSON.stringify(p.state.input) === JSON.stringify(value.input),
    )
  if (!isDoomLoop) return
  const agent = await Agent.get(assistantMessage.agent)
  if (!agent) return
  await PermissionNext.ask({
    permission: "doom_loop",
    patterns: [value.toolName],
    sessionID: assistantMessage.sessionID,
    metadata: { tool: value.toolName, input: value.input },
    always: [value.toolName],
    ruleset: agent.permission,
  })
}

async function handleToolCall(
  value: { toolCallId: string; toolName: string; input: unknown; providerMetadata?: ProviderMetadata },
  toolcalls: Record<string, MessageV2.ToolPart>,
  assistantMessage: MessageV2.Assistant,
): Promise<MessageV2.ToolPart | undefined> {
  const match = toolcalls[value.toolCallId]
  if (!match) return undefined
  const part = await Session.updatePart({
    ...match,
    tool: value.toolName,
    state: { status: "running", input: value.input as Record<string, unknown>, time: { start: Date.now() } },
    metadata: value.providerMetadata,
  })
  await checkDoomLoop(value, assistantMessage)
  return part as MessageV2.ToolPart
}

async function handleToolResult(
  value: ToolResultEventShape,
  toolcalls: Record<string, MessageV2.ToolPart>,
): Promise<void> {
  const match = toolcalls[value.toolCallId]
  if (!match || match.state.status !== "running") return
  await Session.updatePart({
    ...match,
    state: {
      status: "completed",
      input: (value.input ?? match.state.input) as Record<string, unknown>,
      output: value.output.output,
      metadata: value.output.metadata,
      title: value.output.title,
      time: { start: match.state.time.start, end: Date.now() },
      attachments: value.output.attachments,
    },
  })
}

async function handleToolError(
  value: { toolCallId: string; input?: unknown; error: unknown },
  toolcalls: Record<string, MessageV2.ToolPart>,
): Promise<boolean> {
  const match = toolcalls[value.toolCallId]
  if (!match || match.state.status !== "running") return false
  await Session.updatePart({
    ...match,
    state: {
      status: "error",
      input: (value.input ?? match.state.input) as Record<string, unknown>,
      error: (value.error as Error).toString(),
      time: { start: match.state.time.start, end: Date.now() },
    },
  })
  return value.error instanceof PermissionNext.RejectedError || value.error instanceof Question.RejectedError
}

async function handleStartStep(
  assistantMessage: MessageV2.Assistant,
  sessionID: SessionID,
): Promise<string | undefined> {
  const snap = await Snapshot.track()
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID,
    snapshot: snap,
    type: "step-start",
  })
  return snap
}

async function handleFinishStep(
  value: { finishReason: string; usage: LanguageModelUsage; providerMetadata?: ProviderMetadata },
  assistantMessage: MessageV2.Assistant,
  sessionID: SessionID,
  model: Provider.Model,
  snapshot: string | undefined,
): Promise<boolean> {
  const usage = Session.getUsage({ model, usage: value.usage, metadata: value.providerMetadata })
  assistantMessage.finish = value.finishReason
  assistantMessage.cost += usage.cost
  assistantMessage.tokens = usage.tokens
  await Session.updatePart({
    id: PartID.ascending(),
    reason: value.finishReason,
    snapshot: await Snapshot.track(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "step-finish",
    tokens: usage.tokens,
    cost: usage.cost,
  })
  await Session.updateMessage(assistantMessage)
  if (snapshot) {
    await flushSnapshotPatch(snapshot, assistantMessage, sessionID)
  }
  SessionSummary.summarize({ sessionID, messageID: assistantMessage.parentID })
  if (!assistantMessage.summary && (await SessionCompaction.isOverflow({ tokens: usage.tokens, model }))) {
    return true
  }
  return false
}

async function flushSnapshotPatch(
  snapshot: string,
  assistantMessage: MessageV2.Assistant,
  sessionID: SessionID,
): Promise<void> {
  const patch = await Snapshot.patch(snapshot)
  if (patch.files.length) {
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: assistantMessage.id,
      sessionID,
      type: "patch",
      hash: patch.hash,
      files: patch.files,
    })
  }
}

async function handleTextStart(assistantMessage: MessageV2.Assistant): Promise<MessageV2.TextPart> {
  const textPart: MessageV2.TextPart = {
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "text",
    text: "",
    time: { start: Date.now() },
    metadata: undefined,
  }
  await Session.updatePart(textPart)
  return textPart
}

async function handleTextDelta(
  value: { text: string; providerMetadata?: ProviderMetadata },
  currentText: MessageV2.TextPart | undefined,
): Promise<void> {
  if (!currentText) return
  currentText.text += value.text
  if (value.providerMetadata) currentText.metadata = value.providerMetadata
  await Session.updatePartDelta({
    sessionID: currentText.sessionID,
    messageID: currentText.messageID,
    partID: currentText.id,
    field: "text",
    delta: value.text,
  })
}

async function handleTextEnd(
  value: { providerMetadata?: ProviderMetadata },
  currentText: MessageV2.TextPart | undefined,
  sessionID: SessionID,
  messageID: MessageID,
): Promise<undefined> {
  if (!currentText) return undefined
  currentText.text = currentText.text.trimEnd()
  const textOutput = await Plugin.trigger(
    "experimental.text.complete",
    { sessionID, messageID, partID: currentText.id },
    { text: currentText.text },
  )
  currentText.text = textOutput.text
  currentText.time = { start: Date.now(), end: Date.now() }
  if (value.providerMetadata) currentText.metadata = value.providerMetadata
  await Session.updatePart(currentText)
  return undefined
}

type StreamErrorResult = { type: "compact" } | { type: "retry"; attempt: number } | { type: "error" }

async function handleStreamError(
  e: unknown,
  assistantMessage: MessageV2.Assistant,
  sessionID: SessionID,
  model: Provider.Model,
  currentAttempt: number,
  abort: AbortSignal,
): Promise<StreamErrorResult> {
  processorLog.error("process", {
    error: e,
    stack: JSON.stringify((e as Error).stack),
  })
  const error = MessageV2.fromError(e, { providerID: model.providerID })
  if (MessageV2.ContextOverflowError.isInstance(error)) {
    Bus.publish(Session.Event.Error, { sessionID, error })
    return { type: "compact" }
  }
  const retry = SessionRetry.retryable(error)
  if (retry !== undefined) {
    const newAttempt = currentAttempt + 1
    const delay = SessionRetry.delay(newAttempt, error.name === "APIError" ? error : undefined)
    SessionStatus.set(sessionID, {
      type: "retry",
      attempt: newAttempt,
      message: retry,
      next: Date.now() + delay,
    })
    await SessionRetry.sleep(delay, abort).catch(() => {})
    return { type: "retry", attempt: newAttempt }
  }
  assistantMessage.error = error
  Bus.publish(Session.Event.Error, { sessionID: assistantMessage.sessionID, error: assistantMessage.error })
  SessionStatus.set(sessionID, { type: "idle" })
  return { type: "error" }
}

async function flushSnapshot(
  snapshot: string | undefined,
  assistantMessage: MessageV2.Assistant,
  sessionID: SessionID,
): Promise<undefined> {
  if (!snapshot) return undefined
  await flushSnapshotPatch(snapshot, assistantMessage, sessionID)
  return undefined
}

async function abortPendingTools(messageID: MessageID): Promise<void> {
  const parts = await MessageV2.parts(messageID)
  for (const part of parts) {
    if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
      await Session.updatePart({
        ...part,
        state: {
          ...part.state,
          status: "error",
          error: "Tool execution aborted",
          time: { start: Date.now(), end: Date.now() },
        },
      })
    }
  }
}
