import fs from "node:fs/promises"
import path from "node:path"
import type { AgentInfo } from "../agent/agent"
import { Global } from "../global"
import { Identifier } from "../id/id"
import { PermissionNext } from "../permission/next"
import { Scheduler } from "../scheduler"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { ToolID } from "./schema"

function accumulateHead(
  lines: string[],
  maxLines: number,
  maxBytes: number,
): { out: string[]; bytes: number; hitBytes: boolean } {
  const out: string[] = []
  let bytes = 0
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
    if (bytes + size > maxBytes) return { out, bytes, hitBytes: true }
    out.push(lines[i])
    bytes += size
  }
  return { out, bytes, hitBytes: false }
}

function accumulateTail(
  lines: string[],
  maxLines: number,
  maxBytes: number,
): { out: string[]; bytes: number; hitBytes: boolean } {
  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) return { out, bytes, hitBytes: true }
    out.unshift(lines[i])
    bytes += size
  }
  return { out, bytes, hitBytes: false }
}

function accumulateLines(
  lines: string[],
  maxLines: number,
  maxBytes: number,
  direction: "head" | "tail",
): { out: string[]; bytes: number; hitBytes: boolean } {
  return direction === "head" ? accumulateHead(lines, maxLines, maxBytes) : accumulateTail(lines, maxLines, maxBytes)
}

const TRUNCATE_MAX_LINES = 2000
const TRUNCATE_MAX_BYTES = 50 * 1024
const TRUNCATE_DIR = path.join(Global.Path.data, "tool-output")
const TRUNCATE_GLOB = path.join(TRUNCATE_DIR, "*")
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const HOUR_MS = 60 * 60 * 1000

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Truncate {
  type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
  }
}

function truncateInit() {
  Scheduler.register({
    id: "tool.truncation.cleanup",
    interval: HOUR_MS,
    run: truncateCleanup,
    scope: "global",
  })
}

async function truncateCleanup() {
  const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - RETENTION_MS))
  const entries = await Glob.scan("tool_*", { cwd: TRUNCATE_DIR, include: "file" }).catch(() => [] as string[])
  for (const entry of entries) {
    if (Identifier.timestamp(entry) >= cutoff) continue
    await fs.unlink(path.join(TRUNCATE_DIR, entry)).catch(() => {})
  }
}

function hasTaskTool(agent?: AgentInfo): boolean {
  if (!agent?.permission) return false
  const rule = PermissionNext.evaluate("task", "*", agent.permission)
  return rule.action !== "deny"
}

async function truncateOutput(
  text: string,
  options: Truncate.Options = {},
  agent?: AgentInfo,
): Promise<Truncate.Result> {
  const maxLines = options.maxLines ?? TRUNCATE_MAX_LINES
  const maxBytes = options.maxBytes ?? TRUNCATE_MAX_BYTES
  const direction = options.direction ?? "head"
  const lines = text.split("\n")
  const totalBytes = Buffer.byteLength(text, "utf-8")

  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false }
  }

  const { out, bytes, hitBytes } = accumulateLines(lines, maxLines, maxBytes, direction)

  const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
  const unit = hitBytes ? "bytes" : "lines"
  const preview = out.join("\n")

  const id = ToolID.ascending()
  const filepath = path.join(TRUNCATE_DIR, id)
  await Filesystem.write(filepath, text)

  const hint = hasTaskTool(agent)
    ? `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
    : `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`
  const message =
    direction === "head"
      ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
      : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`

  return { content: message, truncated: true, outputPath: filepath }
}

export const Truncate = {
  MAX_LINES: TRUNCATE_MAX_LINES,
  MAX_BYTES: TRUNCATE_MAX_BYTES,
  DIR: TRUNCATE_DIR,
  GLOB: TRUNCATE_GLOB,
  init: truncateInit,
  cleanup: truncateCleanup,
  output: truncateOutput,
} as const
