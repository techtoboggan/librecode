import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createTwoFilesPatch, diffLines } from "diff"
import z from "zod"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { LSP } from "../lsp"
import { Patch } from "../patch"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./apply_patch.txt"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"
import { Tool } from "./tool"

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

interface FileChange {
  filePath: string
  oldContent: string
  newContent: string
  type: "add" | "update" | "delete" | "move"
  movePath?: string
  diff: string
  additions: number
  deletions: number
}

function countDiffLines(oldContent: string, newContent: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const change of diffLines(oldContent, newContent)) {
    if (change.added) additions += change.count || 0
    if (change.removed) deletions += change.count || 0
  }
  return { additions, deletions }
}

async function processAddHunk(hunk: Patch.Hunk & { type: "add" }, filePath: string): Promise<FileChange> {
  const oldContent = ""
  const newContent = hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
  const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))
  const { additions, deletions } = countDiffLines(oldContent, newContent)
  return { filePath, oldContent, newContent, type: "add", diff, additions, deletions }
}

async function processUpdateHunk(hunk: Patch.Hunk & { type: "update" }, filePath: string): Promise<FileChange> {
  const stats = await fs.stat(filePath).catch(() => null)
  if (!stats || stats.isDirectory()) {
    throw new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`)
  }
  const oldContent = await fs.readFile(filePath, "utf-8")
  let newContent: string
  try {
    newContent = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks).content
  } catch (error) {
    throw new Error(`apply_patch verification failed: ${error}`)
  }
  const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))
  const { additions, deletions } = countDiffLines(oldContent, newContent)
  const movePath = hunk.move_path ? path.resolve(Instance.directory, hunk.move_path) : undefined
  return {
    filePath,
    oldContent,
    newContent,
    type: hunk.move_path ? "move" : "update",
    movePath,
    diff,
    additions,
    deletions,
  }
}

async function processDeleteHunk(filePath: string): Promise<FileChange> {
  const contentToDelete = await fs.readFile(filePath, "utf-8").catch((error) => {
    throw new Error(`apply_patch verification failed: ${error}`)
  })
  const diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentToDelete, ""))
  const deletions = contentToDelete.split("\n").length
  return { filePath, oldContent: contentToDelete, newContent: "", type: "delete", diff, additions: 0, deletions }
}

function parsePatchHunks(patchText: string): Patch.Hunk[] {
  let hunks: Patch.Hunk[]
  try {
    hunks = Patch.parsePatch(patchText).hunks
  } catch (error) {
    throw new Error(`apply_patch verification failed: ${error}`)
  }
  if (hunks.length === 0) {
    const normalized = patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    if (normalized === "*** Begin Patch\n*** End Patch") throw new Error("patch rejected: empty patch")
    throw new Error("apply_patch verification failed: no hunks found")
  }
  return hunks
}

async function applyChangesAndPublish(fileChanges: FileChange[]): Promise<void> {
  for (const change of fileChanges) {
    const edited = change.type === "delete" ? undefined : (change.movePath ?? change.filePath)
    const updates = await applyFileChange(change)
    for (const update of updates) {
      await Bus.publish(FileWatcher.Event.Updated, update)
    }
    if (edited) await Bus.publish(File.Event.Edited, { file: edited })
  }
}

async function touchLspFiles(fileChanges: FileChange[]): Promise<void> {
  for (const change of fileChanges) {
    if (change.type === "delete") continue
    await LSP.touchFile(change.movePath ?? change.filePath, true)
  }
}

async function processHunk(
  hunk: Patch.Hunk,
  filePath: string,
  ctx: import("./tool").Tool.Context,
): Promise<FileChange> {
  if (hunk.type === "add") return processAddHunk(hunk as Patch.Hunk & { type: "add" }, filePath)
  if (hunk.type === "delete") return processDeleteHunk(filePath)
  if (hunk.type === "update") {
    const change = await processUpdateHunk(hunk as Patch.Hunk & { type: "update" }, filePath)
    if (change.movePath) await assertExternalDirectory(ctx, change.movePath)
    return change
  }
  throw new Error(`apply_patch verification failed: unknown hunk type`)
}

async function applyFileChange(
  change: FileChange,
): Promise<Array<{ file: string; event: "add" | "change" | "unlink" }>> {
  const updates: Array<{ file: string; event: "add" | "change" | "unlink" }> = []
  switch (change.type) {
    case "add":
      await fs.mkdir(path.dirname(change.filePath), { recursive: true })
      await fs.writeFile(change.filePath, change.newContent, "utf-8")
      updates.push({ file: change.filePath, event: "add" })
      break
    case "update":
      await fs.writeFile(change.filePath, change.newContent, "utf-8")
      updates.push({ file: change.filePath, event: "change" })
      break
    case "move":
      if (change.movePath) {
        await fs.mkdir(path.dirname(change.movePath), { recursive: true })
        await fs.writeFile(change.movePath, change.newContent, "utf-8")
        await fs.unlink(change.filePath)
        updates.push({ file: change.filePath, event: "unlink" })
        updates.push({ file: change.movePath, event: "add" })
      }
      break
    case "delete":
      await fs.unlink(change.filePath)
      updates.push({ file: change.filePath, event: "unlink" })
      break
  }
  return updates
}

function buildPatchSummary(fileChanges: FileChange[]): string {
  return fileChanges
    .map((change) => {
      if (change.type === "add") {
        return `A ${path.relative(Instance.worktree, change.filePath).replaceAll("\\", "/")}`
      }
      if (change.type === "delete") {
        return `D ${path.relative(Instance.worktree, change.filePath).replaceAll("\\", "/")}`
      }
      const target = change.movePath ?? change.filePath
      return `M ${path.relative(Instance.worktree, target).replaceAll("\\", "/")}`
    })
    .join("\n")
}

function appendLspDiagnostics(
  output: string,
  fileChanges: FileChange[],
  diagnostics: Awaited<ReturnType<typeof LSP.diagnostics>>,
): string {
  const MAX_DIAGNOSTICS_PER_FILE = 20
  let result = output
  for (const change of fileChanges) {
    if (change.type === "delete") continue
    const target = change.movePath ?? change.filePath
    const normalized = Filesystem.normalizePath(target)
    const issues = diagnostics[normalized] ?? []
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length === 0) continue
    const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    const suffix =
      errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
    result += `\n\nLSP errors detected in ${path.relative(Instance.worktree, target).replaceAll("\\", "/")}, please fix:\n<diagnostics file="${target}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
  }
  return result
}

export const ApplyPatchTool = Tool.define("apply_patch", {
  description: DESCRIPTION,
  parameters: PatchParams,
  async execute(params, ctx) {
    if (!params.patchText) throw new Error("patchText is required")

    const hunks = parsePatchHunks(params.patchText)
    const fileChanges: FileChange[] = []
    let totalDiff = ""

    for (const hunk of hunks) {
      const filePath = path.resolve(Instance.directory, hunk.path)
      await assertExternalDirectory(ctx, filePath)
      const change = await processHunk(hunk, filePath, ctx)
      fileChanges.push(change)
      totalDiff += `${change.diff}\n`
    }

    const files = fileChanges.map((change) => ({
      filePath: change.filePath,
      relativePath: path.relative(Instance.worktree, change.movePath ?? change.filePath).replaceAll("\\", "/"),
      type: change.type,
      diff: change.diff,
      before: change.oldContent,
      after: change.newContent,
      additions: change.additions,
      deletions: change.deletions,
      movePath: change.movePath,
    }))

    const relativePaths = fileChanges.map((c) => path.relative(Instance.worktree, c.filePath).replaceAll("\\", "/"))
    await ctx.ask({
      permission: "edit",
      patterns: relativePaths,
      always: ["*"],
      metadata: { filepath: relativePaths.join(", "), diff: totalDiff, files },
    })

    await applyChangesAndPublish(fileChanges)
    await touchLspFiles(fileChanges)
    const diagnostics = await LSP.diagnostics()

    let output = `Success. Updated the following files:\n${buildPatchSummary(fileChanges)}`
    output = appendLspDiagnostics(output, fileChanges, diagnostics)

    return { title: output, metadata: { diff: totalDiff, files, diagnostics }, output }
  },
})
