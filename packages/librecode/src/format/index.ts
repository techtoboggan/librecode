import path from "node:path"
import { mergeDeep } from "remeda"
import z from "zod"
import { Bus } from "../bus"
import { Config } from "../config/config"
import { File } from "../file"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Process } from "../util/process"
import * as Formatter from "./formatter"

const formatLog = Log.create({ service: "format" })

const FormatStatus = z
  .object({
    name: z.string(),
    extensions: z.string().array(),
    enabled: z.boolean(),
  })
  .meta({
    ref: "FormatterStatus",
  })
export type FormatStatus = z.infer<typeof FormatStatus>

const formatState = Instance.state(async () => {
  const enabled: Record<string, boolean> = {}
  const cfg = await Config.get()

  const formatters: Record<string, Formatter.Info> = {}
  if (cfg.formatter === false) {
    formatLog.info("all formatters are disabled")
    return {
      enabled,
      formatters,
    }
  }

  for (const item of Object.values(Formatter)) {
    formatters[item.name] = item
  }
  for (const [name, item] of Object.entries(cfg.formatter ?? {})) {
    if (item.disabled) {
      delete formatters[name]
      continue
    }
    const result: Formatter.Info = mergeDeep(formatters[name] ?? {}, {
      command: [],
      extensions: [],
      ...item,
    })

    if (result.command.length === 0) continue

    result.enabled = async () => true
    result.name = name
    formatters[name] = result
  }

  return {
    enabled,
    formatters,
  }
})

async function isEnabled(item: Formatter.Info) {
  const s = await formatState()
  let status = s.enabled[item.name]
  if (status === undefined) {
    status = await item.enabled()
    s.enabled[item.name] = status
  }
  return status
}

async function getFormatter(ext: string) {
  const formatters = await formatState().then((x) => x.formatters)
  const result = []
  for (const item of Object.values(formatters)) {
    formatLog.info("checking", { name: item.name, ext })
    if (!item.extensions.includes(ext)) continue
    if (!(await isEnabled(item))) continue
    formatLog.info("enabled", { name: item.name, ext })
    result.push(item)
  }
  return result
}

async function formatStatus(): Promise<FormatStatus[]> {
  const s = await formatState()
  const result: FormatStatus[] = []
  for (const formatter of Object.values(s.formatters)) {
    const enabled = await isEnabled(formatter)
    result.push({
      name: formatter.name,
      extensions: formatter.extensions,
      enabled,
    })
  }
  return result
}

function formatInit(): void {
  formatLog.info("init")
  Bus.subscribe(File.Event.Edited, async (payload) => {
    const file = payload.properties.file
    formatLog.info("formatting", { file })
    const ext = path.extname(file)

    for (const item of await getFormatter(ext)) {
      formatLog.info("running", { command: item.command })
      try {
        const proc = Process.spawn(
          item.command.map((x) => x.replace("$FILE", file)),
          {
            cwd: Instance.directory,
            env: { ...process.env, ...item.environment },
            stdout: "ignore",
            stderr: "ignore",
          },
        )
        const exit = await proc.exited
        if (exit !== 0)
          formatLog.error("failed", {
            command: item.command,
            ...item.environment,
          })
      } catch (error) {
        formatLog.error("failed to format file", {
          error,
          command: item.command,
          ...item.environment,
          file,
        })
      }
    }
  })
}

export const Format = {
  Status: FormatStatus,
  status: formatStatus,
  init: formatInit,
} as const
