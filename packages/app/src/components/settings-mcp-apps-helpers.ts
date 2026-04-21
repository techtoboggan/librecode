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

/** v0.9.52 — shape of a persisted permission rule from GET /permission/rules. */
export interface PermissionRule {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

/**
 * Filter the global ruleset to the rules that concern a single MCP
 * server. v0.9.52 Settings pane shows these per-server so the user can
 * see at a glance which apps have "Always allow"/"Always deny" rules
 * attached.
 */
export function rulesForServer(rules: ReadonlyArray<PermissionRule>, server: string): PermissionRule[] {
  const prefix = `mcp-app:${server}:`
  return rules.filter((r) => r.permission === prefix.slice(0, -1) || r.permission.startsWith(prefix))
}

/**
 * Pretty-print a rule's tool name — drop the "mcp-app:<server>:"
 * prefix so "mcp-app:acme:get_forecast" renders as just "get_forecast".
 * If the permission doesn't match the MCP-app shape, return it as-is.
 */
export function toolFromPermission(permission: string): string {
  if (!permission.startsWith("mcp-app:")) return permission
  const parts = permission.split(":")
  if (parts.length < 3) return permission
  return parts.slice(2).join(":")
}
