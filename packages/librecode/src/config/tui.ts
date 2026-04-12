import { existsSync } from "fs"
import type z from "zod"
import { mergeDeep, unique } from "remeda"
import { Config } from "./config"
import { ConfigPaths } from "./paths"
import { migrateTuiConfig } from "./migrate-tui-config"
import { TuiInfo } from "./tui-schema"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { Global } from "@/global"

export namespace TuiConfig {
  const log = Log.create({ service: "tui.config" })

  export const Info = TuiInfo

  export type Info = z.output<typeof Info>

  function mergeInfo(target: Info, source: Info): Info {
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

  async function loadGlobalFiles(result: Info): Promise<Info> {
    let out = result
    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      out = mergeInfo(out, await loadFile(file))
    }
    return out
  }

  async function loadProjectFiles(result: Info, projectFiles: string[]): Promise<Info> {
    let out = result
    for (const file of projectFiles) {
      out = mergeInfo(out, await loadFile(file))
    }
    return out
  }

  async function loadDirectoryFiles(result: Info, directories: string[]): Promise<Info> {
    let out = result
    for (const dir of unique(directories)) {
      if (!dir.endsWith(".librecode") && dir !== Flag.LIBRECODE_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        out = mergeInfo(out, await loadFile(file))
      }
    }
    return out
  }

  async function loadManagedFiles(result: Info, managed: string): Promise<Info> {
    let out = result
    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        out = mergeInfo(out, await loadFile(file))
      }
    }
    return out
  }

  const state = Instance.state(async () => {
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

    let result: Info = {}
    result = await loadGlobalFiles(result)

    if (custom) {
      result = mergeInfo(result, await loadFile(custom))
      log.debug("loaded custom tui config", { path: custom })
    }

    result = await loadProjectFiles(result, projectFiles)
    result = await loadDirectoryFiles(result, directories)
    result = await loadManagedFiles(result, managed)

    result.keybinds = Config.Keybinds.parse(result.keybinds ?? {})

    return {
      config: result,
    }
  })

  export async function get(): Promise<Info> {
    return state().then((x) => x.config)
  }

  async function loadFile(filepath: string): Promise<Info> {
    const text = await ConfigPaths.readFile(filepath)
    if (!text) return {}
    return load(text, filepath).catch((error) => {
      log.warn("failed to load tui config", { path: filepath, error })
      return {}
    })
  }

  async function load(text: string, configFilepath: string): Promise<Info> {
    const data = await ConfigPaths.parseText(text, configFilepath, "empty")
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}

    // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
    // (mirroring the old librecode.json shape) still get their settings applied.
    const normalized = normalizeTuiData(data)

    const parsed = Info.safeParse(normalized)
    if (!parsed.success) {
      log.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
      return {}
    }

    return parsed.data
  }
}
