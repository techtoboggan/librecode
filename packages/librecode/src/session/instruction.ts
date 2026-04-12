import os from "node:os"
import path from "node:path"
import { Flag } from "@/flag/flag"
import { Config } from "../config/config"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"

const log = Log.create({ service: "instruction" })

const FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md", // deprecated
]

function globalFiles() {
  const files = []
  if (Flag.LIBRECODE_CONFIG_DIR) {
    files.push(path.join(Flag.LIBRECODE_CONFIG_DIR, "AGENTS.md"))
  }
  files.push(path.join(Global.Path.config, "AGENTS.md"))
  if (!Flag.LIBRECODE_DISABLE_CLAUDE_CODE_PROMPT) {
    files.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }
  return files
}

async function resolveRelative(instruction: string): Promise<string[]> {
  if (!Flag.LIBRECODE_DISABLE_PROJECT_CONFIG) {
    return Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
  }
  if (!Flag.LIBRECODE_CONFIG_DIR) {
    log.warn(
      `Skipping relative instruction "${instruction}" - no LIBRECODE_CONFIG_DIR set while project config is disabled`,
    )
    return []
  }
  return Filesystem.globUp(instruction, Flag.LIBRECODE_CONFIG_DIR, Flag.LIBRECODE_CONFIG_DIR).catch(() => [])
}

async function addProjectFilePaths(paths: Set<string>): Promise<void> {
  if (Flag.LIBRECODE_DISABLE_PROJECT_CONFIG) return
  for (const file of FILES) {
    const matches = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
    if (matches.length > 0) {
      matches.forEach((p) => void paths.add(path.resolve(p)))
      break
    }
  }
}

async function addGlobalFilePaths(paths: Set<string>): Promise<void> {
  for (const file of globalFiles()) {
    if (await Filesystem.exists(file)) {
      paths.add(path.resolve(file))
      break
    }
  }
}

async function resolveConfigInstruction(instruction: string): Promise<string[]> {
  if (instruction.startsWith("https://") || instruction.startsWith("http://")) return []
  let resolved = instruction
  if (resolved.startsWith("~/")) {
    resolved = path.join(os.homedir(), resolved.slice(2))
  }
  if (path.isAbsolute(resolved)) {
    return Glob.scan(path.basename(resolved), {
      cwd: path.dirname(resolved),
      absolute: true,
      include: "file",
    }).catch(() => [])
  }
  return resolveRelative(resolved)
}

async function addConfigInstructionPaths(paths: Set<string>, instructions: string[]): Promise<void> {
  for (const instruction of instructions) {
    const matches = await resolveConfigInstruction(instruction)
    matches.forEach((p) => void paths.add(path.resolve(p)))
  }
}

const instructionPromptState = Instance.state(() => {
  return {
    claims: new Map<string, Set<string>>(),
  }
})

function isClaimed(messageID: string, filepath: string) {
  const claimed = instructionPromptState().claims.get(messageID)
  if (!claimed) return false
  return claimed.has(filepath)
}

function claim(messageID: string, filepath: string) {
  const current = instructionPromptState()
  let claimed = current.claims.get(messageID)
  if (!claimed) {
    claimed = new Set()
    current.claims.set(messageID, claimed)
  }
  claimed.add(filepath)
}

export function instructionPromptClear(messageID: string): void {
  instructionPromptState().claims.delete(messageID)
}

export async function instructionPromptSystemPaths(): Promise<Set<string>> {
  const config = await Config.get()
  const paths = new Set<string>()

  await addProjectFilePaths(paths)
  await addGlobalFilePaths(paths)

  if (config.instructions) {
    await addConfigInstructionPaths(paths, config.instructions)
  }

  return paths
}

export async function instructionPromptSystem(): Promise<string[]> {
  const config = await Config.get()
  const paths = await instructionPromptSystemPaths()

  const files = Array.from(paths).map(async (p) => {
    const content = await Filesystem.readText(p).catch(() => "")
    return content ? `Instructions from: ${p}\n${content}` : ""
  })

  const urls: string[] = []
  if (config.instructions) {
    for (const instruction of config.instructions) {
      if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
        urls.push(instruction)
      }
    }
  }
  const fetches = urls.map((url) =>
    fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.text() : ""))
      .catch(() => "")
      .then((x) => (x ? `Instructions from: ${url}\n${x}` : "")),
  )

  return Promise.all([...files, ...fetches]).then((result) => result.filter(Boolean))
}

function isLoadedReadPart(part: MessageV2.Part): boolean {
  return (
    part.type === "tool" && part.tool === "read" && part.state.status === "completed" && !part.state.time.compacted
  )
}

function collectLoadedFromPart(part: MessageV2.Part, paths: Set<string>): void {
  if (!isLoadedReadPart(part)) return
  if (part.type !== "tool" || part.state.status !== "completed") return
  const loadedPaths = part.state.metadata?.loaded
  if (!loadedPaths || !Array.isArray(loadedPaths)) return
  for (const p of loadedPaths) {
    if (typeof p === "string") paths.add(p)
  }
}

export function instructionPromptLoaded(messages: MessageV2.WithParts[]): Set<string> {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      collectLoadedFromPart(part, paths)
    }
  }
  return paths
}

export async function instructionPromptFind(dir: string): Promise<string | undefined> {
  for (const file of FILES) {
    const filepath = path.resolve(path.join(dir, file))
    if (await Filesystem.exists(filepath)) return filepath
  }
}

export async function instructionPromptResolve(
  messages: MessageV2.WithParts[],
  filepath: string,
  messageID: string,
): Promise<{ filepath: string; content: string }[]> {
  const system = await instructionPromptSystemPaths()
  const already = instructionPromptLoaded(messages)
  const results: { filepath: string; content: string }[] = []

  const target = path.resolve(filepath)
  let current = path.dirname(target)
  const root = path.resolve(Instance.directory)

  while (current.startsWith(root) && current !== root) {
    const found = await instructionPromptFind(current)

    if (found && found !== target && !system.has(found) && !already.has(found) && !isClaimed(messageID, found)) {
      claim(messageID, found)
      const content = await Filesystem.readText(found).catch(() => undefined)
      if (content) {
        results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` })
      }
    }
    current = path.dirname(current)
  }

  return results
}

export const InstructionPrompt = {
  clear: instructionPromptClear,
  systemPaths: instructionPromptSystemPaths,
  system: instructionPromptSystem,
  loaded: instructionPromptLoaded,
  find: instructionPromptFind,
  resolve: instructionPromptResolve,
} as const
// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace InstructionPrompt {}
