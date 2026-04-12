import fs from "node:fs"
import path from "node:path"
import { formatPatch, structuredPatch } from "diff"
import fuzzysort from "fuzzysort"
import ignore from "ignore"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { git } from "@/util/git"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { Protected } from "./protected"
import { Ripgrep } from "./ripgrep"

export namespace File {
  const log = Log.create({ service: "file" })

  export const Info = z
    .object({
      path: z.string(),
      added: z.number().int(),
      removed: z.number().int(),
      status: z.enum(["added", "deleted", "modified"]),
    })
    .meta({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  export const Node = z
    .object({
      name: z.string(),
      path: z.string(),
      absolute: z.string(),
      type: z.enum(["file", "directory"]),
      ignored: z.boolean(),
    })
    .meta({
      ref: "FileNode",
    })
  export type Node = z.infer<typeof Node>

  export const Content = z
    .object({
      type: z.enum(["text", "binary"]),
      content: z.string(),
      diff: z.string().optional(),
      patch: z
        .object({
          oldFileName: z.string(),
          newFileName: z.string(),
          oldHeader: z.string().optional(),
          newHeader: z.string().optional(),
          hunks: z.array(
            z.object({
              oldStart: z.number(),
              oldLines: z.number(),
              newStart: z.number(),
              newLines: z.number(),
              lines: z.array(z.string()),
            }),
          ),
          index: z.string().optional(),
        })
        .optional(),
      encoding: z.literal("base64").optional(),
      mimeType: z.string().optional(),
    })
    .meta({
      ref: "FileContent",
    })
  export type Content = z.infer<typeof Content>

  const binaryExtensions = new Set([
    "exe",
    "dll",
    "pdb",
    "bin",
    "so",
    "dylib",
    "o",
    "a",
    "lib",
    "wav",
    "mp3",
    "ogg",
    "oga",
    "ogv",
    "ogx",
    "flac",
    "aac",
    "wma",
    "m4a",
    "weba",
    "mp4",
    "avi",
    "mov",
    "wmv",
    "flv",
    "webm",
    "mkv",
    "zip",
    "tar",
    "gz",
    "gzip",
    "bz",
    "bz2",
    "bzip",
    "bzip2",
    "7z",
    "rar",
    "xz",
    "lz",
    "z",
    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "dmg",
    "iso",
    "img",
    "vmdk",
    "ttf",
    "otf",
    "woff",
    "woff2",
    "eot",
    "sqlite",
    "db",
    "mdb",
    "apk",
    "ipa",
    "aab",
    "xapk",
    "app",
    "pkg",
    "deb",
    "rpm",
    "snap",
    "flatpak",
    "appimage",
    "msi",
    "msp",
    "jar",
    "war",
    "ear",
    "class",
    "kotlin_module",
    "dex",
    "vdex",
    "odex",
    "oat",
    "art",
    "wasm",
    "wat",
    "bc",
    "ll",
    "s",
    "ko",
    "sys",
    "drv",
    "efi",
    "rom",
    "com",
    "cmd",
    "ps1",
    "sh",
    "bash",
    "zsh",
    "fish",
  ])

  const imageExtensions = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "bmp",
    "webp",
    "ico",
    "tif",
    "tiff",
    "svg",
    "svgz",
    "avif",
    "apng",
    "jxl",
    "heic",
    "heif",
    "raw",
    "cr2",
    "nef",
    "arw",
    "dng",
    "orf",
    "raf",
    "pef",
    "x3f",
  ])

  const textExtensions = new Set([
    "ts",
    "tsx",
    "mts",
    "cts",
    "mtsx",
    "ctsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "psm1",
    "cmd",
    "bat",
    "json",
    "jsonc",
    "json5",
    "yaml",
    "yml",
    "toml",
    "md",
    "mdx",
    "txt",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "graphql",
    "gql",
    "sql",
    "ini",
    "cfg",
    "conf",
    "env",
  ])

  const textNames = new Set([
    "dockerfile",
    "makefile",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".npmrc",
    ".nvmrc",
    ".prettierrc",
    ".eslintrc",
  ])

  function isImageByExtension(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase().slice(1)
    return imageExtensions.has(ext)
  }

  function isTextByExtension(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase().slice(1)
    return textExtensions.has(ext)
  }

  function isTextByName(filepath: string): boolean {
    const name = path.basename(filepath).toLowerCase()
    return textNames.has(name)
  }

  function getImageMimeType(filepath: string): string {
    const ext = path.extname(filepath).toLowerCase().slice(1)
    const mimeTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      bmp: "image/bmp",
      webp: "image/webp",
      ico: "image/x-icon",
      tif: "image/tiff",
      tiff: "image/tiff",
      svg: "image/svg+xml",
      svgz: "image/svg+xml",
      avif: "image/avif",
      apng: "image/apng",
      jxl: "image/jxl",
      heic: "image/heic",
      heif: "image/heif",
    }
    return mimeTypes[ext] || `image/${ext}`
  }

  function isBinaryByExtension(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase().slice(1)
    return binaryExtensions.has(ext)
  }

  function isImage(mimeType: string): boolean {
    return mimeType.startsWith("image/")
  }

  async function shouldEncode(mimeType: string): Promise<boolean> {
    const type = mimeType.toLowerCase()
    log.info("shouldEncode", { type })
    if (!type) return false

    if (type.startsWith("text/")) return false
    if (type.includes("charset=")) return false

    const parts = type.split("/", 2)
    const top = parts[0]

    const tops = ["image", "audio", "video", "font", "model", "multipart"]
    if (tops.includes(top)) return true

    return false
  }

  export const Event = {
    Edited: BusEvent.define(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  type FileEntry = { files: string[]; dirs: string[] }

  interface ScanState {
    cache: FileEntry
    fetching: boolean
  }

  const NESTED_IGNORE = new Set(["node_modules", "dist", "build", "target", "vendor"])

  function shouldIgnoreNested(name: string): boolean {
    return name.startsWith(".") || NESTED_IGNORE.has(name)
  }

  async function scanGlobalHomeChildren(
    entryName: string,
    dirs: Set<string>,
    shouldIgnore: (name: string) => boolean,
  ): Promise<void> {
    if (shouldIgnore(entryName)) return
    dirs.add(`${entryName}/`)
    const base = path.join(Instance.directory, entryName)
    const children = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
    for (const child of children) {
      if (!child.isDirectory()) continue
      if (shouldIgnoreNested(child.name)) continue
      dirs.add(`${entryName}/${child.name}/`)
    }
  }

  async function scanGlobalHome(result: FileEntry): Promise<void> {
    const dirs = new Set<string>()
    const protectedNames = Protected.names()
    const shouldIgnore = (name: string) => name.startsWith(".") || protectedNames.has(name)

    const top = await fs.promises.readdir(Instance.directory, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
    for (const entry of top) {
      if (!entry.isDirectory()) continue
      await scanGlobalHomeChildren(entry.name, dirs, shouldIgnore)
    }
    result.dirs = Array.from(dirs).toSorted()
  }

  async function scanRegularProject(result: FileEntry): Promise<void> {
    const seen = new Set<string>()
    for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
      result.files.push(file)
      let current = file
      while (true) {
        const dir = path.dirname(current)
        if (dir === "." || dir === current) break
        current = dir
        if (seen.has(dir)) continue
        seen.add(dir)
        result.dirs.push(`${dir}/`)
      }
    }
  }

  async function runScan(ctx: ScanState, result: FileEntry, isGlobalHome: boolean): Promise<void> {
    if (Instance.directory === path.parse(Instance.directory).root) return
    ctx.fetching = true
    if (isGlobalHome) {
      await scanGlobalHome(result)
    } else {
      await scanRegularProject(result)
    }
    ctx.cache = result
    ctx.fetching = false
  }

  const state = Instance.state(async () => {
    const ctx: ScanState = { cache: { files: [], dirs: [] }, fetching: false }
    const isGlobalHome = Instance.directory === Global.Path.home && Instance.project.id === "global"

    void runScan(ctx, ctx.cache, isGlobalHome)

    return {
      async files() {
        if (!ctx.fetching) {
          void runScan(ctx, { files: [], dirs: [] }, isGlobalHome)
        }
        return ctx.cache
      },
    }
  })

  export function init() {
    state()
  }

  async function collectModifiedFiles(): Promise<Info[]> {
    const diffOutput = (
      await git(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "diff", "--numstat", "HEAD"], {
        cwd: Instance.directory,
      })
    ).text()
    if (!diffOutput.trim()) return []
    return diffOutput
      .trim()
      .split("\n")
      .map((line) => {
        const [added, removed, filepath] = line.split("\t")
        return {
          path: filepath,
          added: added === "-" ? 0 : parseInt(added, 10),
          removed: removed === "-" ? 0 : parseInt(removed, 10),
          status: "modified" as const,
        }
      })
  }

  async function collectAddedFiles(): Promise<Info[]> {
    const untrackedOutput = (
      await git(
        ["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"],
        { cwd: Instance.directory },
      )
    ).text()
    if (!untrackedOutput.trim()) return []
    const results: Info[] = []
    for (const filepath of untrackedOutput.trim().split("\n")) {
      try {
        const content = await Filesystem.readText(path.join(Instance.directory, filepath))
        results.push({ path: filepath, added: content.split("\n").length, removed: 0, status: "added" })
      } catch {}
    }
    return results
  }

  async function collectDeletedFiles(): Promise<Info[]> {
    const deletedOutput = (
      await git(
        ["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=D", "HEAD"],
        { cwd: Instance.directory },
      )
    ).text()
    if (!deletedOutput.trim()) return []
    return deletedOutput
      .trim()
      .split("\n")
      .map((filepath) => ({ path: filepath, added: 0, removed: 0, status: "deleted" as const }))
  }

  export async function status(): Promise<Info[]> {
    if (Instance.project.vcs !== "git") return []

    const [modified, added, deleted] = await Promise.all([
      collectModifiedFiles(),
      collectAddedFiles(),
      collectDeletedFiles(),
    ])
    const changedFiles = [...modified, ...added, ...deleted]

    return changedFiles.map((x) => {
      const full = path.isAbsolute(x.path) ? x.path : path.join(Instance.directory, x.path)
      return { ...x, path: path.relative(Instance.directory, full) }
    })
  }

  async function readImageFile(file: string, full: string): Promise<Content> {
    if (!(await Filesystem.exists(full))) return { type: "text", content: "" }
    const buffer = await Filesystem.readBytes(full).catch(() => Buffer.from([]))
    return { type: "text", content: buffer.toString("base64"), mimeType: getImageMimeType(file), encoding: "base64" }
  }

  async function readTextWithDiff(file: string, _full: string, content: string): Promise<Content> {
    let diff = (await git(["-c", "core.fsmonitor=false", "diff", "--", file], { cwd: Instance.directory })).text()
    if (!diff.trim()) {
      diff = (
        await git(["-c", "core.fsmonitor=false", "diff", "--staged", "--", file], { cwd: Instance.directory })
      ).text()
    }
    if (!diff.trim()) return { type: "text", content }
    const original = (await git(["show", `HEAD:${file}`], { cwd: Instance.directory })).text()
    const patch = structuredPatch(file, file, original, content, "old", "new", {
      context: Infinity,
      ignoreWhitespace: true,
    })
    return { type: "text", content, patch, diff: formatPatch(patch) }
  }

  export async function read(file: string): Promise<Content> {
    using _ = log.time("read", { file })
    const project = Instance.project
    const full = path.join(Instance.directory, file)

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!Instance.containsPath(full)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    if (isImageByExtension(file)) return readImageFile(file, full)

    const isText = isTextByExtension(file) || isTextByName(file)
    if (isBinaryByExtension(file) && !isText) return { type: "binary", content: "" }
    if (!(await Filesystem.exists(full))) return { type: "text", content: "" }

    const mimeType = Filesystem.mimeType(full)
    const encode = isText ? false : await shouldEncode(mimeType)

    if (encode && !isImage(mimeType)) return { type: "binary", content: "", mimeType }
    if (encode) {
      const buffer = await Filesystem.readBytes(full).catch(() => Buffer.from([]))
      return { type: "text", content: buffer.toString("base64"), mimeType, encoding: "base64" }
    }

    const content = (await Filesystem.readText(full).catch(() => "")).trim()
    if (project.vcs === "git") return readTextWithDiff(file, full, content)
    return { type: "text", content }
  }

  async function buildIgnoreFn(): Promise<(p: string) => boolean> {
    const ig = ignore()
    const gitignorePath = path.join(Instance.worktree, ".gitignore")
    if (await Filesystem.exists(gitignorePath)) {
      ig.add(await Filesystem.readText(gitignorePath))
    }
    const ignorePath = path.join(Instance.worktree, ".ignore")
    if (await Filesystem.exists(ignorePath)) {
      ig.add(await Filesystem.readText(ignorePath))
    }
    return ig.ignores.bind(ig)
  }

  function nodeSortComparator(a: Node, b: Node): number {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  }

  export async function list(dir?: string): Promise<Node[]> {
    const exclude = [".git", ".DS_Store"]
    const ignored = Instance.project.vcs === "git" ? await buildIgnoreFn() : (_: string) => false
    const resolved = dir ? path.join(Instance.directory, dir) : Instance.directory

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!Instance.containsPath(resolved)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    const nodes: Node[] = []
    for (const entry of await fs.promises.readdir(resolved, { withFileTypes: true }).catch(() => [])) {
      if (exclude.includes(entry.name)) continue
      const fullPath = path.join(resolved, entry.name)
      const relativePath = path.relative(Instance.directory, fullPath)
      const type = entry.isDirectory() ? "directory" : "file"
      nodes.push({
        name: entry.name,
        path: relativePath,
        absolute: fullPath,
        type,
        ignored: ignored(type === "directory" ? `${relativePath}/` : relativePath),
      })
    }
    return nodes.sort(nodeSortComparator)
  }

  function isHiddenPath(item: string): boolean {
    const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
    return normalized.split("/").some((p) => p.startsWith(".") && p.length > 1)
  }

  function partitionHiddenLast(items: string[], preferHidden: boolean): string[] {
    if (preferHidden) return items
    const visible: string[] = []
    const hidden: string[] = []
    for (const item of items) {
      if (isHiddenPath(item)) hidden.push(item)
      else visible.push(item)
    }
    return [...visible, ...hidden]
  }

  type SearchKind = "file" | "directory" | "all"

  function getSearchItems(result: FileEntry, kind: SearchKind): string[] {
    if (kind === "file") return result.files
    if (kind === "directory") return result.dirs
    return [...result.files, ...result.dirs]
  }

  function searchByQuery(
    items: string[],
    query: string,
    kind: SearchKind,
    limit: number,
    preferHidden: boolean,
  ): string[] {
    const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
    const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((r) => r.target)
    if (kind !== "directory") return sorted
    return partitionHiddenLast(sorted, preferHidden).slice(0, limit)
  }

  export async function search(input: {
    query: string
    limit?: number
    dirs?: boolean
    type?: "file" | "directory"
  }): Promise<string[]> {
    const query = input.query.trim()
    const limit = input.limit ?? 100
    const kind: SearchKind = input.type ?? (input.dirs === false ? "file" : "all")
    log.info("search", { query, kind })

    const result = await state().then((x) => x.files())
    const preferHidden = query.startsWith(".") || query.includes("/.")

    if (!query) {
      if (kind === "file") return result.files.slice(0, limit)
      return partitionHiddenLast(result.dirs.toSorted(), preferHidden).slice(0, limit)
    }

    const output = searchByQuery(getSearchItems(result, kind), query, kind, limit, preferHidden)
    log.info("search", { query, kind, results: output.length })
    return output
  }
}
