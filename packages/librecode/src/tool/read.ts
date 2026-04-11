import z from "zod"
import { createReadStream } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { createInterface } from "readline"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { InstructionPrompt } from "../session/instruction"
import { Filesystem } from "../util/filesystem"
import type { MessageV2 } from "../session/message-v2"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`

interface ReadResult {
  title: string
  output: string
  metadata: { preview: string; truncated: boolean; loaded: string[] }
  attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
}

function resolveFilepath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(Instance.directory, filePath)
}

async function throwNotFoundWithSuggestions(filepath: string): Promise<never> {
  const dir = path.dirname(filepath)
  const base = path.basename(filepath)
  const suggestions = await fs
    .readdir(dir)
    .then((entries) =>
      entries
        .filter(
          (entry) => entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
        )
        .map((entry) => path.join(dir, entry))
        .slice(0, 3),
    )
    .catch(() => [])

  if (suggestions.length > 0) {
    throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
  }
  throw new Error(`File not found: ${filepath}`)
}

async function readDirectory(filepath: string, title: string, limit: number, offset: number): Promise<ReadResult> {
  const dirents = await fs.readdir(filepath, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      if (dirent.isDirectory()) return dirent.name + "/"
      if (dirent.isSymbolicLink()) {
        const target = await fs.stat(path.join(filepath, dirent.name)).catch(() => undefined)
        if (target?.isDirectory()) return dirent.name + "/"
      }
      return dirent.name
    }),
  )
  entries.sort((a, b) => a.localeCompare(b))

  const start = offset - 1
  const sliced = entries.slice(start, start + limit)
  const truncated = start + sliced.length < entries.length

  const output = [
    `<path>${filepath}</path>`,
    `<type>directory</type>`,
    `<entries>`,
    sliced.join("\n"),
    truncated
      ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
      : `\n(${entries.length} entries)`,
    `</entries>`,
  ].join("\n")

  return {
    title,
    output,
    metadata: {
      preview: sliced.slice(0, 20).join("\n"),
      truncated,
      loaded: [] as string[],
    },
  }
}

async function readMediaFile(filepath: string, title: string, mime: string, loaded: string[]): Promise<ReadResult> {
  const isImage = mime.startsWith("image/")
  const msg = `${isImage ? "Image" : "PDF"} read successfully`
  return {
    title,
    output: msg,
    metadata: { preview: msg, truncated: false, loaded },
    attachments: [
      {
        type: "file" as const,
        mime,
        url: `data:${mime};base64,${Buffer.from(await Filesystem.readBytes(filepath)).toString("base64")}`,
      },
    ],
  }
}

interface TextReadResult {
  raw: string[]
  lines: number
  hasMoreLines: boolean
  truncatedByBytes: boolean
}

async function readTextLines(filepath: string, limit: number, offset: number): Promise<TextReadResult> {
  const stream = createReadStream(filepath, { encoding: "utf8" })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const start = offset - 1
  const raw: string[] = []
  let bytes = 0
  let lines = 0
  let truncatedByBytes = false
  let hasMoreLines = false
  try {
    for await (const text of rl) {
      lines += 1
      if (lines <= start) continue
      if (raw.length >= limit) {
        hasMoreLines = true
        continue
      }
      const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
      if (bytes + size > MAX_BYTES) {
        truncatedByBytes = true
        hasMoreLines = true
        break
      }
      raw.push(line)
      bytes += size
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return { raw, lines, hasMoreLines, truncatedByBytes }
}

function isMediaMime(mime: string): boolean {
  const isImage = mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
  return isImage || mime === "application/pdf"
}

async function readFileContent(
  filepath: string,
  title: string,
  limit: number,
  offset: number,
  fileSize: number,
  instructions: { filepath: string; content: string }[],
): Promise<ReadResult> {
  const loaded = instructions.map((i) => i.filepath)
  const mime = Filesystem.mimeType(filepath)

  if (isMediaMime(mime)) {
    return readMediaFile(filepath, title, mime, loaded)
  }

  const isBinary = await isBinaryFile(filepath, fileSize)
  if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

  const { raw, lines, hasMoreLines, truncatedByBytes } = await readTextLines(filepath, limit, offset)

  if (lines < offset && !(lines === 0 && offset === 1)) {
    throw new Error(`Offset ${offset} is out of range for this file (${lines} lines)`)
  }

  const preview = raw.slice(0, 20).join("\n")
  const truncated = hasMoreLines || truncatedByBytes
  let output = buildTextOutput(filepath, raw, offset, lines, hasMoreLines, truncatedByBytes)

  LSP.touchFile(filepath, false)

  if (instructions.length > 0) {
    output += `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
  }

  return { title, output, metadata: { preview, truncated, loaded } }
}

function buildTextOutput(filepath: string, raw: string[], offset: number, lines: number, hasMoreLines: boolean, truncatedByBytes: boolean): string {
  const content = raw.map((line, index) => `${index + offset}: ${line}`)
  let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>"].join("\n")
  output += content.join("\n")

  const lastReadLine = offset + raw.length - 1
  const nextOffset = lastReadLine + 1
  if (truncatedByBytes) {
    output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${lastReadLine}. Use offset=${nextOffset} to continue.)`
  } else if (hasMoreLines) {
    output += `\n\n(Showing lines ${offset}-${lastReadLine} of ${lines}. Use offset=${nextOffset} to continue.)`
  } else {
    output += `\n\n(End of file - total ${lines} lines)`
  }
  output += "\n</content>"
  return output
}

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file or directory to read"),
    offset: z.coerce.number().describe("The line number to start reading from (1-indexed)").optional(),
    limit: z.coerce.number().describe("The maximum number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    if (params.offset !== undefined && params.offset < 1) {
      throw new Error("offset must be greater than or equal to 1")
    }
    const filepath = resolveFilepath(params.filePath)
    const title = path.relative(Instance.worktree, filepath)
    const stat = Filesystem.stat(filepath)

    await assertExternalDirectory(ctx, filepath, {
      bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
      kind: stat?.isDirectory() ? "directory" : "file",
    })
    await ctx.ask({ permission: "read", patterns: [filepath], always: ["*"], metadata: {} })

    if (!stat) {
      await throwNotFoundWithSuggestions(filepath)
    }

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset ?? 1

    if (stat!.isDirectory()) {
      return readDirectory(filepath, title, limit, offset)
    }

    const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)
    const result = await readFileContent(filepath, title, limit, offset, Number(stat!.size), instructions)
    FileTime.read(ctx.sessionID, filepath)
    return result
  },
})

async function isBinaryFile(filepath: string, fileSize: number): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
  // binary check for common non-text extensions
  switch (ext) {
    case ".zip":
    case ".tar":
    case ".gz":
    case ".exe":
    case ".dll":
    case ".so":
    case ".class":
    case ".jar":
    case ".war":
    case ".7z":
    case ".doc":
    case ".docx":
    case ".xls":
    case ".xlsx":
    case ".ppt":
    case ".pptx":
    case ".odt":
    case ".ods":
    case ".odp":
    case ".bin":
    case ".dat":
    case ".obj":
    case ".o":
    case ".a":
    case ".lib":
    case ".wasm":
    case ".pyc":
    case ".pyo":
      return true
    default:
      break
  }

  if (fileSize === 0) return false

  const fh = await fs.open(filepath, "r")
  try {
    const sampleSize = Math.min(4096, fileSize)
    const bytes = Buffer.alloc(sampleSize)
    const result = await fh.read(bytes, 0, sampleSize, 0)
    if (result.bytesRead === 0) return false

    let nonPrintableCount = 0
    for (let i = 0; i < result.bytesRead; i++) {
      if (bytes[i] === 0) return true
      if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
        nonPrintableCount++
      }
    }
    // If >30% non-printable characters, consider it binary
    return nonPrintableCount / result.bytesRead > 0.3
  } finally {
    await fh.close()
  }
}
