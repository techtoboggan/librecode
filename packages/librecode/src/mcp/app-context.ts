/**
 * Per-session, per-app context store for the v0.9.47 ui/update-model-context
 * AppBridge handler (ADR-005 §7).
 *
 * Each MCP app may push a single content blob the host injects into the
 * NEXT model turn as a labeled segment. Replace-on-write per the spec —
 * the most recent push wins; we never accumulate.
 *
 * Caps (per the v0.9.47 plan):
 *   * 40,000 chars per app   (~10k tokens at the GPT tokenizer's
 *     ~4 chars/token average)
 *   * 200,000 chars across all apps in the same session (~50k tokens)
 *
 * In-memory only — contexts are not persisted, but they survive a
 * session fork via `forkContexts()` (the user's v0.9.47 decision).
 */
import { SessionID } from "../session/schema"
import { Log } from "../util/log"

const log = Log.create({ service: "mcp.app-context" })

export const PER_APP_CONTEXT_CHAR_CAP = 40_000
export const PER_SESSION_CONTEXT_CHAR_CAP = 200_000

/**
 * A single stored context entry. We keep both the original textual
 * payload and an optional structuredContent JSON blob so the prompt
 * builder can pick the best representation.
 */
export interface AppContextEntry {
  server: string
  uri: string
  content: string
  /** Optional structured payload (per MCP spec) — surfaced in delimited segment when present. */
  structuredContent?: unknown
  updatedAt: number
}

/** Map<`<server>::<uri>`, entry>. */
type SessionContexts = Map<string, AppContextEntry>

const store = new Map<SessionID, SessionContexts>()

const key = (server: string, uri: string) => `${server}::${uri}`

function totalChars(map: SessionContexts): number {
  let n = 0
  for (const entry of map.values()) n += entry.content.length
  return n
}

export type SetContextResult = { ok: true; entry: AppContextEntry } | { ok: false; reason: string }

/**
 * Replace-or-create the context for `(sessionID, server, uri)`.
 * Returns `{ok: false}` with a specific reason on cap breach so
 * callers can surface it as an `isError` to the iframe.
 */
export function setAppContext(input: {
  sessionID: SessionID
  server: string
  uri: string
  content: string
  structuredContent?: unknown
}): SetContextResult {
  if (input.content.length > PER_APP_CONTEXT_CHAR_CAP) {
    return {
      ok: false,
      reason: `Per-app context cap exceeded (${input.content.length} > ${PER_APP_CONTEXT_CHAR_CAP}).`,
    }
  }

  let map = store.get(input.sessionID)
  if (!map) {
    map = new Map()
    store.set(input.sessionID, map)
  }

  // Check the total-cap with the new entry's size accounted for (replacing
  // the existing entry if any, not stacked on top).
  const k = key(input.server, input.uri)
  const previous = map.get(k)
  const previousLen = previous?.content.length ?? 0
  const projectedTotal = totalChars(map) - previousLen + input.content.length
  if (projectedTotal > PER_SESSION_CONTEXT_CHAR_CAP) {
    return {
      ok: false,
      reason: `Total context cap exceeded for this session (${projectedTotal} > ${PER_SESSION_CONTEXT_CHAR_CAP}).`,
    }
  }

  const entry: AppContextEntry = {
    server: input.server,
    uri: input.uri,
    content: input.content,
    structuredContent: input.structuredContent,
    updatedAt: Date.now(),
  }
  map.set(k, entry)
  log.info("set", { sessionID: input.sessionID, server: input.server, uri: input.uri, chars: input.content.length })
  return { ok: true, entry }
}

/** All app contexts currently stored for a session. */
export function getAllAppContexts(sessionID: SessionID): AppContextEntry[] {
  const map = store.get(sessionID)
  if (!map) return []
  return Array.from(map.values())
}

/** Drop a single entry. Used by Settings (v0.9.48) to "Clear" a per-app context. */
export function clearAppContext(sessionID: SessionID, server: string, uri: string): void {
  const map = store.get(sessionID)
  if (!map) return
  map.delete(key(server, uri))
  if (map.size === 0) store.delete(sessionID)
}

/** Drop every entry for a session. Used on Disconnect-all and session deletion. */
export function clearSessionAppContexts(sessionID: SessionID): void {
  store.delete(sessionID)
}

/**
 * Per the v0.9.47 user decision: forking a session copies app contexts
 * forward. The user can clear them explicitly via the Settings pane.
 */
export function forkContexts(fromSessionID: SessionID, toSessionID: SessionID): void {
  const src = store.get(fromSessionID)
  if (!src || src.size === 0) return
  const dst = new Map<string, AppContextEntry>()
  for (const [k, entry] of src.entries()) {
    dst.set(k, { ...entry })
  }
  store.set(toSessionID, dst)
}

/**
 * Pure: shape app-context entries as system-prompt segments using the
 * delimited format from the plan: `<mcp-app server="..." uri="...">...</mcp-app>`.
 *
 * Returns one string per entry — caller appends to the system parts list.
 */
export function appContextSegments(entries: ReadonlyArray<AppContextEntry>): string[] {
  return entries.map((entry) => {
    const meta = `server="${escapeAttr(entry.server)}" uri="${escapeAttr(entry.uri)}"`
    const body = entry.structuredContent !== undefined ? JSON.stringify(entry.structuredContent) : entry.content
    return `<mcp-app ${meta}>\n${body}\n</mcp-app>`
  })
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;")
}

/** Total chars across all stored contexts for a session. Useful for stats. */
export function totalContextChars(sessionID: SessionID): number {
  const map = store.get(sessionID)
  return map ? totalChars(map) : 0
}
