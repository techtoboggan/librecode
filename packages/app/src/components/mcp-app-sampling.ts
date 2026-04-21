/**
 * v0.9.49 — Per-app cost-cap state machine for the
 * `sampling/createMessage` AppBridge request (ADR-005 §8).
 *
 * The sampling request itself is intentionally NOT YET IMPLEMENTED
 * end-to-end — running an LLM inference on the user's account from
 * an iframe is a high-risk surface (token cost, exfiltration). The
 * v0.9.49 release lands the *policy*: caps, accounting, settings,
 * and a handler that returns a clear "sampling unavailable" error
 * so apps that try get a deterministic response.
 *
 * Cost cap shape: hourly USD cap per (project, server). Default
 * `$0.50/hr`. Override per server via Settings → MCP Apps.
 *
 * The accounting is in-memory rolling window — sufficient for a
 * single-process desktop session. A future release may move it to
 * the audit log if multi-process / restart durability becomes a
 * concern.
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

/**
 * v0.9.49 sampling handler. Currently rejects all requests with a
 * "not yet implemented" isError so apps get a deterministic
 * response instead of an unhandled JSON-RPC fault.
 *
 * The cap-check + ledger plumbing is in place so the eventual
 * sampling-enable PR can flip a single flag here.
 */
export function createSamplingHandler(_options: {
  fetchFn: FetchLike
  baseUrl: string
  sessionID: string | undefined
  server: string
  uri: string
}) {
  return async (_params: unknown) => {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            "sampling/createMessage is not yet enabled in this release. The policy " +
            "framework (per-app cost cap + permission gate) is in place; the LLM " +
            "inference path lands in a follow-up.",
        },
      ],
    }
  }
}
