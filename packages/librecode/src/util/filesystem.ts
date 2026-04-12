import { createWriteStream, existsSync, realpathSync, statSync } from "node:fs"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve as pathResolve, relative } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { lookup } from "mime-types"
import { Glob } from "./glob"

// Fast sync version for metadata checks
async function filesystemExists(p: string): Promise<boolean> {
  return existsSync(p)
}

async function filesystemIsDir(p: string): Promise<boolean> {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function filesystemStat(p: string): ReturnType<typeof statSync> | undefined {
  return statSync(p, { throwIfNoEntry: false }) ?? undefined
}

async function filesystemSize(p: string): Promise<number> {
  const s = filesystemStat(p)?.size ?? 0
  return typeof s === "bigint" ? Number(s) : s
}

async function filesystemReadText(p: string): Promise<string> {
  return readFile(p, "utf-8")
}

async function filesystemReadJson<T = unknown>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf-8"))
}

async function filesystemReadBytes(p: string): Promise<Buffer> {
  return readFile(p)
}

async function filesystemReadArrayBuffer(p: string): Promise<ArrayBuffer> {
  const buf = await readFile(p)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function isEnoent(e: unknown): e is { code: "ENOENT" } {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT"
}

async function filesystemWrite(p: string, content: string | Buffer | Uint8Array, mode?: number): Promise<void> {
  try {
    if (mode) {
      await writeFile(p, content, { mode })
    } else {
      await writeFile(p, content)
    }
  } catch (e) {
    if (isEnoent(e)) {
      await mkdir(dirname(p), { recursive: true })
      if (mode) {
        await writeFile(p, content, { mode })
      } else {
        await writeFile(p, content)
      }
      return
    }
    throw e
  }
}

async function filesystemWriteJson(p: string, data: unknown, mode?: number): Promise<void> {
  return filesystemWrite(p, JSON.stringify(data, null, 2), mode)
}

async function filesystemWriteStream(
  p: string,
  stream: ReadableStream<Uint8Array> | Readable,
  mode?: number,
): Promise<void> {
  const dir = dirname(p)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  const nodeStream = stream instanceof ReadableStream ? Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0]) : stream
  const ws = createWriteStream(p)
  await pipeline(nodeStream, ws)

  if (mode) {
    await chmod(p, mode)
  }
}

function filesystemMimeType(p: string): string {
  return lookup(p) || "application/octet-stream"
}

/**
 * On Windows, normalize a path to its canonical casing using the filesystem.
 * This is needed because Windows paths are case-insensitive but LSP servers
 * may return paths with different casing than what we send them.
 */
function filesystemNormalizePath(p: string): string {
  if (process.platform !== "win32") return p
  try {
    return realpathSync.native(p)
  } catch {
    return p
  }
}

// We cannot rely on path.resolve() here because git.exe may come from Git Bash, Cygwin, or MSYS2, so we need to translate these paths at the boundary.
// Also resolves symlinks so that callers using the result as a cache key
// always get the same canonical path for a given physical directory.
function filesystemResolve(p: string): string {
  const resolved = pathResolve(filesystemWindowsPath(p))
  try {
    return filesystemNormalizePath(realpathSync(resolved))
  } catch (e) {
    if (isEnoent(e)) return filesystemNormalizePath(resolved)
    throw e
  }
}

function filesystemWindowsPath(p: string): string {
  if (process.platform !== "win32") return p
  return (
    p
      .replace(/^\/([a-zA-Z]):(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      // Git Bash for Windows paths are typically /<drive>/...
      .replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      // Cygwin git paths are typically /cygdrive/<drive>/...
      .replace(/^\/cygdrive\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      // WSL paths are typically /mnt/<drive>/...
      .replace(/^\/mnt\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
  )
}

function filesystemOverlaps(a: string, b: string): boolean {
  const relA = relative(a, b)
  const relB = relative(b, a)
  return !relA?.startsWith("..") || !relB?.startsWith("..")
}

function filesystemContains(parent: string, child: string): boolean {
  return !relative(parent, child).startsWith("..")
}

async function filesystemFindUp(target: string, start: string, stop?: string): Promise<string[]> {
  let current = start
  const result = []
  while (true) {
    const search = join(current, target)
    if (await filesystemExists(search)) result.push(search)
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return result
}

async function* filesystemUp(options: { targets: string[]; start: string; stop?: string }): AsyncGenerator<string, void> {
  const { targets, start, stop } = options
  let current = start
  while (true) {
    for (const target of targets) {
      const search = join(current, target)
      if (await filesystemExists(search)) yield search
    }
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

async function filesystemGlobUp(pattern: string, start: string, stop?: string): Promise<string[]> {
  let current = start
  const result = []
  while (true) {
    try {
      const matches = await Glob.scan(pattern, {
        cwd: current,
        absolute: true,
        include: "file",
        dot: true,
      })
      result.push(...matches)
    } catch {
      // Skip invalid glob patterns
    }
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return result
}

export const Filesystem = {
  exists: filesystemExists,
  isDir: filesystemIsDir,
  stat: filesystemStat,
  size: filesystemSize,
  readText: filesystemReadText,
  readJson: filesystemReadJson,
  readBytes: filesystemReadBytes,
  readArrayBuffer: filesystemReadArrayBuffer,
  write: filesystemWrite,
  writeJson: filesystemWriteJson,
  writeStream: filesystemWriteStream,
  mimeType: filesystemMimeType,
  normalizePath: filesystemNormalizePath,
  resolve: filesystemResolve,
  windowsPath: filesystemWindowsPath,
  overlaps: filesystemOverlaps,
  contains: filesystemContains,
  findUp: filesystemFindUp,
  up: filesystemUp,
  globUp: filesystemGlobUp,
} as const
