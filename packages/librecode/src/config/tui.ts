import { existsSync } from "node:fs"
import { mergeDeep, unique } from "remeda"
import type z from "zod"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Config } from "./config"
import { migrateTuiConfig } from "./migrate-tui-config"
import { ConfigPaths } from "./paths"
import { TuiInfo } from "./tui-schema"

const tuiLog = Log.create({ service: "tui.config" })

const TuiConfigInfo = TuiInfo

type TuiConfigInfoType = z.output<typeof TuiConfigInfo>

function mergeInfo(target: TuiConfigInfoType, source: TuiConfigInfoType): TuiConfigInfoType {
  return mergeDeep(target, source)
}

function customPath(): string | undefined {
  return Flag.LIBRECODE_TUI_CONFIG
}

function normalizeTuiData(data: unknown): Record<string, unknown> {
  const copy = { ...(data as Record<string, unknown>) }
  if (!("tui" in copy)) return copy
  if (!copy.tui || typeof copy.tui !== "object" || Array.isArray(copy.tui)) {
    delete copy.tui
    return copy
  }
  const tui = copy.tui as Record<string, unknown>
  delete copy.tui
  return { ...tui, ...copy }
}

async function loadGlobalFiles(result: TuiConfigInfoType): Promise<TuiConfigInfoType> {
  let out = result
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    out = mergeInfo(out, await loadFile(file))
  }
  return out
}

async function loadProjectFiles(result: TuiConfigInfoType, projectFiles: string[]): Promise<TuiConfigInfoType> {
  let out = result
  for (const file of projectFiles) {
    out = mergeInfo(out, await loadFile(file))
  }
  return out
}

async function loadDirectoryFiles(result: TuiConfigInfoType, directories: string[]): Promise<TuiConfigInfoType> {
  let out = result
  for (const dir of unique(directories)) {
    if (!dir.endsWith(".librecode") && dir !== Flag.LIBRECODE_CONFIG_DIR) continue
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      out = mergeInfo(out, await loadFile(file))
    }
  }
  return out
}

async function loadManagedFiles(result: TuiConfigInfoType, managed: string): Promise<TuiConfigInfoType> {
  let out = result
  if (existsSync(managed)) {
    for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
      out = mergeInfo(out, await loadFile(file))
    }
  }
  return out
}

const tuiConfigState = Instance.state(async () => {
  let projectFiles = Flag.LIBRECODE_DISABLE_PROJECT_CONFIG
    ? []
    : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)
  const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
  const custom = customPath()
  const managed = Config.managedConfigDir()
  await migrateTuiConfig({ directories, custom, managed })
  // Re-compute after migration since migrateTuiConfig may have created new tui.json files
  projectFiles = Flag.LIBRECODE_DISABLE_PROJECT_CONFIG
    ? []
    : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)

  let result: TuiConfigInfoType = {}
  result = await loadGlobalFiles(result)

  if (custom) {
    result = mergeInfo(result, await loadFile(custom))
    tuiLog.debug("loaded custom tui config", { path: custom })
  }

  result = await loadProjectFiles(result, projectFiles)
  result = await loadDirectoryFiles(result, directories)
  result = await loadManagedFiles(result, managed)

  result.keybinds = Config.Keybinds.parse(result.keybinds ?? {})

  return {
    config: result,
  }
})

async function tuiConfigGet(): Promise<TuiConfigInfoType> {
  return tuiConfigState().then((x) => x.config)
}

async function loadFile(filepath: string): Promise<TuiConfigInfoType> {
  const text = await ConfigPaths.readFile(filepath)
  if (!text) return {}
  return load(text, filepath).catch((error) => {
    tuiLog.warn("failed to load tui config", { path: filepath, error })
    return {}
  })
}

async function load(text: string, configFilepath: string): Promise<TuiConfigInfoType> {
  const data = await ConfigPaths.parseText(text, configFilepath, "empty")
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}

  // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
  // (mirroring the old librecode.json shape) still get their settings applied.
  const normalized = normalizeTuiData(data)

  const parsed = TuiConfigInfo.safeParse(normalized)
  if (!parsed.success) {
    tuiLog.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
    return {}
  }

  return parsed.data
}

export const TuiConfig = {
  Info: TuiConfigInfo,
  get: tuiConfigGet,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace TuiConfig {
  type Info = TuiConfigInfoType
}
