/**
 * v0.9.49 + v0.9.53 — Per-app cost-cap state machine + LLM
 * inference bridge for `sampling/createMessage` (ADR-005 §8).
 *
 * v0.9.49 shipped the policy scaffold (caps, accounting, settings,
 * "not yet enabled" error). v0.9.53 wires the actual inference:
 * when an app fires `sampling/createMessage`, the host posts to
 * `/session/:id/mcp-apps/sample` which runs the permission gate,
 * checks the hourly USD cap, executes the LLM call on the user's
 * account, and records the settled cost server-side. The client
 * keeps a mirror ledger here purely for UI display — the server's
 * ledger is authoritative.
 *
 * Cap shape: hourly USD cap per (project, server). Default
 * `$0.50/hr`. Override per server via Settings → MCP Apps.
 */

/** Default cost cap per (project, server) per hour, in USD. */
export const DEFAULT_SAMPLING_HOURLY_USD_CAP = 0.5

/** Window length (ms) used for cap accounting. */
export const SAMPLING_CAP_WINDOW_MS = 60 * 60 * 1000

interface UsageEntry {
  at: number
  costUsd: number
}

const ledger = new Map<string, UsageEntry[]>()

const ledgerKey = (server: string) => server

/** Pure: prune entries older than the window. Mutates the array, returns it. */
function prune(entries: UsageEntry[], now: number): UsageEntry[] {
  const cutoff = now - SAMPLING_CAP_WINDOW_MS
  while (entries.length > 0 && entries[0].at < cutoff) entries.shift()
  return entries
}

/** Get the current rolling-window total for a server. */
export function totalSamplingCostUsd(server: string, now: number = Date.now()): number {
  const entries = ledger.get(ledgerKey(server))
  if (!entries) return 0
  prune(entries, now)
  return entries.reduce((sum, e) => sum + e.costUsd, 0)
}

/** Record a successful sampling call against the rolling window. */
export function recordSamplingCost(server: string, costUsd: number, now: number = Date.now()): void {
  const key = ledgerKey(server)
  const entries = ledger.get(key) ?? []
  entries.push({ at: now, costUsd })
  prune(entries, now)
  ledger.set(key, entries)
}

/** Reset the ledger for a server (called on Disconnect). */
export function clearSamplingLedger(server: string): void {
  ledger.delete(ledgerKey(server))
}

/** Reset the entire ledger (used by tests). */
export function resetAllSamplingLedgers(): void {
  ledger.clear()
}

export type CapCheckResult = { ok: true; remainingUsd: number } | { ok: false; reason: string; remainingUsd: number }

/**
 * Pure: would charging `proposedCostUsd` against `server`'s window
 * breach `capUsd`? Returns the result + the headroom either way so
 * the prompt UI can show "$0.42 remaining this hour".
 */
export function checkSamplingCap(input: {
  server: string
  capUsd: number
  proposedCostUsd: number
  now?: number
}): CapCheckResult {
  const now = input.now ?? Date.now()
  const used = totalSamplingCostUsd(input.server, now)
  const remaining = Math.max(0, input.capUsd - used)
  if (input.proposedCostUsd > remaining) {
    return {
      ok: false,
      reason: `Sampling cap exceeded for ${input.server}: $${input.proposedCostUsd.toFixed(4)} > $${remaining.toFixed(4)} remaining (cap $${input.capUsd.toFixed(2)}/hr).`,
      remainingUsd: remaining,
    }
  }
  return { ok: true, remainingUsd: remaining - input.proposedCostUsd }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface SamplingTextContent {
  type: "text"
  text: string
}
interface SamplingRequestParams {
  messages: Array<{ role: "user" | "assistant"; content: SamplingTextContent | SamplingTextContent[] }>
  maxTokens: number
  systemPrompt?: string
  temperature?: number
  stopSequences?: string[]
}

interface SamplingServerSuccess {
  model: string
  role: "assistant"
  content: SamplingTextContent
  stopReason?: string
  _meta?: { costUsd?: number; remainingUsd?: number; windowUsdTotal?: number; capUsd?: number }
}
interface SamplingServerError {
  isError: true
  error: string
  _meta?: { reason?: string; remainingUsd?: number; capUsd?: number }
}

/**
 * v0.9.53 sampling handler. Posts to the server route which runs the
 * permission gate, cap check, and LLM inference. The return shape
 * matches the MCP CreateMessageResult spec (`{model, role, content,
 * stopReason}`); server-side telemetry lands in `_meta`.
 *
 * Failure modes:
 *   - missing session → "sampling unavailable (no session)". Apps can
 *     only sample when the Settings pane was opened from inside a
 *     session, same as `ui/message`.
 *   - cap breach / permission denial → in-band `{isError:true}` with
 *     a `content: [{text: "..."}]` array so the bridge doesn't crash.
 *   - network / transport failure → same shape with a generic message.
 */
export function createSamplingHandler(options: {
  fetchFn: FetchLike
  baseUrl: string
  sessionID: string | undefined
  server: string
  uri: string
  /** User's configured hourly USD cap from Settings. Server falls back to default when undefined. */
  capUsd?: number
}) {
  return async (params: SamplingRequestParams) => {
    if (!options.sessionID) {
      return samplingIsError("sampling/createMessage requires an active session — open from a session to enable.")
    }
    try {
      const res = await options.fetchFn(`${options.baseUrl}/session/${options.sessionID}/mcp-apps/sample`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          server: options.server,
          uri: options.uri,
          systemPrompt: params.systemPrompt,
          messages: params.messages,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          stopSequences: params.stopSequences,
          capUsd: options.capUsd,
        }),
      })
      if (!res.ok) {
        return samplingIsError(`sampling call failed with HTTP ${res.status}`)
      }
      const body = (await res.json()) as SamplingServerSuccess | SamplingServerError
      if ("isError" in body && body.isError) {
        return samplingIsError(body.error)
      }
      const ok = body as SamplingServerSuccess
      // Mirror the settled cost in the client ledger so
      // `totalSamplingCostUsd(server)` returns something sensible when
      // a future UI shows remaining headroom in real time.
      if (ok._meta?.costUsd) recordSamplingCost(options.server, ok._meta.costUsd)
      return {
        model: ok.model,
        role: ok.role,
        content: ok.content,
        stopReason: ok.stopReason,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return samplingIsError(`sampling network failure: ${message}`)
    }
  }
}

function samplingIsError(text: string): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return { isError: true, content: [{ type: "text", text }] }
}
