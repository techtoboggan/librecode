import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { readFileSync } from "fs"
import { Log } from "../util/log"

export namespace Patch {
  const log = Log.create({ service: "patch" })

  // Schema definitions
  export const PatchSchema = z.object({
    patchText: z.string().describe("The full patch text that describes all changes to be made"),
  })

  export type PatchParams = z.infer<typeof PatchSchema>

  // Core types matching the Rust implementation
  export interface ApplyPatchArgs {
    patch: string
    hunks: Hunk[]
    workdir?: string
  }

  export type Hunk =
    | { type: "add"; path: string; contents: string }
    | { type: "delete"; path: string }
    | { type: "update"; path: string; move_path?: string; chunks: UpdateFileChunk[] }

  export interface UpdateFileChunk {
    old_lines: string[]
    new_lines: string[]
    change_context?: string
    is_end_of_file?: boolean
  }

  export interface ApplyPatchAction {
    changes: Map<string, ApplyPatchFileChange>
    patch: string
    cwd: string
  }

  export type ApplyPatchFileChange =
    | { type: "add"; content: string }
    | { type: "delete"; content: string }
    | { type: "update"; unified_diff: string; move_path?: string; new_content: string }

  export interface AffectedPaths {
    added: string[]
    modified: string[]
    deleted: string[]
  }

  export enum ApplyPatchError {
    ParseError = "ParseError",
    IoError = "IoError",
    ComputeReplacements = "ComputeReplacements",
    ImplicitInvocation = "ImplicitInvocation",
  }

  export enum MaybeApplyPatch {
    Body = "Body",
    ShellParseError = "ShellParseError",
    PatchParseError = "PatchParseError",
    NotApplyPatch = "NotApplyPatch",
  }

  export enum MaybeApplyPatchVerified {
    Body = "Body",
    ShellParseError = "ShellParseError",
    CorrectnessError = "CorrectnessError",
    NotApplyPatch = "NotApplyPatch",
  }

  // Parser implementation
  function parsePatchHeader(
    lines: string[],
    startIdx: number,
  ): { filePath: string; movePath?: string; nextIdx: number } | null {
    const line = lines[startIdx]

    if (line.startsWith("*** Add File:")) {
      const filePath = line.slice("*** Add File:".length).trim()
      return filePath ? { filePath, nextIdx: startIdx + 1 } : null
    }

    if (line.startsWith("*** Delete File:")) {
      const filePath = line.slice("*** Delete File:".length).trim()
      return filePath ? { filePath, nextIdx: startIdx + 1 } : null
    }

    if (line.startsWith("*** Update File:")) {
      const filePath = line.slice("*** Update File:".length).trim()
      let movePath: string | undefined
      let nextIdx = startIdx + 1

      // Check for move directive
      if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Move to:")) {
        movePath = lines[nextIdx].slice("*** Move to:".length).trim()
        nextIdx++
      }

      return filePath ? { filePath, movePath, nextIdx } : null
    }

    return null
  }

  // Parse a single @@ chunk from the patch, returning the chunk and the next index
  function parseChunkLines(
    lines: string[],
    startIdx: number,
    endBound: number,
  ): { chunk: UpdateFileChunk; nextIdx: number } {
    const contextLine = lines[startIdx].substring(2).trim()
    let i = startIdx + 1

    const oldLines: string[] = []
    const newLines: string[] = []
    let isEndOfFile = false

    while (i < endBound && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
      const changeLine = lines[i]

      if (changeLine === "*** End of File") {
        isEndOfFile = true
        i++
        break
      }

      if (changeLine.startsWith(" ")) {
        const content = changeLine.substring(1)
        oldLines.push(content)
        newLines.push(content)
      } else if (changeLine.startsWith("-")) {
        oldLines.push(changeLine.substring(1))
      } else if (changeLine.startsWith("+")) {
        newLines.push(changeLine.substring(1))
      }

      i++
    }

    return {
      chunk: {
        old_lines: oldLines,
        new_lines: newLines,
        change_context: contextLine || undefined,
        is_end_of_file: isEndOfFile || undefined,
      },
      nextIdx: i,
    }
  }

  function parseUpdateFileChunks(lines: string[], startIdx: number): { chunks: UpdateFileChunk[]; nextIdx: number } {
    const chunks: UpdateFileChunk[] = []
    let i = startIdx

    while (i < lines.length && !lines[i].startsWith("***")) {
      if (lines[i].startsWith("@@")) {
        const { chunk, nextIdx } = parseChunkLines(lines, i, lines.length)
        chunks.push(chunk)
        i = nextIdx
      } else {
        i++
      }
    }

    return { chunks, nextIdx: i }
  }

  function parseAddFileContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
    let content = ""
    let i = startIdx

    while (i < lines.length && !lines[i].startsWith("***")) {
      if (lines[i].startsWith("+")) {
        content += lines[i].substring(1) + "\n"
      }
      i++
    }

    // Remove trailing newline
    if (content.endsWith("\n")) {
      content = content.slice(0, -1)
    }

    return { content, nextIdx: i }
  }

  function stripHeredoc(input: string): string {
    // Match heredoc patterns like: cat <<'EOF'\n...\nEOF or <<EOF\n...\nEOF
    const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/)
    if (heredocMatch) {
      return heredocMatch[2]
    }
    return input
  }

  export function parsePatch(patchText: string): { hunks: Hunk[] } {
    const cleaned = stripHeredoc(patchText.trim())
    const lines = cleaned.split("\n")
    const hunks: Hunk[] = []
    let i = 0

    // Look for Begin/End patch markers
    const beginMarker = "*** Begin Patch"
    const endMarker = "*** End Patch"

    const beginIdx = lines.findIndex((line) => line.trim() === beginMarker)
    const endIdx = lines.findIndex((line) => line.trim() === endMarker)

    if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
      throw new Error("Invalid patch format: missing Begin/End markers")
    }

    // Parse content between markers
    i = beginIdx + 1

    while (i < endIdx) {
      const header = parsePatchHeader(lines, i)
      if (!header) {
        i++
        continue
      }

      if (lines[i].startsWith("*** Add File:")) {
        const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx)
        hunks.push({
          type: "add",
          path: header.filePath,
          contents: content,
        })
        i = nextIdx
      } else if (lines[i].startsWith("*** Delete File:")) {
        hunks.push({
          type: "delete",
          path: header.filePath,
        })
        i = header.nextIdx
      } else if (lines[i].startsWith("*** Update File:")) {
        const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx)
        hunks.push({
          type: "update",
          path: header.filePath,
          move_path: header.movePath,
          chunks,
        })
        i = nextIdx
      } else {
        i++
      }
    }

    return { hunks }
  }

  // Apply patch functionality
  export function maybeParseApplyPatch(
    argv: string[],
  ):
    | { type: MaybeApplyPatch.Body; args: ApplyPatchArgs }
    | { type: MaybeApplyPatch.PatchParseError; error: Error }
    | { type: MaybeApplyPatch.NotApplyPatch } {
    const APPLY_PATCH_COMMANDS = ["apply_patch", "applypatch"]

    // Direct invocation: apply_patch <patch>
    if (argv.length === 2 && APPLY_PATCH_COMMANDS.includes(argv[0])) {
      try {
        const { hunks } = parsePatch(argv[1])
        return {
          type: MaybeApplyPatch.Body,
          args: {
            patch: argv[1],
            hunks,
          },
        }
      } catch (error) {
        return {
          type: MaybeApplyPatch.PatchParseError,
          error: error as Error,
        }
      }
    }

    // Bash heredoc form: bash -lc 'apply_patch <<"EOF" ...'
    if (argv.length === 3 && argv[0] === "bash" && argv[1] === "-lc") {
      // Simple extraction - in real implementation would need proper bash parsing
      const script = argv[2]
      const heredocMatch = script.match(/apply_patch\s*<<['"](\w+)['"]\s*\n([\s\S]*?)\n\1/)

      if (heredocMatch) {
        const patchContent = heredocMatch[2]
        try {
          const { hunks } = parsePatch(patchContent)
          return {
            type: MaybeApplyPatch.Body,
            args: {
              patch: patchContent,
              hunks,
            },
          }
        } catch (error) {
          return {
            type: MaybeApplyPatch.PatchParseError,
            error: error as Error,
          }
        }
      }
    }

    return { type: MaybeApplyPatch.NotApplyPatch }
  }

  // File content manipulation
  interface ApplyPatchFileUpdate {
    unified_diff: string
    content: string
  }

  export function deriveNewContentsFromChunks(filePath: string, chunks: UpdateFileChunk[]): ApplyPatchFileUpdate {
    // Read original file content
    let originalContent: string
    try {
      originalContent = readFileSync(filePath, "utf-8")
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`)
    }

    const originalLines = originalContent.split("\n")

    // Drop trailing empty element for consistent line counting
    if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
      originalLines.pop()
    }

    const replacements = computeReplacements(originalLines, filePath, chunks)
    const newLines = applyReplacements(originalLines, replacements)

    // Ensure trailing newline
    if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
      newLines.push("")
    }

    const newContent = newLines.join("\n")

    // Generate unified diff
    const unifiedDiff = generateUnifiedDiff(originalContent, newContent)

    return {
      unified_diff: unifiedDiff,
      content: newContent,
    }
  }

  // Strip trailing empty line from pattern and corresponding new slice if present
  function stripTrailingEmpty(pattern: string[], newSlice: string[]): { pattern: string[]; newSlice: string[] } {
    if (pattern.length > 0 && pattern[pattern.length - 1] === "") {
      const trimmedNew = newSlice.length > 0 && newSlice[newSlice.length - 1] === "" ? newSlice.slice(0, -1) : newSlice
      return { pattern: pattern.slice(0, -1), newSlice: trimmedNew }
    }
    return { pattern, newSlice }
  }

  // Seek a chunk's old_lines in originalLines, retrying with trailing empty stripped
  function seekChunk(
    originalLines: string[],
    chunk: UpdateFileChunk,
    lineIndex: number,
  ): { found: number; pattern: string[]; newSlice: string[] } {
    let pattern = chunk.old_lines
    let newSlice = chunk.new_lines
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file)

    if (found === -1) {
      const stripped = stripTrailingEmpty(pattern, newSlice)
      if (stripped.pattern !== pattern) {
        pattern = stripped.pattern
        newSlice = stripped.newSlice
        found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file)
      }
    }

    return { found, pattern, newSlice }
  }

  // Resolve the insertion index for a pure-addition chunk (no old lines)
  function additionInsertionIndex(originalLines: string[]): number {
    return originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
      ? originalLines.length - 1
      : originalLines.length
  }

  // Advance lineIndex for context-based seeking; throws if context not found
  function advanceContextIndex(
    originalLines: string[],
    chunk: UpdateFileChunk,
    lineIndex: number,
    filePath: string,
  ): number {
    if (!chunk.change_context) return lineIndex
    const contextIdx = seekSequence(originalLines, [chunk.change_context], lineIndex)
    if (contextIdx === -1) {
      throw new Error(`Failed to find context '${chunk.change_context}' in ${filePath}`)
    }
    return contextIdx + 1
  }

  // Process one chunk and push its replacement; returns new lineIndex
  function processChunk(
    originalLines: string[],
    chunk: UpdateFileChunk,
    lineIndex: number,
    filePath: string,
    replacements: Array<[number, number, string[]]>,
  ): number {
    const advanced = advanceContextIndex(originalLines, chunk, lineIndex, filePath)

    if (chunk.old_lines.length === 0) {
      replacements.push([additionInsertionIndex(originalLines), 0, chunk.new_lines])
      return advanced
    }

    const { found, pattern, newSlice } = seekChunk(originalLines, chunk, advanced)
    if (found === -1) {
      throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.old_lines.join("\n")}`)
    }
    replacements.push([found, pattern.length, newSlice])
    return found + pattern.length
  }

  function computeReplacements(
    originalLines: string[],
    filePath: string,
    chunks: UpdateFileChunk[],
  ): Array<[number, number, string[]]> {
    const replacements: Array<[number, number, string[]]> = []
    let lineIndex = 0

    for (const chunk of chunks) {
      lineIndex = processChunk(originalLines, chunk, lineIndex, filePath, replacements)
    }

    replacements.sort((a, b) => a[0] - b[0])
    return replacements
  }

  function applyReplacements(lines: string[], replacements: Array<[number, number, string[]]>): string[] {
    // Apply replacements in reverse order to avoid index shifting
    const result = [...lines]

    for (let i = replacements.length - 1; i >= 0; i--) {
      const [startIdx, oldLen, newSegment] = replacements[i]

      // Remove old lines
      result.splice(startIdx, oldLen)

      // Insert new lines
      for (let j = 0; j < newSegment.length; j++) {
        result.splice(startIdx + j, 0, newSegment[j])
      }
    }

    return result
  }

  // Normalize Unicode punctuation to ASCII equivalents (like Rust's normalize_unicode)
  function normalizeUnicode(str: string): string {
    return str
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // single quotes
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // double quotes
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-") // dashes
      .replace(/\u2026/g, "...") // ellipsis
      .replace(/\u00A0/g, " ") // non-breaking space
  }

  type Comparator = (a: string, b: string) => boolean

  // Attempt to match pattern at end-of-file anchor position, return index or -1
  function tryMatchEof(lines: string[], pattern: string[], startIndex: number, compare: Comparator): number {
    const fromEnd = lines.length - pattern.length
    if (fromEnd < startIndex) return -1
    for (let j = 0; j < pattern.length; j++) {
      if (!compare(lines[fromEnd + j], pattern[j])) return -1
    }
    return fromEnd
  }

  // Forward-scan for pattern from startIndex, return index or -1
  function tryMatchForward(lines: string[], pattern: string[], startIndex: number, compare: Comparator): number {
    for (let i = startIndex; i <= lines.length - pattern.length; i++) {
      let matches = true
      for (let j = 0; j < pattern.length; j++) {
        if (!compare(lines[i + j], pattern[j])) {
          matches = false
          break
        }
      }
      if (matches) return i
    }
    return -1
  }

  function tryMatch(lines: string[], pattern: string[], startIndex: number, compare: Comparator, eof: boolean): number {
    if (eof) {
      const eofIdx = tryMatchEof(lines, pattern, startIndex, compare)
      if (eofIdx !== -1) return eofIdx
    }
    return tryMatchForward(lines, pattern, startIndex, compare)
  }

  function seekSequence(lines: string[], pattern: string[], startIndex: number, eof = false): number {
    if (pattern.length === 0) return -1

    // Pass 1: exact match
    const exact = tryMatch(lines, pattern, startIndex, (a, b) => a === b, eof)
    if (exact !== -1) return exact

    // Pass 2: rstrip (trim trailing whitespace)
    const rstrip = tryMatch(lines, pattern, startIndex, (a, b) => a.trimEnd() === b.trimEnd(), eof)
    if (rstrip !== -1) return rstrip

    // Pass 3: trim (both ends)
    const trim = tryMatch(lines, pattern, startIndex, (a, b) => a.trim() === b.trim(), eof)
    if (trim !== -1) return trim

    // Pass 4: normalized (Unicode punctuation to ASCII)
    const normalized = tryMatch(
      lines,
      pattern,
      startIndex,
      (a, b) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()),
      eof,
    )
    return normalized
  }

  // Produce the diff contribution for a single (old, new) line pair
  function diffLinePair(oldLine: string, newLine: string): string {
    if (oldLine === newLine) return oldLine ? ` ${oldLine}\n` : ""
    return (oldLine ? `-${oldLine}\n` : "") + (newLine ? `+${newLine}\n` : "")
  }

  // Build a line-by-line diff entry: removed old, added new, kept same
  function collectDiffLines(oldLines: string[], newLines: string[]): string {
    let result = ""
    const maxLen = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxLen; i++) {
      result += diffLinePair(oldLines[i] || "", newLines[i] || "")
    }
    return result
  }

  function generateUnifiedDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split("\n")
    const newLines = newContent.split("\n")

    const body = collectDiffLines(oldLines, newLines)
    return body ? `@@ -1 +1 @@\n${body}` : ""
  }

  // Apply a single "add" hunk to the filesystem
  async function applyAddHunk(hunk: Extract<Hunk, { type: "add" }>, added: string[]): Promise<void> {
    const addDir = path.dirname(hunk.path)
    if (addDir !== "." && addDir !== "/") {
      await fs.mkdir(addDir, { recursive: true })
    }
    await fs.writeFile(hunk.path, hunk.contents, "utf-8")
    added.push(hunk.path)
    log.info(`Added file: ${hunk.path}`)
  }

  // Apply a single "delete" hunk to the filesystem
  async function applyDeleteHunk(hunk: Extract<Hunk, { type: "delete" }>, deleted: string[]): Promise<void> {
    await fs.unlink(hunk.path)
    deleted.push(hunk.path)
    log.info(`Deleted file: ${hunk.path}`)
  }

  // Apply a single "update" hunk to the filesystem (handles move_path)
  async function applyUpdateHunk(hunk: Extract<Hunk, { type: "update" }>, modified: string[]): Promise<void> {
    const fileUpdate = deriveNewContentsFromChunks(hunk.path, hunk.chunks)

    if (hunk.move_path) {
      const moveDir = path.dirname(hunk.move_path)
      if (moveDir !== "." && moveDir !== "/") {
        await fs.mkdir(moveDir, { recursive: true })
      }
      await fs.writeFile(hunk.move_path, fileUpdate.content, "utf-8")
      await fs.unlink(hunk.path)
      modified.push(hunk.move_path)
      log.info(`Moved file: ${hunk.path} -> ${hunk.move_path}`)
    } else {
      await fs.writeFile(hunk.path, fileUpdate.content, "utf-8")
      modified.push(hunk.path)
      log.info(`Updated file: ${hunk.path}`)
    }
  }

  // Apply hunks to filesystem
  export async function applyHunksToFiles(hunks: Hunk[]): Promise<AffectedPaths> {
    if (hunks.length === 0) {
      throw new Error("No files were modified.")
    }

    const added: string[] = []
    const modified: string[] = []
    const deleted: string[] = []

    for (const hunk of hunks) {
      switch (hunk.type) {
        case "add":
          await applyAddHunk(hunk, added)
          break
        case "delete":
          await applyDeleteHunk(hunk, deleted)
          break
        case "update":
          await applyUpdateHunk(hunk, modified)
          break
      }
    }

    return { added, modified, deleted }
  }

  // Main patch application function
  export async function applyPatch(patchText: string): Promise<AffectedPaths> {
    const { hunks } = parsePatch(patchText)
    return applyHunksToFiles(hunks)
  }

  // Build ApplyPatchFileChange for a "delete" hunk, reading file content from disk
  async function buildDeleteChange(
    hunk: Extract<Hunk, { type: "delete" }>,
    effectiveCwd: string,
  ): Promise<{ ok: true; resolvedPath: string; change: ApplyPatchFileChange } | { ok: false; error: Error }> {
    const deletePath = path.resolve(effectiveCwd, hunk.path)
    try {
      const content = await fs.readFile(deletePath, "utf-8")
      return { ok: true, resolvedPath: deletePath, change: { type: "delete", content } }
    } catch {
      return { ok: false, error: new Error(`Failed to read file for deletion: ${deletePath}`) }
    }
  }

  // Build ApplyPatchFileChange for an "update" hunk
  function buildUpdateChange(
    hunk: Extract<Hunk, { type: "update" }>,
    effectiveCwd: string,
  ): { ok: true; resolvedPath: string; change: ApplyPatchFileChange } | { ok: false; error: Error } {
    const updatePath = path.resolve(effectiveCwd, hunk.path)
    const resolvedPath = path.resolve(effectiveCwd, hunk.move_path ?? hunk.path)
    try {
      const fileUpdate = deriveNewContentsFromChunks(updatePath, hunk.chunks)
      return {
        ok: true,
        resolvedPath,
        change: {
          type: "update",
          unified_diff: fileUpdate.unified_diff,
          move_path: hunk.move_path ? path.resolve(effectiveCwd, hunk.move_path) : undefined,
          new_content: fileUpdate.content,
        },
      }
    } catch (error) {
      return { ok: false, error: error as Error }
    }
  }

  type HunkChangeResult = { ok: true; resolvedPath: string; change: ApplyPatchFileChange } | { ok: false; error: Error }

  // Resolve a single hunk to a (path, change) entry or an error
  async function resolveHunkChange(hunk: Hunk, effectiveCwd: string): Promise<HunkChangeResult> {
    if (hunk.type === "add") {
      return {
        ok: true,
        resolvedPath: path.resolve(effectiveCwd, hunk.path),
        change: { type: "add", content: hunk.contents },
      }
    }
    if (hunk.type === "delete") return buildDeleteChange(hunk, effectiveCwd)
    return buildUpdateChange(hunk, effectiveCwd)
  }

  // Accumulate changes for all hunks; return error result on first failure
  async function buildChangesMap(
    hunks: Hunk[],
    effectiveCwd: string,
  ): Promise<{ ok: true; changes: Map<string, ApplyPatchFileChange> } | { ok: false; error: Error }> {
    const changes = new Map<string, ApplyPatchFileChange>()

    for (const hunk of hunks) {
      const result = await resolveHunkChange(hunk, effectiveCwd)
      if (!result.ok) return { ok: false, error: result.error }
      changes.set(result.resolvedPath, result.change)
    }

    return { ok: true, changes }
  }

  // Async version of maybeParseApplyPatchVerified
  export async function maybeParseApplyPatchVerified(
    argv: string[],
    cwd: string,
  ): Promise<
    | { type: MaybeApplyPatchVerified.Body; action: ApplyPatchAction }
    | { type: MaybeApplyPatchVerified.CorrectnessError; error: Error }
    | { type: MaybeApplyPatchVerified.NotApplyPatch }
  > {
    // Detect implicit patch invocation (raw patch without apply_patch command)
    if (argv.length === 1) {
      try {
        parsePatch(argv[0])
        return {
          type: MaybeApplyPatchVerified.CorrectnessError,
          error: new Error(ApplyPatchError.ImplicitInvocation),
        }
      } catch {
        // Not a patch, continue
      }
    }

    const result = maybeParseApplyPatch(argv)

    if (result.type === MaybeApplyPatch.NotApplyPatch) {
      return { type: MaybeApplyPatchVerified.NotApplyPatch }
    }

    if (result.type === MaybeApplyPatch.PatchParseError) {
      return { type: MaybeApplyPatchVerified.CorrectnessError, error: result.error }
    }

    const { args } = result
    const effectiveCwd = args.workdir ? path.resolve(cwd, args.workdir) : cwd
    const changesResult = await buildChangesMap(args.hunks, effectiveCwd)

    if (!changesResult.ok) {
      return { type: MaybeApplyPatchVerified.CorrectnessError, error: changesResult.error }
    }

    return {
      type: MaybeApplyPatchVerified.Body,
      action: {
        changes: changesResult.changes,
        patch: args.patch,
        cwd: effectiveCwd,
      },
    }
  }
}
