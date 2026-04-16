import { EOL } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  createOpencodeClient,
  type Event,
  type EventMessagePartUpdated,
  type EventMessageUpdated,
  type EventSessionError,
  type OpencodeClient,
  type ReasoningPart,
  type TextPart,
  type ToolPart,
} from "@librecode/sdk/v2"
import type { Argv } from "yargs"
import { Agent } from "../../agent/agent"
import type { PermissionNext } from "../../permission/next"
import { Provider } from "../../provider/provider"
import { Server } from "../../server/server"
import type { BashTool } from "../../tool/bash"
import type { CodeSearchTool } from "../../tool/codesearch"
import type { EditTool } from "../../tool/edit"
import type { GlobTool } from "../../tool/glob"
import type { GrepTool } from "../../tool/grep"
import type { ListTool } from "../../tool/ls"
import type { ReadTool } from "../../tool/read"
import type { SkillTool } from "../../tool/skill"
import type { TaskTool } from "../../tool/task"
import type { TodoWriteTool } from "../../tool/todo"
import type { Tool } from "../../tool/tool"
import type { WebFetchTool } from "../../tool/webfetch"
import type { WebSearchTool } from "../../tool/websearch"
import type { WriteTool } from "../../tool/write"
import { Filesystem } from "../../util/filesystem"
import { Locale } from "../../util/locale"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { cmd } from "./cmd"

type ToolProps<T extends Tool.Info> = {
  input: Tool.InferParameters<T>
  metadata: Tool.InferMetadata<T>
  part: ToolPart
}

function props<T extends Tool.Info>(part: ToolPart): ToolProps<T> {
  const state = part.state
  return {
    input: state.input as Tool.InferParameters<T>,
    metadata: ("metadata" in state ? state.metadata : {}) as Tool.InferMetadata<T>,
    part,
  }
}

type Inline = {
  icon: string
  title: string
  description?: string
}

function inline(info: Inline) {
  const suffix = info.description ? `${UI.Style.TEXT_DIM} ${info.description}${UI.Style.TEXT_NORMAL}` : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function block(info: Inline, output?: string) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  UI.println(output)
  UI.empty()
}

function fallback(part: ToolPart) {
  const state = part.state
  const input = "input" in state ? state.input : undefined
  const title =
    ("title" in state && state.title ? state.title : undefined) ||
    (input && typeof input === "object" && Object.keys(input).length > 0 ? JSON.stringify(input) : "Unknown")
  inline({
    icon: "⚙",
    title: `${part.tool} ${title}`,
  })
}

function glob(info: ToolProps<typeof GlobTool>) {
  const root = info.input.path ?? ""
  const title = `Glob "${info.input.pattern}"`
  const suffix = root ? `in ${normalizePath(root)}` : ""
  const num = info.metadata.count
  const description =
    num === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${num} ${num === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title,
    ...(description && { description }),
  })
}

function grep(info: ToolProps<typeof GrepTool>) {
  const root = info.input.path ?? ""
  const title = `Grep "${info.input.pattern}"`
  const suffix = root ? `in ${normalizePath(root)}` : ""
  const num = info.metadata.matches
  const description =
    num === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${num} ${num === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title,
    ...(description && { description }),
  })
}

function list(info: ToolProps<typeof ListTool>) {
  const dir = info.input.path ? normalizePath(info.input.path) : ""
  inline({
    icon: "→",
    title: dir ? `List ${dir}` : "List",
  })
}

function read(info: ToolProps<typeof ReadTool>) {
  const file = normalizePath(info.input.filePath)
  const pairs = Object.entries(info.input).filter(([key, value]) => {
    if (key === "filePath") return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  const description = pairs.length ? `[${pairs.map(([key, value]) => `${key}=${value}`).join(", ")}]` : undefined
  inline({
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  })
}

function write(info: ToolProps<typeof WriteTool>) {
  block(
    {
      icon: "←",
      title: `Write ${normalizePath(info.input.filePath)}`,
    },
    info.part.state.status === "completed" ? info.part.state.output : undefined,
  )
}

function webfetch(info: ToolProps<typeof WebFetchTool>) {
  inline({
    icon: "%",
    title: `WebFetch ${info.input.url}`,
  })
}

function edit(info: ToolProps<typeof EditTool>) {
  const title = normalizePath(info.input.filePath)
  const diff = info.metadata.diff
  block(
    {
      icon: "←",
      title: `Edit ${title}`,
    },
    diff,
  )
}

function codesearch(info: ToolProps<typeof CodeSearchTool>) {
  inline({
    icon: "◇",
    title: `Exa Code Search "${info.input.query}"`,
  })
}

function websearch(info: ToolProps<typeof WebSearchTool>) {
  inline({
    icon: "◈",
    title: `Exa Web Search "${info.input.query}"`,
  })
}

function task(info: ToolProps<typeof TaskTool>) {
  const input = info.part.state.input
  const status = info.part.state.status
  const subagent =
    typeof input.subagent_type === "string" && input.subagent_type.trim().length > 0 ? input.subagent_type : "unknown"
  const agent = Locale.titlecase(subagent)
  const desc =
    typeof input.description === "string" && input.description.trim().length > 0 ? input.description : undefined
  const icon = status === "error" ? "✗" : status === "running" ? "•" : "✓"
  const name = desc ?? `${agent} Task`
  inline({
    icon,
    title: name,
    description: desc ? `${agent} Agent` : undefined,
  })
}

function skill(info: ToolProps<typeof SkillTool>) {
  inline({
    icon: "→",
    title: `Skill "${info.input.name}"`,
  })
}

function bash(info: ToolProps<typeof BashTool>) {
  const output = info.part.state.status === "completed" ? info.part.state.output?.trim() : undefined
  block(
    {
      icon: "$",
      title: `${info.input.command}`,
    },
    output,
  )
}

function todo(info: ToolProps<typeof TodoWriteTool>) {
  block(
    {
      icon: "#",
      title: "Todos",
    },
    info.input.todos.map((item) => `${item.status === "completed" ? "[x]" : "[ ]"} ${item.content}`).join("\n"),
  )
}

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) return path.relative(process.cwd(), input) || "."
  return input
}

const TOOL_DISPATCH: Record<string, (part: ToolPart) => void> = {
  bash: (part) => bash(props<typeof BashTool>(part)),
  glob: (part) => glob(props<typeof GlobTool>(part)),
  grep: (part) => grep(props<typeof GrepTool>(part)),
  list: (part) => list(props<typeof ListTool>(part)),
  read: (part) => read(props<typeof ReadTool>(part)),
  write: (part) => write(props<typeof WriteTool>(part)),
  webfetch: (part) => webfetch(props<typeof WebFetchTool>(part)),
  edit: (part) => edit(props<typeof EditTool>(part)),
  codesearch: (part) => codesearch(props<typeof CodeSearchTool>(part)),
  websearch: (part) => websearch(props<typeof WebSearchTool>(part)),
  task: (part) => task(props<typeof TaskTool>(part)),
  todowrite: (part) => todo(props<typeof TodoWriteTool>(part)),
  skill: (part) => skill(props<typeof SkillTool>(part)),
}

function dispatchTool(part: ToolPart): void {
  try {
    const handler = TOOL_DISPATCH[part.tool]
    if (handler) handler(part)
    else fallback(part)
  } catch {
    fallback(part)
  }
}

function warnAgent(msg: string): void {
  UI.println(`${UI.Style.TEXT_WARNING_BOLD}!`, UI.Style.TEXT_NORMAL, msg)
}

async function resolveAgentRemote(
  agentName: string,
  attachURL: string,
  sdk: OpencodeClient,
): Promise<string | undefined> {
  const modes = await sdk.app
    .agents(undefined, { throwOnError: true })
    .then((x) => x.data ?? [])
    .catch(() => undefined)

  if (!modes) {
    warnAgent(`failed to list agents from ${attachURL}. Falling back to default agent`)
    return undefined
  }

  const found = modes.find((a) => a.name === agentName)
  if (!found) {
    warnAgent(`agent "${agentName}" not found. Falling back to default agent`)
    return undefined
  }

  if (found.mode === "subagent") {
    warnAgent(`agent "${agentName}" is a subagent, not a primary agent. Falling back to default agent`)
    return undefined
  }

  return agentName
}

async function resolveAgent(
  agentName: string | undefined,
  attachURL: string | undefined,
  sdk: OpencodeClient,
): Promise<string | undefined> {
  if (!agentName) return undefined
  if (attachURL) return resolveAgentRemote(agentName, attachURL, sdk)

  const entry = await Agent.get(agentName)
  if (!entry) {
    warnAgent(`agent "${agentName}" not found. Falling back to default agent`)
    return undefined
  }
  if (entry.mode === "subagent") {
    warnAgent(`agent "${agentName}" is a subagent, not a primary agent. Falling back to default agent`)
    return undefined
  }
  return agentName
}

type FileAttachment = { type: "file"; url: string; filename: string; mime: string }

async function buildFileAttachments(filePaths: string[]): Promise<FileAttachment[]> {
  const files: FileAttachment[] = []
  for (const filePath of filePaths) {
    const resolvedPath = path.resolve(process.cwd(), filePath)
    if (!(await Filesystem.exists(resolvedPath))) {
      UI.error(`File not found: ${filePath}`)
      process.exit(1)
    }
    const mime = (await Filesystem.isDir(resolvedPath)) ? "application/x-directory" : "text/plain"
    files.push({ type: "file", url: pathToFileURL(resolvedPath).href, filename: path.basename(resolvedPath), mime })
  }
  return files
}

function resolveDirectory(dir: string | undefined, attach: string | undefined): string | undefined {
  if (!dir) return undefined
  if (attach) return dir
  try {
    process.chdir(dir)
    return process.cwd()
  } catch {
    UI.error(`Failed to change directory to ${dir}`)
    process.exit(1)
  }
}

function buildAuthHeaders(password: string | undefined): Record<string, string> | undefined {
  const pw = password ?? process.env.LIBRECODE_SERVER_PASSWORD
  if (!pw) return undefined
  const username = process.env.LIBRECODE_SERVER_USERNAME ?? "librecode"
  const auth = `Basic ${Buffer.from(`${username}:${pw}`).toString("base64")}`
  return { Authorization: auth }
}

type EventEmitter = (type: string, data: Record<string, unknown>) => boolean

type EventLoopCtx = {
  sdk: OpencodeClient
  sessionID: string
  format: string
  thinking: boolean
}

function makeEmitter(ctx: EventLoopCtx): EventEmitter {
  return (type, data) => {
    if (ctx.format !== "json") return false
    process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID: ctx.sessionID, ...data }) + EOL)
    return true
  }
}

function handleToolPart(
  part: ToolPart,
  toggles: Map<string, boolean>,
  emit: EventEmitter,
  format: string,
): "continue" | "skip" {
  if (part.state.status === "completed" || part.state.status === "error") {
    if (emit("tool_use", { part })) return "continue"
    if (part.state.status === "completed") {
      dispatchTool(part)
      return "continue"
    }
    inline({ icon: "✗", title: `${part.tool} failed` })
    UI.error(part.state.error)
    return "skip"
  }
  if (part.tool === "task" && part.state.status === "running" && format !== "json") {
    if (toggles.get(part.id) === true) return "continue"
    task(props<typeof TaskTool>(part))
    toggles.set(part.id, true)
  }
  return "skip"
}

function handleTextPart(part: TextPart, emit: EventEmitter): "continue" | "skip" {
  if (!part.time?.end) return "skip"
  if (emit("text", { part })) return "continue"
  const text = part.text.trim()
  if (!text) return "continue"
  if (!process.stdout.isTTY) {
    process.stdout.write(text + EOL)
    return "continue"
  }
  UI.empty()
  UI.println(text)
  UI.empty()
  return "continue"
}

function handleReasoningPart(part: ReasoningPart, emit: EventEmitter, thinking: boolean): "continue" | "skip" {
  if (!part.time?.end || !thinking) return "skip"
  if (emit("reasoning", { part })) return "continue"
  const text = part.text.trim()
  if (!text) return "continue"
  const line = `Thinking: ${text}`
  if (process.stdout.isTTY) {
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
    UI.empty()
    return "continue"
  }
  process.stdout.write(line + EOL)
  return "continue"
}

async function handlePermissionAsked(
  permission: { sessionID: string; id: string; permission: string; patterns: string[] },
  sessionID: string,
  sdk: OpencodeClient,
): Promise<void> {
  if (permission.sessionID !== sessionID) return
  UI.println(
    `${UI.Style.TEXT_WARNING_BOLD}!`,
    UI.Style.TEXT_NORMAL +
      `permission requested: ${permission.permission} (${permission.patterns.join(", ")}); auto-rejecting`,
  )
  await sdk.permission.reply({ requestID: permission.id, reply: "reject" })
}

function handleMessagePartUpdated(
  event: EventMessagePartUpdated,
  ctx: EventLoopCtx,
  emit: EventEmitter,
  toggles: Map<string, boolean>,
): "continue" | "skip" {
  const part = event.properties.part
  if (part.sessionID !== ctx.sessionID) return "continue"
  if (part.type === "tool") {
    if (handleToolPart(part, toggles, emit, ctx.format) === "continue") return "continue"
  }
  if (part.type === "step-start" && emit("step_start", { part })) return "continue"
  if (part.type === "step-finish" && emit("step_finish", { part })) return "continue"
  if (part.type === "text" && handleTextPart(part, emit) === "continue") return "continue"
  if (part.type === "reasoning" && handleReasoningPart(part, emit, ctx.thinking) === "continue") return "continue"
  return "skip"
}

function handleSessionError(
  event: EventSessionError,
  ctx: EventLoopCtx,
  emit: EventEmitter,
  errorRef: { value: string | undefined },
): "continue" | "skip" {
  const evtProps = event.properties
  if (evtProps.sessionID !== ctx.sessionID || !evtProps.error) return "continue"
  let err = String(evtProps.error.name)
  if ("data" in evtProps.error && evtProps.error.data && "message" in evtProps.error.data) {
    err = String(evtProps.error.data.message)
  }
  errorRef.value = errorRef.value ? errorRef.value + EOL + err : err
  if (emit("error", { error: evtProps.error })) return "continue"
  UI.error(err)
  return "skip"
}

type LoopState = {
  ctx: EventLoopCtx
  emit: EventEmitter
  toggles: Map<string, boolean>
  errorRef: { value: string | undefined }
}

function handleMessageUpdated(event: EventMessageUpdated, state: LoopState): void {
  const { ctx, toggles } = state
  if (event.properties.info.role === "assistant" && ctx.format !== "json" && toggles.get("start") !== true) {
    UI.empty()
    UI.println(`> ${event.properties.info.agent} · ${event.properties.info.modelID}`)
    UI.empty()
    toggles.set("start", true)
  }
}

async function dispatchEvent(event: Event, state: LoopState): Promise<"break" | "continue" | "skip"> {
  if (event.type === "message.updated") {
    handleMessageUpdated(event, state)
    return "skip"
  }
  if (event.type === "message.part.updated") {
    return handleMessagePartUpdated(event, state.ctx, state.emit, state.toggles)
  }
  if (event.type === "session.error") {
    return handleSessionError(event, state.ctx, state.emit, state.errorRef)
  }
  if (
    event.type === "session.status" &&
    event.properties.sessionID === state.ctx.sessionID &&
    event.properties.status.type === "idle"
  ) {
    return "break"
  }
  if (event.type === "permission.asked") {
    await handlePermissionAsked(event.properties, state.ctx.sessionID, state.ctx.sdk)
  }
  return "skip"
}

async function runEventLoop(ctx: EventLoopCtx): Promise<void> {
  const events = await ctx.sdk.event.subscribe()
  const state: LoopState = {
    ctx,
    emit: makeEmitter(ctx),
    toggles: new Map<string, boolean>(),
    errorRef: { value: undefined },
  }

  for await (const event of events.stream) {
    const result = await dispatchEvent(event, state)
    if (result === "break") break
  }
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run librecode with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running librecode server (e.g., http://localhost:4096)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to LIBRECODE_SERVER_PASSWORD)",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, path on remote server if attaching",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
        default: false,
      })
  },
  handler: async (args) => {
    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    const directory = resolveDirectory(args.dir, args.attach)
    const filePaths = args.file ? (Array.isArray(args.file) ? args.file : [args.file]) : []
    const files = await buildFileAttachments(filePaths)

    if (!process.stdin.isTTY) message += `\n${await Bun.stdin.text()}`

    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    if (args.fork && !args.continue && !args.session) {
      UI.error("--fork requires --continue or --session")
      process.exit(1)
    }

    const rules: PermissionNext.Ruleset = [
      {
        permission: "question",
        action: "deny",
        pattern: "*",
      },
      {
        permission: "plan_enter",
        action: "deny",
        pattern: "*",
      },
      {
        permission: "plan_exit",
        action: "deny",
        pattern: "*",
      },
    ]

    function title() {
      if (args.title === undefined) return
      if (args.title !== "") return args.title
      return message.slice(0, 50) + (message.length > 50 ? "..." : "")
    }

    async function session(sdk: OpencodeClient) {
      const baseID = args.continue ? (await sdk.session.list()).data?.find((s) => !s.parentID)?.id : args.session

      if (baseID && args.fork) {
        const forked = await sdk.session.fork({ sessionID: baseID })
        return forked.data?.id
      }

      if (baseID) return baseID

      const name = title()
      const result = await sdk.session.create({ title: name, permission: rules })
      return result.data?.id
    }

    async function execute(sdk: OpencodeClient): Promise<void> {
      const agent = await resolveAgent(args.agent, args.attach, sdk)
      const sessionID = await session(sdk)
      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const ctx: EventLoopCtx = {
        sdk,
        sessionID,
        format: args.format as string,
        thinking: args.thinking as boolean,
      }
      runEventLoop(ctx).catch((e) => {
        console.error(e)
        process.exit(1)
      })

      if (args.command) {
        await sdk.session.command({
          sessionID,
          agent,
          model: args.model,
          command: args.command,
          arguments: message,
          variant: args.variant,
        })
      } else {
        const model = args.model ? Provider.parseModel(args.model) : undefined
        await sdk.session.prompt({
          sessionID,
          agent,
          model,
          variant: args.variant,
          parts: [...files, { type: "text", text: message }],
        })
      }
    }

    if (args.attach) {
      const headers = buildAuthHeaders(args.password)
      const sdk = createOpencodeClient({ baseUrl: args.attach, directory, headers })
      return await execute(sdk)
    }

    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.Default().fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({ baseUrl: "http://librecode.internal", fetch: fetchFn })
      await execute(sdk)
    })
  },
})
