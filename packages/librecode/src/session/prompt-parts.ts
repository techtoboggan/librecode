import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { NamedError } from "@librecode/util/error"
import { PermissionNext } from "@/permission/next"
import type { Tool } from "@/tool/tool"
import { decodeDataUrl } from "@/util/data-url"
import { Agent } from "../agent/agent"
import { Bus } from "../bus"
import { ConfigMarkdown } from "../config/markdown"
import { FileTime } from "../file/time"
import { LSP } from "../lsp"
import { MCP } from "../mcp"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { ReadTool } from "../tool/read"
import { defer } from "../util/defer"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { Session } from "."
import { InstructionPrompt } from "./instruction"
import { MessageV2 } from "./message-v2"
import type { PartBuildCtx, PartDraft, PromptInputType } from "./prompt-schema"
import { MessageID, PartID, type SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

// ─── File-part resolution helpers ─────────────────────────────────────────────

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
  let start = parseInt(rawStart, 10)
  let end = rawEnd ? parseInt(rawEnd, 10) : undefined

  const resolved = await resolveSymbolRange(filePathURI, start, end)
  start = resolved.start
  end = resolved.end

  const offset = Math.max(start, 1)
  const limit = end ? end - (offset - 1) : undefined
  return { offset, limit }
}

async function processTextFilePart(
  part: Extract<PromptInputType["parts"][number], { type: "file" }>,
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
  part: Extract<PromptInputType["parts"][number], { type: "file" }>,
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
  part: Extract<PromptInputType["parts"][number], { type: "file" }>,
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
      url: `data:${part.mime};base64,${(await Filesystem.readBytes(filepath)).toString("base64")}`,
      mime: part.mime,
      // biome-ignore lint/style/noNonNullAssertion: file parts always have a filename
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
  part: Extract<PromptInputType["parts"][number], { type: "file" }>,
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

export async function processFilePart(
  part: Extract<PromptInputType["parts"][number], { type: "file" }>,
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

export function processAgentPart(
  part: Extract<PromptInputType["parts"][number], { type: "agent" }>,
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

// ─── resolvePromptParts ───────────────────────────────────────────────────────

export async function resolvePromptParts(template: string): Promise<PromptInputType["parts"]> {
  const parts: PromptInputType["parts"] = [
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

// ─── createUserMessage ────────────────────────────────────────────────────────

async function lastModelForParts(sessionID: SessionID) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export async function createUserMessage(input: PromptInputType) {
  const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
  if (!agent) throw new Error(`agent "${input.agent}" not found`)

  const model = input.model ?? agent.model ?? (await lastModelForParts(input.sessionID))
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
