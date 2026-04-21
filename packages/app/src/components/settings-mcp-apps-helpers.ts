/**
 * Pure helpers for the Settings → MCP Apps pane. Lives in its own
 * file so the test suite can import them without dragging in the
 * Solid / Kobalte / router stack that settings-mcp-apps.tsx pulls.
 */
import type { McpAppResource } from "@/components/mcp-app-panel"

/** Group apps by server name for display. */
export function groupByServer(apps: McpAppResource[]): Map<string, McpAppResource[]> {
  const out = new Map<string, McpAppResource[]>()
  for (const app of apps) {
    const list = out.get(app.server) ?? []
    list.push(app)
    out.set(app.server, list)
  }
  return out
}

/** v0.9.51 — shape of an entry returned by GET /session/:id/mcp-apps/usage. */
export interface UsageEntry {
  sessionID: string
  server: string
  permission: string
  tool: string
  lastUsedAt: number
  callsInSession: number
}

/** Pure: format a lastUsedAt ms timestamp as a relative "3m ago" string. */
export function formatLastUsed(lastUsedAt: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - lastUsedAt)
  if (delta < 10_000) return "just now"
  const sec = Math.floor(delta / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

/** Pure: sum call counts across a list of usage entries. */
export function totalCalls(entries: ReadonlyArray<UsageEntry>): number {
  return entries.reduce((sum, e) => sum + e.callsInSession, 0)
}

/** Pure: find the most-recent lastUsedAt across a list, or undefined if empty. */
export function latestLastUsed(entries: ReadonlyArray<UsageEntry>): number | undefined {
  if (entries.length === 0) return undefined
  let max = entries[0].lastUsedAt
  for (const e of entries) if (e.lastUsedAt > max) max = e.lastUsedAt
  return max
}
