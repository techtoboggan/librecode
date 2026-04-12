// Ripgrep utility functions
import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@librecode/util/error"
import { lazy } from "../util/lazy"

import { Filesystem } from "../util/filesystem"
import { Process } from "../util/process"
import { which } from "../util/which"
import { text } from "node:stream/consumers"

import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"
import { Log } from "@/util/log"

// ---------------------------------------------------------------------------
// Module-level helpers (extracted to keep lazy() below complexity 12)
// ---------------------------------------------------------------------------

const _rgLog = Log.create({ service: "ripgrep" })

const RG_PLATFORM = {
  "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
  "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
  "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
  "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
  "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
  "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
} as const

type PlatformKey = keyof typeof RG_PLATFORM

const RipgrepExtractionFailedError = NamedError.create(
  "RipgrepExtractionFailedError",
  z.object({ filepath: z.string(), stderr: z.string() }),
)

const RipgrepUnsupportedPlatformError = NamedError.create(
  "RipgrepUnsupportedPlatformError",
  z.object({ platform: z.string() }),
)

const RipgrepDownloadFailedError = NamedError.create(
  "RipgrepDownloadFailedError",
  z.object({ url: z.string(), status: z.number() }),
)

async function extractTarGz(archivePath: string, filepath: string, platformKey: PlatformKey): Promise<void> {
  const args = ["tar", "-xzf", archivePath, "--strip-components=1"]
  if (platformKey.endsWith("-darwin")) args.push("--include=*/rg")
  if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/rg")

  const proc = Process.spawn(args, { cwd: Global.Path.bin, stderr: "pipe", stdout: "pipe" })
  const exit = await proc.exited
  if (exit !== 0) {
    const stderr = proc.stderr ? await text(proc.stderr) : ""
    throw new RipgrepExtractionFailedError({ filepath, stderr })
  }
}

async function extractZip(archivePath: string, filepath: string, arrayBuffer: ArrayBuffer): Promise<void> {
  const zipFileReader = new ZipReader(new BlobReader(new Blob([arrayBuffer])))
  const entries = await zipFileReader.getEntries()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rgEntry: any
  for (const entry of entries) {
    if (entry.filename.endsWith("rg.exe")) {
      rgEntry = entry
      break
    }
  }

  if (!rgEntry) {
    throw new RipgrepExtractionFailedError({ filepath: archivePath, stderr: "rg.exe not found in zip archive" })
  }

  const rgBlob = await rgEntry.getData(new BlobWriter())
  if (!rgBlob) {
    throw new RipgrepExtractionFailedError({
      filepath: archivePath,
      stderr: "Failed to extract rg.exe from zip archive",
    })
  }

  await Filesystem.write(filepath, Buffer.from(await rgBlob.arrayBuffer()))
  await zipFileReader.close()
}

async function downloadRipgrep(filepath: string): Promise<void> {
  const platformKey = `${process.arch}-${process.platform}` as PlatformKey
  const config = RG_PLATFORM[platformKey]
  if (!config) throw new RipgrepUnsupportedPlatformError({ platform: platformKey })

  const version = "14.1.1"
  const filename = `ripgrep-${version}-${config.platform}.${config.extension}`
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`

  const response = await fetch(url)
  if (!response.ok) throw new RipgrepDownloadFailedError({ url, status: response.status })

  const arrayBuffer = await response.arrayBuffer()
  const archivePath = path.join(Global.Path.bin, filename)
  await Filesystem.write(archivePath, Buffer.from(arrayBuffer))

  if (config.extension === "tar.gz") await extractTarGz(archivePath, filepath, platformKey)
  if (config.extension === "zip") await extractZip(archivePath, filepath, arrayBuffer)

  await fs.unlink(archivePath)
  if (!platformKey.endsWith("-win32")) await fs.chmod(filepath, 0o755)
}

async function resolveRipgrepPath(): Promise<{ filepath: string }> {
  const system = which("rg")
  if (system) {
    const stat = await fs.stat(system).catch(() => undefined)
    if (stat?.isFile()) return { filepath: system }
    _rgLog.warn("bun.which returned invalid rg path", { filepath: system })
  }

  const filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))
  if (!(await Filesystem.exists(filepath))) {
    await downloadRipgrep(filepath)
  }
  return { filepath }
}

interface TreeNode {
  name: string
  children: Map<string, TreeNode>
}

function treeDir(node: TreeNode, name: string): TreeNode {
  const existing = node.children.get(name)
  if (existing) return existing
  const next: TreeNode = { name, children: new Map() }
  node.children.set(name, next)
  return next
}

function treeCount(node: TreeNode): number {
  let total = 0
  for (const child of node.children.values()) {
    total += 1 + treeCount(child)
  }
  return total
}

async function assertDirectoryExists(dir: string): Promise<boolean> {
  return (await fs.stat(dir).catch(() => undefined))?.isDirectory() === true
}

function buildFilesArgs(
  rgPath: string,
  input: {
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
  },
): string[] {
  const args = [rgPath, "--files", "--glob=!.git/*"]
  if (input.follow) args.push("--follow")
  if (input.hidden !== false) args.push("--hidden")
  if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
  if (input.glob) {
    for (const g of input.glob) args.push(`--glob=${g}`)
  }
  return args
}

async function* streamProcLines(
  proc: { stdout: unknown; exited: Promise<number> },
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (!proc.stdout) throw new Error("Process output not available")
  let buffer = ""
  const stream = proc.stdout as AsyncIterable<Buffer | string>
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    buffer += typeof chunk === "string" ? chunk : chunk.toString()
    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ""
    for (const line of lines) {
      if (line) yield line
    }
  }
  if (buffer) yield buffer
  await proc.exited
}

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map() }
  for (const file of files) {
    if (file.includes(".librecode")) continue
    const parts = file.split(path.sep)
    if (parts.length < 2) continue
    let node = root
    for (const part of parts.slice(0, -1)) {
      node = treeDir(node, part)
    }
  }
  return root
}

function renderTree(root: TreeNode, limit: number): string[] {
  const total = treeCount(root)
  const effectiveLimit = limit > 0 ? Math.min(limit, total) : total
  const lines: string[] = []
  const queue: { node: TreeNode; path: string }[] = []

  for (const child of Array.from(root.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
    queue.push({ node: child, path: child.name })
  }

  let used = 0
  for (let i = 0; i < queue.length && used < effectiveLimit; i++) {
    const { node, path: nodePath } = queue[i]
    lines.push(nodePath)
    used++
    for (const child of Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      queue.push({ node: child, path: `${nodePath}/${child.name}` })
    }
  }

  if (total > used) lines.push(`[${total - used} truncated]`)
  return lines
}

export namespace Ripgrep {
  const log = _rgLog

  const Stats = z.object({
    elapsed: z.object({ secs: z.number(), nanos: z.number(), human: z.string() }),
    searches: z.number(),
    searches_with_match: z.number(),
    bytes_searched: z.number(),
    bytes_printed: z.number(),
    matched_lines: z.number(),
    matches: z.number(),
  })

  const Begin = z.object({
    type: z.literal("begin"),
    data: z.object({ path: z.object({ text: z.string() }) }),
  })

  export const Match = z.object({
    type: z.literal("match"),
    data: z.object({
      path: z.object({ text: z.string() }),
      lines: z.object({ text: z.string() }),
      line_number: z.number(),
      absolute_offset: z.number(),
      submatches: z.array(z.object({ match: z.object({ text: z.string() }), start: z.number(), end: z.number() })),
    }),
  })

  const End = z.object({
    type: z.literal("end"),
    data: z.object({
      path: z.object({ text: z.string() }),
      binary_offset: z.number().nullable(),
      stats: Stats,
    }),
  })

  const Summary = z.object({
    type: z.literal("summary"),
    data: z.object({
      elapsed_total: z.object({ human: z.string(), nanos: z.number(), secs: z.number() }),
      stats: Stats,
    }),
  })

  const Result = z.union([Begin, Match, End, Summary])

  export type Result = z.infer<typeof Result>
  export type Match = z.infer<typeof Match>
  export type Begin = z.infer<typeof Begin>
  export type End = z.infer<typeof End>
  export type Summary = z.infer<typeof Summary>

  // Re-export errors with the names callers expect
  export const ExtractionFailedError = RipgrepExtractionFailedError
  export const UnsupportedPlatformError = RipgrepUnsupportedPlatformError
  export const DownloadFailedError = RipgrepDownloadFailedError

  const state = lazy(() => resolveRipgrepPath())

  export async function filepath(): Promise<string> {
    const { filepath: fp } = await state()
    return fp
  }

  export async function* files(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    signal?: AbortSignal
  }): AsyncGenerator<string> {
    input.signal?.throwIfAborted()
    const rgPath = await filepath()
    const args = buildFilesArgs(rgPath, input)
    if (!(await assertDirectoryExists(input.cwd))) return
    const proc = Process.spawn(args, { cwd: input.cwd, stdout: "pipe", stderr: "ignore", abort: input.signal })
    yield* streamProcLines(proc, input.signal)
    input.signal?.throwIfAborted()
  }

  export async function tree(input: { cwd: string; limit?: number; signal?: AbortSignal }): Promise<string> {
    log.info("tree", input)
    const allFiles = await Array.fromAsync(Ripgrep.files({ cwd: input.cwd, signal: input.signal }))
    const root = buildTree(allFiles)
    const lines = renderTree(root, input.limit ?? 0)
    return lines.join("\n")
  }

  export async function search(input: {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
  }): Promise<MessageV2Data[]> {
    const rgPath = await filepath()
    const args = [rgPath, "--json", "--hidden", "--glob=!.git/*"]
    if (input.follow) args.push("--follow")
    if (input.glob) {
      for (const g of input.glob) args.push(`--glob=${g}`)
    }
    if (input.limit) args.push(`--max-count=${input.limit}`)
    args.push("--")
    args.push(input.pattern)

    const result = await Process.text(args, { cwd: input.cwd, nothrow: true })
    if (result.code !== 0) return []

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = result.text.trim().split(/\r?\n/).filter(Boolean)
    return lines
      .map((line) => JSON.parse(line))
      .map((parsed) => Result.parse(parsed))
      .filter((r) => r.type === "match")
      .map((r) => r.data)
  }
}

// Internal type alias used by search() return type
type MessageV2Data = Ripgrep.Match["data"]
