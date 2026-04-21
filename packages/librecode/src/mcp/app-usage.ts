/**
 * v0.9.51 — per-(session, server, permission) usage counter for
 * MCP app calls.
 *
 * Subscribes to Permission.Audit.Event.Logged and rolls up
 * `lastUsedAt` + `callsInSession` keyed by (sessionID, server,
 * permission). The `server` is extracted from permission names with
 * the `mcp-app:<server>:<tool>` prefix; entries without that
 * prefix are ignored (they're agent tool calls, not MCP apps).
 *
 * Surfaced via GET /session/:id/mcp-apps/usage — Settings → MCP
 * Apps reads from there to show "Last used 3m ago · 17 calls this
 * session" per server.
 *
 * In-memory, scoped to the Instance — cleared on instance teardown
 * along with the rest of the session state.
 */
import { Bus } from "../bus"
import { Event as AuditEvent } from "../permission/audit"
import { Instance } from "../project/instance"
import { type SessionID } from "../session/schema"
import { Log } from "../util/log"

const log = Log.create({ service: "mcp.app-usage" })

export interface UsageEntry {
  sessionID: string
  server: string
  /** Permission name used in the audit record (e.g. `mcp-app:acme:echo`). */
  permission: string
  /** Tool name — extracted from the permission, or the sentinel for non-tool calls (`_message`, `_sample`). */
  tool: string
  lastUsedAt: number
  callsInSession: number
}

/**
 * Pure: extract server + tool from an MCP-app permission name. Returns
 * undefined when the name doesn't match the mcp-app:<server>:<tool>
 * format so non-app audit entries can be filtered out.
 */
export function parseMcpAppPermission(permission: string): { server: string; tool: string } | undefined {
  if (!permission.startsWith("mcp-app:")) return undefined
  const parts = permission.split(":")
  if (parts.length < 3) return undefined
  const server = parts[1]
  if (!server) return undefined
  const tool = parts.slice(2).join(":")
  if (!tool) return undefined
  return { server, tool }
}

type UsageKey = `${string}|${string}|${string}`
const keyOf = (sessionID: string, server: string, permission: string): UsageKey =>
  `${sessionID}|${server}|${permission}`

interface UsageState {
  entries: Map<UsageKey, UsageEntry>
  unsubs: Array<() => void>
}

function emptyState(): UsageState {
  return { entries: new Map(), unsubs: [] }
}

function recordCall(state: UsageState, entry: { sessionID: string; permission: string; at: number }): void {
  const parsed = parseMcpAppPermission(entry.permission)
  if (!parsed) return
  const key = keyOf(entry.sessionID, parsed.server, entry.permission)
  const existing = state.entries.get(key)
  if (existing) {
    existing.lastUsedAt = Math.max(existing.lastUsedAt, entry.at)
    existing.callsInSession += 1
    return
  }
  state.entries.set(key, {
    sessionID: entry.sessionID,
    server: parsed.server,
    permission: entry.permission,
    tool: parsed.tool,
    lastUsedAt: entry.at,
    callsInSession: 1,
  })
}

const usageState = Instance.state(
  (): UsageState => {
    const state = emptyState()

    state.unsubs = [
      Bus.subscribe(AuditEvent.Logged, (ev) => {
        const e = ev.properties
        // Count exactly one entry per call. A call surfaces in the
        // audit stream as one of:
        //   - `asked` (user prompt shown) + later `replied` (user clicks)
        //   - `auto_approved` (rule matched allow)
        //   - `denied` (rule matched deny)
        // We count on `asked` / `auto_approved` / `denied` and skip
        // `replied` so asked+replied doesn't double-count.
        if (e.type !== "asked" && e.type !== "auto_approved" && e.type !== "denied") return
        recordCall(state, { sessionID: e.sessionID, permission: e.permission, at: e.timestamp })
      }),
    ]

    log.info("mcp app usage tracker started")
    return state
  },
  async (current) => {
    for (const unsub of current.unsubs) unsub()
    current.entries.clear()
    current.unsubs = []
  },
)

async function forSession(sessionID: SessionID): Promise<UsageEntry[]> {
  const state = await usageState()
  const out: UsageEntry[] = []
  for (const entry of state.entries.values()) {
    if (entry.sessionID === sessionID) out.push(entry)
  }
  return out
}

/** Drop all entries for a session. Called on session teardown. */
async function clearSession(sessionID: SessionID): Promise<void> {
  const state = await usageState()
  for (const key of Array.from(state.entries.keys())) {
    if (state.entries.get(key)?.sessionID === sessionID) state.entries.delete(key)
  }
}

export const McpAppUsage = {
  forSession,
  clearSession,
  parseMcpAppPermission,
} as const

// Expose the pure `recordCall` helper to tests that want to exercise
// the aggregation without going through the bus. Not part of the
// public runtime API — hence the `_` prefix.
export const _testing = { recordCall, emptyState } as const
