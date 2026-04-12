import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Language } from "web-tree-sitter"
import z from "zod"
import { Flag } from "@/flag/flag.ts"
import { BashArity } from "@/permission/arity"
import { Plugin } from "@/plugin"
import { Shell } from "@/shell/shell"

import { Filesystem } from "@/util/filesystem"
import { lazy } from "@/util/lazy"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import DESCRIPTION from "./bash.txt"
import { Tool } from "./tool"
import { Truncate } from "./truncation"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.LIBRECODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

const FILE_COMMANDS = new Set(["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"])
const ACCEPTED_CHILD_TYPES = new Set(["command_name", "word", "string", "raw_string", "concatenation"])

interface CommandPermissions {
  directories: Set<string>
  patterns: Set<string>
  always: Set<string>
}

function extractCommandTokens(node: import("web-tree-sitter").Node): string[] {
  const command: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && ACCEPTED_CHILD_TYPES.has(child.type)) command.push(child.text)
  }
  return command
}

async function resolveExternalDir(arg: string, cwd: string): Promise<string | null> {
  const resolved = await fs.realpath(path.resolve(cwd, arg)).catch(() => "")
  if (!resolved) return null
  const normalized = process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
  if (Instance.containsPath(normalized)) return null
  return (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
}

async function collectFileCommandDirs(command: string[], cwd: string): Promise<string[]> {
  const dirs: string[] = []
  for (const arg of command.slice(1)) {
    if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
    log.info("resolved path", { arg })
    const dir = await resolveExternalDir(arg, cwd)
    if (dir) dirs.push(dir)
  }
  return dirs
}

interface NodePermissions {
  dirs: string[]
  commandText: string | null
  alwaysEntry: string | null
}

async function processCommandNode(node: import("web-tree-sitter").Node, cwd: string): Promise<NodePermissions> {
  const commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text
  const command = extractCommandTokens(node)
  const dirs = FILE_COMMANDS.has(command[0]) ? await collectFileCommandDirs(command, cwd) : []
  const addPattern = command.length > 0 && command[0] !== "cd"
  return {
    dirs,
    commandText: addPattern ? commandText : null,
    alwaysEntry: addPattern ? `${BashArity.prefix(command).join(" ")} *` : null,
  }
}

async function collectCommandPermissions(
  tree: import("web-tree-sitter").Tree,
  cwd: string,
): Promise<CommandPermissions> {
  const directories = new Set<string>()
  if (!Instance.containsPath(cwd)) directories.add(cwd)
  const patterns = new Set<string>()
  const always = new Set<string>()

  for (const node of tree.rootNode.descendantsOfType("command")) {
    if (!node) continue
    const { dirs, commandText, alwaysEntry } = await processCommandNode(node, cwd)
    for (const dir of dirs) directories.add(dir)
    if (commandText) patterns.add(commandText)
    if (alwaysEntry) always.add(alwaysEntry)
  }

  return { directories, patterns, always }
}

interface SpawnResult {
  output: string
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
}

async function spawnAndWait(
  command: string,
  shell: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout: number,
  abort: AbortSignal,
  onChunk: (chunk: Buffer) => void,
): Promise<SpawnResult> {
  const proc = spawn(command, {
    shell,
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: process.platform === "win32",
  })

  let output = ""
  let timedOut = false
  let aborted = false
  let exited = false

  const kill = () => Shell.killTree(proc, { exited: () => exited })
  if (abort.aborted) {
    aborted = true
    await kill()
  }

  const abortHandler = () => {
    aborted = true
    void kill()
  }
  abort.addEventListener("abort", abortHandler, { once: true })
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    void kill()
  }, timeout + 100)

  const append = (chunk: Buffer) => {
    output += chunk.toString()
    onChunk(chunk)
  }
  proc.stdout?.on("data", append)
  proc.stderr?.on("data", append)

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutTimer)
      abort.removeEventListener("abort", abortHandler)
    }
    proc.once("exit", () => {
      exited = true
      cleanup()
      resolve()
    })
    proc.once("error", (error) => {
      exited = true
      cleanup()
      reject(error)
    })
  })

  return { output, exitCode: proc.exitCode, timedOut, aborted }
}

function dirToGlob(dir: string): string {
  if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
  return path.join(dir, "*")
}

function truncateOutput(output: string): string {
  return output.length > MAX_METADATA_LENGTH ? `${output.slice(0, MAX_METADATA_LENGTH)}\n\n...` : output
}

function buildBashMetadataSuffix(timedOut: boolean, aborted: boolean, timeout: number): string {
  const parts: string[] = []
  if (timedOut) parts.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
  if (aborted) parts.push("User aborted the command")
  return parts.length > 0 ? `\n\n<bash_metadata>\n${parts.join("\n")}\n</bash_metadata>` : ""
}

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholders replaced at runtime
      .replaceAll("${directory}", Instance.directory)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholders replaced at runtime
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholders replaced at runtime
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) throw new Error("Failed to parse command")

      const { directories, patterns, always } = await collectCommandPermissions(tree, cwd)

      if (directories.size > 0) {
        const globs = Array.from(directories).map(dirToGlob)
        await ctx.ask({ permission: "external_directory", patterns: globs, always: globs, metadata: {} })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )

      ctx.metadata({ metadata: { output: "", description: params.description } })

      let liveOutput = ""
      const onChunk = (chunk: Buffer) => {
        liveOutput += chunk.toString()
        ctx.metadata({ metadata: { output: truncateOutput(liveOutput), description: params.description } })
      }

      const { output, exitCode, timedOut, aborted } = await spawnAndWait(
        params.command,
        shell,
        cwd,
        { ...process.env, ...shellEnv.env },
        timeout,
        ctx.abort,
        onChunk,
      )

      const finalOutput = output + buildBashMetadataSuffix(timedOut, aborted, timeout)
      return {
        title: params.description,
        metadata: { output: truncateOutput(finalOutput), exit: exitCode, description: params.description },
        output: finalOutput,
      }
    },
  }
})
