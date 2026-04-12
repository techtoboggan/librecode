import path from "node:path"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import { Installation } from "../installation"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist

const _modelsDevLog = Log.create({ service: "models.dev" })
const _modelsDevFilepath = path.join(Global.Path.cache, "models.json")

export const Model = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string().optional(),
  release_date: z.string(),
  attachment: z.boolean(),
  reasoning: z.boolean(),
  temperature: z.boolean(),
  tool_call: z.boolean(),
  interleaved: z
    .union([
      z.literal(true),
      z
        .object({
          field: z.enum(["reasoning_content", "reasoning_details"]),
        })
        .strict(),
    ])
    .optional(),
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      cache_read: z.number().optional(),
      cache_write: z.number().optional(),
      context_over_200k: z
        .object({
          input: z.number(),
          output: z.number(),
          cache_read: z.number().optional(),
          cache_write: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  limit: z.object({
    context: z.number(),
    input: z.number().optional(),
    output: z.number(),
  }),
  modalities: z
    .object({
      input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
    })
    .optional(),
  experimental: z.boolean().optional(),
  status: z.enum(["alpha", "beta", "deprecated"]).optional(),
  options: z.record(z.string(), z.any()),
  headers: z.record(z.string(), z.string()).optional(),
  provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
  variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
})
export type Model = z.infer<typeof Model>

export const Provider = z.object({
  api: z.string().optional(),
  name: z.string(),
  env: z.array(z.string()),
  id: z.string(),
  npm: z.string().optional(),
  models: z.record(z.string(), Model),
})

export type Provider = z.infer<typeof Provider>

function _modelsDevUrl(): string {
  return Flag.LIBRECODE_MODELS_URL || "https://models.dev"
}

export const Data = lazy(async () => {
  const result = await Filesystem.readJson(Flag.LIBRECODE_MODELS_PATH ?? _modelsDevFilepath).catch(() => {})
  if (result) return result
  const snapshot = await import("./models-snapshot")
    .then((m) => m.snapshot as Record<string, unknown>)
    .catch(() => undefined)
  if (snapshot) return snapshot
  if (Flag.LIBRECODE_DISABLE_MODELS_FETCH) return {}
  const json = await fetch(`${_modelsDevUrl()}/api.json`).then((x) => x.text())
  return JSON.parse(json)
})

async function modelsDevGet(): Promise<Record<string, Provider>> {
  const result = await Data()
  return result as Record<string, Provider>
}

async function modelsDevRefresh(): Promise<void> {
  const result = await fetch(`${_modelsDevUrl()}/api.json`, {
    headers: {
      "User-Agent": Installation.USER_AGENT,
    },
    signal: AbortSignal.timeout(10 * 1000),
  }).catch((e) => {
    _modelsDevLog.error("Failed to fetch models.dev", {
      error: e,
    })
  })
  if (result?.ok) {
    await Filesystem.write(_modelsDevFilepath, await result.text())
    Data.reset()
  }
}

export const ModelsDev = {
  Model,
  Provider,
  Data,
  get: modelsDevGet,
  refresh: modelsDevRefresh,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace ModelsDev {
  type Model = z.infer<typeof Model>
  type Provider = z.infer<typeof Provider>
}

if (!Flag.LIBRECODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  modelsDevRefresh()
  setInterval(
    async () => {
      await modelsDevRefresh()
    },
    60 * 1000 * 60,
  ).unref()
}
