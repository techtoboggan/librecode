// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import * as path from "node:path"
import { createTwoFilesPatch, diffLines } from "diff"
import z from "zod"
import type { Snapshot } from "@/snapshot"
import { Bus } from "../bus"
import { File } from "../file"
import { FileTime } from "../file/time"
import { FileWatcher } from "../file/watcher"
import { LSP } from "../lsp"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./edit.txt"
import { assertExternalDirectory } from "./external-directory"
import { Tool } from "./tool"

const MAX_DIAGNOSTICS_PER_FILE = 20

function computeFileDiff(filePath: string, contentOld: string, contentNew: string): Snapshot.FileDiff {
  const filediff: Snapshot.FileDiff = {
    file: filePath,
    before: contentOld,
    after: contentNew,
    additions: 0,
    deletions: 0,
  }
  for (const change of diffLines(contentOld, contentNew)) {
    if (change.added) filediff.additions += change.count || 0
    if (change.removed) filediff.deletions += change.count || 0
  }
  return filediff
}

async function buildDiagnosticsOutput(filePath: string): Promise<string> {
  let output = "Edit applied successfully."
  await LSP.touchFile(filePath, true)
  const diagnostics = await LSP.diagnostics()
  const normalizedFilePath = Filesystem.normalizePath(filePath)
  const errors = (diagnostics[normalizedFilePath] ?? []).filter((item) => item.severity === 1)
  if (errors.length > 0) {
    const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    const suffix =
      errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
    output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
  }
  return output
}

async function applyCreateOrOverwrite(
  filePath: string,
  newString: string,
  ctx: Tool.Context,
): Promise<{ diff: string; contentNew: string }> {
  const existed = await Filesystem.exists(filePath)
  const contentNew = newString
  const diff = trimDiff(createTwoFilesPatch(filePath, filePath, "", contentNew))
  await ctx.ask({
    permission: "edit",
    patterns: [path.relative(Instance.worktree, filePath)],
    always: ["*"],
    metadata: { filepath: filePath, diff },
  })
  await Filesystem.write(filePath, newString)
  await Bus.publish(File.Event.Edited, { file: filePath })
  await Bus.publish(FileWatcher.Event.Updated, { file: filePath, event: existed ? "change" : "add" })
  FileTime.read(ctx.sessionID, filePath)
  return { diff, contentNew }
}

async function applyEdit(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean | undefined,
  ctx: Tool.Context,
): Promise<{ diff: string; contentOld: string; contentNew: string }> {
  const stats = Filesystem.stat(filePath)
  if (!stats) throw new Error(`File ${filePath} not found`)
  if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
  await FileTime.assert(ctx.sessionID, filePath)
  const contentOld = await Filesystem.readText(filePath)

  const ending = detectLineEnding(contentOld)
  const old = convertToLineEnding(normalizeLineEndings(oldString), ending)
  const next = convertToLineEnding(normalizeLineEndings(newString), ending)
  let contentNew = replace(contentOld, old, next, replaceAll)

  let diff = trimDiff(
    createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
  )
  await ctx.ask({
    permission: "edit",
    patterns: [path.relative(Instance.worktree, filePath)],
    always: ["*"],
    metadata: { filepath: filePath, diff },
  })

  await Filesystem.write(filePath, contentNew)
  await Bus.publish(File.Event.Edited, { file: filePath })
  await Bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })
  contentNew = await Filesystem.readText(filePath)
  diff = trimDiff(
    createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
  )
  FileTime.read(ctx.sessionID, filePath)
  return { diff, contentOld, contentNew }
}

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace"),
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  }),
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    if (params.oldString === params.newString) {
      throw new Error("No changes to apply: oldString and newString are identical.")
    }

    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filePath)

    let diff = ""
    let contentOld = ""
    let contentNew = ""
    await FileTime.withLock(filePath, async () => {
      if (params.oldString === "") {
        ;({ diff, contentNew } = await applyCreateOrOverwrite(filePath, params.newString, ctx))
        return
      }
      ;({ diff, contentOld, contentNew } = await applyEdit(
        filePath,
        params.oldString,
        params.newString,
        params.replaceAll,
        ctx,
      ))
    })

    const filediff = computeFileDiff(filePath, contentOld, contentNew)

    ctx.metadata({
      metadata: {
        diff,
        filediff,
        diagnostics: {},
      },
    })

    const output = await buildDiagnosticsOutput(filePath)

    return {
      metadata: {
        diagnostics: await LSP.diagnostics(),
        diff,
        filediff,
      },
      title: `${path.relative(Instance.worktree, filePath)}`,
      output,
    }
  },
})

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

/**
 * Levenshtein distance algorithm implementation
 */
function levenshtein(a: string, b: string): number {
  // Handle empty strings
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

function lineStartIndex(lines: string[], upToLine: number): number {
  let idx = 0
  for (let k = 0; k < upToLine; k++) idx += lines[k].length + 1
  return idx
}

function lineEndIndex(lines: string[], startLine: number, count: number): number {
  let idx = lineStartIndex(lines, startLine)
  for (let k = 0; k < count; k++) {
    idx += lines[startLine + k].length
    if (k < count - 1) idx += 1
  }
  return idx
}

function trimmedLinesMatch(originalLines: string[], searchLines: string[], startAt: number): boolean {
  for (let j = 0; j < searchLines.length; j++) {
    if (originalLines[startAt + j].trim() !== searchLines[j].trim()) return false
  }
  return true
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    if (!trimmedLinesMatch(originalLines, searchLines, i)) continue
    const start = lineStartIndex(originalLines, i)
    const end = lineEndIndex(originalLines, i, searchLines.length)
    yield content.substring(start, end)
  }
}

function blockLineEndIndex(lines: string[], startLine: number, endLine: number): number {
  let idx = lineStartIndex(lines, startLine)
  for (let k = startLine; k <= endLine; k++) {
    idx += lines[k].length
    if (k < endLine) idx += 1
  }
  return idx
}

function computeMiddleSimilarity(
  originalLines: string[],
  searchLines: string[],
  startLine: number,
  endLine: number,
  normalized: boolean,
): number {
  const searchBlockSize = searchLines.length
  const actualBlockSize = endLine - startLine + 1
  const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)

  if (linesToCheck <= 0) return 1.0

  let similarity = 0
  for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
    const originalLine = originalLines[startLine + j].trim()
    const searchLine = searchLines[j].trim()
    const maxLen = Math.max(originalLine.length, searchLine.length)
    if (maxLen === 0) continue
    const distance = levenshtein(originalLine, searchLine)
    const contrib = 1 - distance / maxLen
    similarity += normalized ? contrib / linesToCheck : contrib
    if (normalized && similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) break
  }
  if (!normalized) similarity /= linesToCheck
  return similarity
}

function collectBlockCandidates(
  originalLines: string[],
  firstLine: string,
  lastLine: string,
): Array<{ startLine: number; endLine: number }> {
  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLine) continue
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLine) {
        candidates.push({ startLine: i, endLine: j })
        break
      }
    }
  }
  return candidates
}

function yieldSingleCandidate(
  content: string,
  originalLines: string[],
  searchLines: string[],
  candidate: { startLine: number; endLine: number },
): string | undefined {
  const similarity = computeMiddleSimilarity(originalLines, searchLines, candidate.startLine, candidate.endLine, true)
  if (similarity < SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) return undefined
  const start = lineStartIndex(originalLines, candidate.startLine)
  const end = blockLineEndIndex(originalLines, candidate.startLine, candidate.endLine)
  return content.substring(start, end)
}

function yieldBestCandidate(
  content: string,
  originalLines: string[],
  searchLines: string[],
  candidates: Array<{ startLine: number; endLine: number }>,
): string | undefined {
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  for (const candidate of candidates) {
    const similarity = computeMiddleSimilarity(
      originalLines,
      searchLines,
      candidate.startLine,
      candidate.endLine,
      false,
    )
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  if (maxSimilarity < MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD || !bestMatch) return undefined
  const start = lineStartIndex(originalLines, bestMatch.startLine)
  const end = blockLineEndIndex(originalLines, bestMatch.startLine, bestMatch.endLine)
  return content.substring(start, end)
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) return

  if (searchLines[searchLines.length - 1] === "") searchLines.pop()

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const candidates = collectBlockCandidates(originalLines, firstLineSearch, lastLineSearch)

  if (candidates.length === 0) return

  const match =
    candidates.length === 1
      ? yieldSingleCandidate(content, originalLines, searchLines, candidates[0])
      : yieldBestCandidate(content, originalLines, searchLines, candidates)

  if (match !== undefined) yield match
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function* yieldWhitespaceSingleLineMatches(lines: string[], find: string): Generator<string> {
  const normalizedFind = normalizeWhitespace(find)
  const words = find.trim().split(/\s+/)
  const pattern = words.length > 0 ? words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+") : null

  for (const line of lines) {
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
      continue
    }
    if (!normalizeWhitespace(line).includes(normalizedFind)) continue
    if (!pattern) continue
    try {
      const match = line.match(new RegExp(pattern))
      if (match) yield match[0]
    } catch {
      // Invalid regex pattern, skip
    }
  }
}

function* yieldWhitespaceMultiLineMatches(lines: string[], find: string): Generator<string> {
  const normalizedFind = normalizeWhitespace(find)
  const findLines = find.split("\n")
  if (findLines.length <= 1) return
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length)
    if (normalizeWhitespace(block.join("\n")) === normalizedFind) yield block.join("\n")
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const lines = content.split("\n")
  yield* yieldWhitespaceSingleLineMatches(lines, find)
  yield* yieldWhitespaceMultiLineMatches(lines, find)
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      }),
    )

    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "\n":
          return "\n"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  const unescapedFind = unescapeString(find)

  // Try direct match with unescaped find string
  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  // Also try finding escaped versions in content that match unescaped find
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  let startIndex = 0

  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    yield find
    startIndex = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()

  if (trimmedFind === find) {
    // Already trimmed, no point in trying
    return
  }

  // Try to find the trimmed version
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  // Also try finding blocks where trimmed content matches
  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

function hasContextSimilarity(blockLines: string[], findLines: string[]): boolean {
  if (blockLines.length !== findLines.length) return false
  let matchingLines = 0
  let totalNonEmptyLines = 0
  for (let k = 1; k < blockLines.length - 1; k++) {
    const blockLine = blockLines[k].trim()
    const findLine = findLines[k].trim()
    if (blockLine.length > 0 || findLine.length > 0) {
      totalNonEmptyLines++
      if (blockLine === findLine) matchingLines++
    }
  }
  return totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5
}

function findContextBlock(
  contentLines: string[],
  findLines: string[],
  startLine: number,
  lastLine: string,
): string | undefined {
  for (let j = startLine + 2; j < contentLines.length; j++) {
    if (contentLines[j].trim() !== lastLine) continue
    const blockLines = contentLines.slice(startLine, j + 1)
    if (hasContextSimilarity(blockLines, findLines)) return blockLines.join("\n")
    break
  }
  return undefined
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  if (findLines.length < 3) return

  if (findLines[findLines.length - 1] === "") findLines.pop()

  const contentLines = content.split("\n")
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue
    const block = findContextBlock(contentLines, findLines, i, lastLine)
    if (block !== undefined) {
      yield block
      return // Only match the first occurrence
    }
  }
}

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

type ReplaceOutcome = { type: "replaced"; result: string } | { type: "multipleMatches" } | { type: "notInContent" }

function applySearchMatch(content: string, search: string, newString: string, replaceAll: boolean): ReplaceOutcome {
  const index = content.indexOf(search)
  if (index === -1) return { type: "notInContent" }
  if (replaceAll) return { type: "replaced", result: content.replaceAll(search, newString) }
  const lastIndex = content.lastIndexOf(search)
  if (index !== lastIndex) return { type: "multipleMatches" }
  return {
    type: "replaced",
    result: content.substring(0, index) + newString + content.substring(index + search.length),
  }
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  let foundInContent = false

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const outcome = applySearchMatch(content, search, newString, replaceAll)
      if (outcome.type === "notInContent") continue
      if (outcome.type === "replaced") return outcome.result
      foundInContent = true
    }
  }

  if (!foundInContent) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    )
  }
  throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.")
}
