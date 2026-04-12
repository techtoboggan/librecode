import path from "node:path"
import { text } from "node:stream/consumers"
import z from "zod"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Process } from "../util/process"
import { assertExternalDirectory } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import { Tool } from "./tool"

const MAX_LINE_LENGTH = 2000
const GREP_RESULT_LIMIT = 100

interface GrepMatch {
  path: string
  modTime: number
  lineNum: number
  lineText: string
}

function parseGrepLine(line: string): GrepMatch | null {
  if (!line) return null
  const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
  if (!filePath || !lineNumStr || lineTextParts.length === 0) return null

  const lineNum = parseInt(lineNumStr, 10)
  const lineText = lineTextParts.join("|")
  const stats = Filesystem.stat(filePath)
  if (!stats) return null

  return { path: filePath, modTime: stats.mtime.getTime(), lineNum, lineText }
}

function truncateLineText(text: string): string {
  return text.length > MAX_LINE_LENGTH ? `${text.substring(0, MAX_LINE_LENGTH)}...` : text
}

function buildRgArgs(pattern: string, include: string | undefined, searchPath: string): string[] {
  const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", pattern]
  if (include) args.push("--glob", include)
  args.push(searchPath)
  return args
}

interface RipgrepResult {
  matches: GrepMatch[]
  hasErrors: boolean
}

async function runRipgrep(
  rgPath: string,
  args: string[],
  abort: AbortSignal,
  _pattern: string,
): Promise<{ noMatches: true } | ({ noMatches: false } & RipgrepResult)> {
  const proc = Process.spawn([rgPath, ...args], { stdout: "pipe", stderr: "pipe", abort })
  if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

  const output = await text(proc.stdout)
  const errorOutput = await text(proc.stderr)
  const exitCode = await proc.exited

  if (exitCode === 1 || (exitCode === 2 && !output.trim())) return { noMatches: true }
  if (exitCode !== 0 && exitCode !== 2) throw new Error(`ripgrep failed: ${errorOutput}`)

  const hasErrors = exitCode === 2
  const lines = output.trim().split(/\r?\n/)
  const matches: GrepMatch[] = []
  for (const line of lines) {
    const match = parseGrepLine(line)
    if (match) matches.push(match)
  }
  return { noMatches: false, matches, hasErrors }
}

function buildGrepOutput(matches: GrepMatch[], totalMatches: number, truncated: boolean, hasErrors: boolean): string {
  const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${GREP_RESULT_LIMIT})` : ""}`]

  let currentFile = ""
  for (const match of matches) {
    if (currentFile !== match.path) {
      if (currentFile !== "") outputLines.push("")
      currentFile = match.path
      outputLines.push(`${match.path}:`)
    }
    outputLines.push(`  Line ${match.lineNum}: ${truncateLineText(match.lineText)}`)
  }

  if (truncated) {
    outputLines.push("")
    outputLines.push(
      `(Results truncated: showing ${GREP_RESULT_LIMIT} of ${totalMatches} matches (${totalMatches - GREP_RESULT_LIMIT} hidden). Consider using a more specific path or pattern.)`,
    )
  }

  if (hasErrors) {
    outputLines.push("")
    outputLines.push("(Some paths were inaccessible and skipped)")
  }

  return outputLines.join("\n")
}

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const rgPath = await Ripgrep.filepath()
    const args = buildRgArgs(params.pattern, params.include, searchPath)
    const rgResult = await runRipgrep(rgPath, args, ctx.abort, params.pattern)

    if (rgResult.noMatches) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const { matches, hasErrors } = rgResult

    matches.sort((a, b) => b.modTime - a.modTime)

    const truncated = matches.length > GREP_RESULT_LIMIT
    const finalMatches = truncated ? matches.slice(0, GREP_RESULT_LIMIT) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const totalMatches = matches.length
    return {
      title: params.pattern,
      metadata: { matches: totalMatches, truncated },
      output: buildGrepOutput(finalMatches, totalMatches, truncated, hasErrors),
    }
  },
})
