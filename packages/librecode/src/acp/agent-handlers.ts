import { pathToFileURL } from "node:url"
import type { AgentSideConnection, PermissionOption, PlanEntry } from "@agentclientprotocol/sdk"
import type {
  AssistantMessage,
  Event,
  OpencodeClient,
  SessionMessageResponse,
  ToolPart,
  ToolStateCompleted,
  ToolStateError,
} from "@librecode/sdk/v2"
import { z } from "zod"
import { Todo } from "@/session/todo"
import type { ModelID, ProviderID } from "../provider/schema"
import { Filesystem } from "../util/filesystem"
import { Hash } from "../util/hash"
import { Log } from "../util/log"
import { buildEditDiffContent, getContextLimit, getNewContent, toLocations, toToolKind } from "./agent-types"

const log = Log.create({ service: "acp-agent" })

export async function sendUsageUpdate(
  connection: AgentSideConnection,
  sdk: OpencodeClient,
  sessionID: string,
  directory: string,
): Promise<void> {
  const messages = await sdk.session
    .messages({ sessionID, directory }, { throwOnError: true })
    .then((x) => x.data)
    .catch((error) => {
      log.error("failed to fetch messages for usage update", { error })
      return undefined
    })

  if (!messages) return

  const assistantMessages = messages.filter(
    (m): m is { info: AssistantMessage; parts: SessionMessageResponse["parts"] } => m.info.role === "assistant",
  )

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  if (!lastAssistant) return

  const msg = lastAssistant.info
  if (!msg.providerID || !msg.modelID) return
  const size = await getContextLimit(sdk, msg.providerID as ProviderID, msg.modelID as ModelID, directory)

  if (!size) {
    // Cannot calculate usage without known context size
    return
  }

  const used = msg.tokens.input + (msg.tokens.cache?.read ?? 0)
  const totalCost = assistantMessages.reduce((sum, m) => sum + m.info.cost, 0)

  await connection
    .sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "usage_update",
        used,
        size,
        cost: { amount: totalCost, currency: "USD" },
      },
    })
    .catch((error) => {
      log.error("failed to send usage update", { error })
    })
}

export class AgentHandlers {
  constructor(
    private readonly connection: AgentSideConnection,
    private readonly sdk: OpencodeClient,
    private readonly permissionOptions: PermissionOption[],
    private readonly bashSnapshots: Map<string, string>,
    private readonly toolStarts: Set<string>,
    private readonly permissionQueues: Map<string, Promise<void>>,
    private readonly getSession: (sessionID: string) => { id: string; cwd: string } | undefined,
  ) {}

  async handleEvent(event: Event): Promise<void> {
    switch (event.type) {
      case "permission.asked":
        return this.handlePermissionAsked(event)
      case "message.part.updated":
        return this.handleMessagePartUpdated(event)
      case "message.part.delta":
        return this.handleMessagePartDelta(event)
    }
  }

  private async handlePermissionAsked(event: Extract<Event, { type: "permission.asked" }>): Promise<void> {
    const permission = event.properties
    const session = this.getSession(permission.sessionID)
    if (!session) return

    const prev = this.permissionQueues.get(permission.sessionID) ?? Promise.resolve()
    const next = prev
      .then(() => this.processPermissionRequest(permission, session))
      .catch((error) => {
        log.error("failed to handle permission", { error, permissionID: permission.id })
      })
      .finally(() => {
        if (this.permissionQueues.get(permission.sessionID) === next) {
          this.permissionQueues.delete(permission.sessionID)
        }
      })
    this.permissionQueues.set(permission.sessionID, next)
  }

  private async processPermissionRequest(
    permission: Extract<Event, { type: "permission.asked" }>["properties"],
    session: { id: string; cwd: string },
  ): Promise<void> {
    const directory = session.cwd
    const res = await this.requestPermissionFromACP(permission, directory)

    if (!res) return
    if (res.outcome.outcome !== "selected") {
      await this.sdk.permission.reply({ requestID: permission.id, reply: "reject", directory })
      return
    }

    if (res.outcome.optionId !== "reject" && permission.permission === "edit") {
      await this.applyEditPreview(session.id, permission.metadata || {})
    }

    await this.sdk.permission.reply({
      requestID: permission.id,
      reply: res.outcome.optionId as "once" | "always" | "reject",
      directory,
    })
  }

  private async requestPermissionFromACP(
    permission: Extract<Event, { type: "permission.asked" }>["properties"],
    directory: string,
  ) {
    return this.connection
      .requestPermission({
        sessionId: permission.sessionID,
        toolCall: {
          toolCallId: permission.tool?.callID ?? permission.id,
          status: "pending",
          title: permission.permission,
          rawInput: permission.metadata,
          kind: toToolKind(permission.permission),
          locations: toLocations(permission.permission, permission.metadata),
        },
        options: this.permissionOptions,
      })
      .catch(async (error) => {
        log.error("failed to request permission from ACP", {
          error,
          permissionID: permission.id,
          sessionID: permission.sessionID,
        })
        await this.sdk.permission.reply({ requestID: permission.id, reply: "reject", directory })
        return undefined
      })
  }

  private async applyEditPreview(sessionId: string, metadata: Record<string, unknown>): Promise<void> {
    const filepath = typeof metadata.filepath === "string" ? metadata.filepath : ""
    const diff = typeof metadata.diff === "string" ? metadata.diff : ""
    const content = (await Filesystem.exists(filepath)) ? await Filesystem.readText(filepath) : ""
    const newContent = getNewContent(content, diff)
    if (newContent) {
      this.connection.writeTextFile({ sessionId, path: filepath, content: newContent })
    }
  }

  async handleMessagePartUpdated(event: Extract<Event, { type: "message.part.updated" }>): Promise<void> {
    log.info("message part updated", { event: event.properties })
    const props = event.properties
    const part = props.part
    const session = this.getSession(part.sessionID)
    if (!session) return
    const sessionId = session.id

    if (part.type !== "tool") return

    await this.toolStart(sessionId, part)

    switch (part.state.status) {
      case "pending":
        this.bashSnapshots.delete(part.callID)
        return
      case "running":
        return this.handleEventToolPartRunning(sessionId, part)
      case "completed":
        return this.handleEventToolPartCompleted(sessionId, part, part.state)
      case "error":
        return this.handleEventToolPartError(sessionId, part, part.state)
    }
  }

  private async handleEventToolPartRunning(
    sessionId: string,
    part: Extract<Extract<Event, { type: "message.part.updated" }>["properties"]["part"], { type: "tool" }>,
  ): Promise<void> {
    const output = this.bashOutput(part)
    const content = []
    if (output) {
      const hash = Hash.fast(output)
      if (part.tool === "bash") {
        if (this.bashSnapshots.get(part.callID) === hash) {
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: part.callID,
                status: "in_progress",
                kind: toToolKind(part.tool),
                title: part.tool,
                locations: toLocations(part.tool, part.state.input),
                rawInput: part.state.input,
              },
            })
            .catch((error) => {
              log.error("failed to send tool in_progress to ACP", { error })
            })
          return
        }
        this.bashSnapshots.set(part.callID, hash)
      }
      content.push({ type: "content" as const, content: { type: "text" as const, text: output } })
    }
    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: part.callID,
          status: "in_progress",
          kind: toToolKind(part.tool),
          title: part.tool,
          locations: toLocations(part.tool, part.state.input),
          rawInput: part.state.input,
          ...(content.length > 0 && { content }),
        },
      })
      .catch((error) => {
        log.error("failed to send tool in_progress to ACP", { error })
      })
  }

  private async handleEventToolPartCompleted(
    sessionId: string,
    part: Extract<Extract<Event, { type: "message.part.updated" }>["properties"]["part"], { type: "tool" }>,
    state: ToolStateCompleted,
  ): Promise<void> {
    this.toolStarts.delete(part.callID)
    this.bashSnapshots.delete(part.callID)
    const kind = toToolKind(part.tool)
    const content = [{ type: "content" as const, content: { type: "text" as const, text: state.output } }]

    if (kind === "edit") {
      content.push(buildEditDiffContent(state.input) as never)
    }

    if (part.tool === "todowrite") {
      await this.sendTodoUpdate(sessionId, state.output)
    }

    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: part.callID,
          status: "completed",
          kind,
          content,
          title: state.title,
          rawInput: state.input,
          rawOutput: { output: state.output, metadata: state.metadata },
        },
      })
      .catch((error) => {
        log.error("failed to send tool completed to ACP", { error })
      })
  }

  private async handleEventToolPartError(
    sessionId: string,
    part: Extract<Extract<Event, { type: "message.part.updated" }>["properties"]["part"], { type: "tool" }>,
    state: ToolStateError,
  ): Promise<void> {
    this.toolStarts.delete(part.callID)
    this.bashSnapshots.delete(part.callID)
    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: part.callID,
          status: "failed",
          kind: toToolKind(part.tool),
          title: part.tool,
          rawInput: state.input,
          content: [{ type: "content", content: { type: "text", text: state.error } }],
          rawOutput: { error: state.error, metadata: state.metadata },
        },
      })
      .catch((error) => {
        log.error("failed to send tool error to ACP", { error })
      })
  }

  async handleMessagePartDelta(event: Extract<Event, { type: "message.part.delta" }>): Promise<void> {
    const props = event.properties
    const session = this.getSession(props.sessionID)
    if (!session) return
    const sessionId = session.id

    const message = await this.sdk.session
      .message(
        { sessionID: props.sessionID, messageID: props.messageID, directory: session.cwd },
        { throwOnError: true },
      )
      .then((x) => x.data)
      .catch((error) => {
        log.error("unexpected error when fetching message", { error })
        return undefined
      })

    if (!message || message.info.role !== "assistant") return

    const part = message.parts.find((p) => p.id === props.partID)
    if (!part) return

    if (part.type === "text" && props.field === "text" && part.ignored !== true) {
      await this.connection
        .sessionUpdate({
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: props.delta } },
        })
        .catch((error) => {
          log.error("failed to send text delta to ACP", { error })
        })
      return
    }

    if (part.type === "reasoning" && props.field === "text") {
      await this.connection
        .sessionUpdate({
          sessionId,
          update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: props.delta } },
        })
        .catch((error) => {
          log.error("failed to send reasoning delta to ACP", { error })
        })
    }
  }

  async processMessage(message: SessionMessageResponse): Promise<void> {
    log.debug("process message", message)
    if (message.info.role !== "assistant" && message.info.role !== "user") return
    const sessionId = message.info.sessionID

    for (const part of message.parts) {
      if (part.type === "tool") {
        await this.processToolPart(sessionId, part)
      } else if (part.type === "text") {
        await this.processTextPart(sessionId, part, message)
      } else if (part.type === "file") {
        await this.processFilePart(sessionId, part, message)
      } else if (part.type === "reasoning") {
        await this.processReasoningPart(sessionId, part)
      }
    }
  }

  async processToolPart(sessionId: string, part: ToolPart): Promise<void> {
    await this.toolStart(sessionId, part)
    switch (part.state.status) {
      case "pending":
        this.bashSnapshots.delete(part.callID)
        break
      case "running": {
        const output = this.bashOutput(part)
        const runningContent = []
        if (output) {
          runningContent.push({ type: "content" as const, content: { type: "text" as const, text: output } })
        }
        await this.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: part.callID,
              status: "in_progress",
              kind: toToolKind(part.tool),
              title: part.tool,
              locations: toLocations(part.tool, part.state.input),
              rawInput: part.state.input,
              ...(runningContent.length > 0 && { content: runningContent }),
            },
          })
          .catch((err) => {
            log.error("failed to send tool in_progress to ACP", { error: err })
          })
        break
      }
      case "completed":
        await this.processCompletedToolPart(sessionId, part, part.state)
        break
      case "error":
        this.toolStarts.delete(part.callID)
        this.bashSnapshots.delete(part.callID)
        await this.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: part.callID,
              status: "failed",
              kind: toToolKind(part.tool),
              title: part.tool,
              rawInput: part.state.input,
              content: [{ type: "content", content: { type: "text", text: part.state.error } }],
              rawOutput: { error: part.state.error, metadata: part.state.metadata },
            },
          })
          .catch((err) => {
            log.error("failed to send tool error to ACP", { error: err })
          })
        break
    }
  }

  private async processCompletedToolPart(sessionId: string, part: ToolPart, state: ToolStateCompleted): Promise<void> {
    this.toolStarts.delete(part.callID)
    this.bashSnapshots.delete(part.callID)
    const kind = toToolKind(part.tool)
    const content = [{ type: "content" as const, content: { type: "text" as const, text: state.output } }]

    if (kind === "edit") {
      content.push(buildEditDiffContent(state.input) as never)
    }

    if (part.tool === "todowrite") {
      await this.sendTodoUpdate(sessionId, state.output)
    }

    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: part.callID,
          status: "completed",
          kind,
          content,
          title: state.title,
          rawInput: state.input,
          rawOutput: { output: state.output, metadata: state.metadata },
        },
      })
      .catch((err) => {
        log.error("failed to send tool completed to ACP", { error: err })
      })
  }

  async sendTodoUpdate(sessionId: string, rawOutput: string): Promise<void> {
    const parsedTodos = z.array(Todo.Info).safeParse(JSON.parse(rawOutput))
    if (parsedTodos.success) {
      await this.connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "plan",
            entries: parsedTodos.data.map((todo) => {
              const status: PlanEntry["status"] =
                todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
              return { priority: "medium", status, content: todo.content }
            }),
          },
        })
        .catch((err) => {
          log.error("failed to send session update for todo", { error: err })
        })
    } else {
      log.error("failed to parse todo output", { error: parsedTodos.error })
    }
  }

  async processTextPart(
    sessionId: string,
    part: Extract<SessionMessageResponse["parts"][number], { type: "text" }>,
    message: SessionMessageResponse,
  ): Promise<void> {
    if (!part.text) return
    const audience = part.synthetic ? ["assistant" as const] : part.ignored ? ["user" as const] : undefined
    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
          content: {
            type: "text",
            text: part.text,
            ...(audience && { annotations: { audience } }),
          },
        },
      })
      .catch((err) => {
        log.error("failed to send text to ACP", { error: err })
      })
  }

  async processFilePart(
    sessionId: string,
    part: Extract<SessionMessageResponse["parts"][number], { type: "file" }>,
    message: SessionMessageResponse,
  ): Promise<void> {
    // Replay file attachments as appropriate ACP content blocks.
    // LibreCode stores files internally as { type: "file", url, filename, mime }.
    // We convert these back to ACP blocks based on the URL scheme and MIME type:
    // - file:// URLs → resource_link
    // - data: URLs with image/* → image block
    // - data: URLs with text/* or application/json → resource with text
    // - data: URLs with other types → resource with blob
    const url = part.url
    const filename = part.filename ?? "file"
    const mime = part.mime || "application/octet-stream"
    const messageChunk = message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk"

    if (url.startsWith("file://")) {
      await this.connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: messageChunk,
            content: { type: "resource_link", uri: url, name: filename, mimeType: mime },
          },
        })
        .catch((err) => {
          log.error("failed to send resource_link to ACP", { error: err })
        })
      return
    }

    if (!url.startsWith("data:")) return
    // URLs that don't match file:// or data: are skipped (unsupported)

    const base64Match = url.match(/^data:([^;]+);base64,(.*)$/)
    const dataMime = base64Match?.[1]
    const base64Data = base64Match?.[2] ?? ""
    const effectiveMime = dataMime || mime

    if (effectiveMime.startsWith("image/")) {
      await this.connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: messageChunk,
            content: { type: "image", mimeType: effectiveMime, data: base64Data, uri: pathToFileURL(filename).href },
          },
        })
        .catch((err) => {
          log.error("failed to send image to ACP", { error: err })
        })
      return
    }

    // Non-image: text types get decoded, binary types stay as blob
    const isText = effectiveMime.startsWith("text/") || effectiveMime === "application/json"
    const fileUri = pathToFileURL(filename).href
    const resource = isText
      ? { uri: fileUri, mimeType: effectiveMime, text: Buffer.from(base64Data, "base64").toString("utf-8") }
      : { uri: fileUri, mimeType: effectiveMime, blob: base64Data }

    await this.connection
      .sessionUpdate({ sessionId, update: { sessionUpdate: messageChunk, content: { type: "resource", resource } } })
      .catch((err) => {
        log.error("failed to send resource to ACP", { error: err })
      })
  }

  async processReasoningPart(
    sessionId: string,
    part: Extract<SessionMessageResponse["parts"][number], { type: "reasoning" }>,
  ): Promise<void> {
    if (!part.text) return
    await this.connection
      .sessionUpdate({
        sessionId,
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: part.text } },
      })
      .catch((err) => {
        log.error("failed to send reasoning to ACP", { error: err })
      })
  }

  bashOutput(part: ToolPart): string | undefined {
    if (part.tool !== "bash") return
    if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return
    const output = (part.state.metadata as Record<string, unknown>).output
    if (typeof output !== "string") return
    return output
  }

  async toolStart(sessionId: string, part: ToolPart): Promise<void> {
    if (this.toolStarts.has(part.callID)) return
    this.toolStarts.add(part.callID)
    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: part.callID,
          title: part.tool,
          kind: toToolKind(part.tool),
          status: "pending",
          locations: [],
          rawInput: {},
        },
      })
      .catch((error) => {
        log.error("failed to send tool pending to ACP", { error })
      })
  }
}
