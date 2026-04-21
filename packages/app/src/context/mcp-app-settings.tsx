/**
 * v0.9.48 — Per-MCP-app local settings persisted to localStorage.
 *
 * Currently exposes one knob: per-app override of the
 * `ui/message` char limit (default 8000 from
 * mcp-app-message.ts). Server still enforces its own constant for
 * defense-in-depth; this lets the user lower it for noisier apps
 * without restarting.
 *
 * Stored under a single `mcp-app-settings` key as a flat record
 * keyed by server name. Adding more per-app fields later is
 * additive — the migrate fn drops anything it doesn't recognise.
 */
import { createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@librecode/ui/context"
import { Persist, persisted } from "@/utils/persist"

export interface PerAppSettings {
  /** Override for ui/message text char cap. Undefined → use the global default. */
  messageCharLimit?: number
  /** Hourly USD cap for sampling/createMessage. Undefined → use the v0.9.49 default. */
  samplingHourlyUsdCap?: number
}

export type McpAppSettingsRecord = Record<string, PerAppSettings>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function migrate(value: unknown): McpAppSettingsRecord {
  if (!isRecord(value)) return {}
  const out: McpAppSettingsRecord = {}
  for (const [server, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    const limit = raw.messageCharLimit
    const cap = raw.samplingHourlyUsdCap
    out[server] = {
      messageCharLimit: typeof limit === "number" && limit >= 0 ? limit : undefined,
      samplingHourlyUsdCap: typeof cap === "number" && cap >= 0 ? cap : undefined,
    }
    // Drop entries that ended up with no real overrides.
    if (out[server].messageCharLimit === undefined && out[server].samplingHourlyUsdCap === undefined) {
      delete out[server]
    }
  }
  return out
}

export const { use: useMcpAppSettings, provider: McpAppSettingsProvider } = createSimpleContext({
  name: "McpAppSettings",
  init: () => {
    const target = Persist.global("mcp-app-settings", ["mcp-app-settings.v1"])
    const [store, setStore] = persisted({ ...target, migrate }, createStore<McpAppSettingsRecord>({}))

    const messageCharLimit = (server: string) => createMemo(() => store[server]?.messageCharLimit)
    const samplingHourlyUsdCap = (server: string) => createMemo(() => store[server]?.samplingHourlyUsdCap)

    const setMessageCharLimit = (server: string, limit: number | undefined) => {
      setStore(
        produce((draft) => {
          if (!draft[server]) draft[server] = {}
          if (limit === undefined) delete draft[server]!.messageCharLimit
          else draft[server]!.messageCharLimit = limit
          if (draft[server] && Object.keys(draft[server]!).length === 0) delete draft[server]
        }),
      )
    }

    const setSamplingHourlyUsdCap = (server: string, cap: number | undefined) => {
      setStore(
        produce((draft) => {
          if (!draft[server]) draft[server] = {}
          if (cap === undefined) delete draft[server]!.samplingHourlyUsdCap
          else draft[server]!.samplingHourlyUsdCap = cap
          if (draft[server] && Object.keys(draft[server]!).length === 0) delete draft[server]
        }),
      )
    }

    return {
      record: () => ({ ...store }),
      messageCharLimit,
      messageCharLimitOf: (server: string) => store[server]?.messageCharLimit,
      setMessageCharLimit,
      samplingHourlyUsdCap,
      samplingHourlyUsdCapOf: (server: string) => store[server]?.samplingHourlyUsdCap,
      setSamplingHourlyUsdCap,
    }
  },
})
