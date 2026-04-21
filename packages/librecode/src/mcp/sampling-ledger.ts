/**
 * v0.9.53 — server-side rolling-window cost ledger for
 * `sampling/createMessage`.
 *
 * Supersedes the in-memory client ledger (in
 * `packages/app/src/components/mcp-app-sampling.ts`) for enforcement.
 * The client still keeps a local copy purely for UI display
 * ("$0.12 remaining this hour"); authoritative accounting lives here
 * so it can't be bypassed by an app reloading the iframe.
 *
 * Scoped to the Instance — the ledger clears when the project is
 * disposed. That's fine: a cap breach that requires hours of
 * cooldown is already very unusual, and the LLM-call history is
 * reconstructable from the audit log if we ever need persistence.
 */
import { Instance } from "../project/instance"

/** Default hourly cap when the client doesn't pass one. Mirrors the client constant. */
export const DEFAULT_SAMPLING_HOURLY_USD_CAP = 0.5

/** Window length (ms) used for cap accounting — one hour. */
export const SAMPLING_CAP_WINDOW_MS = 60 * 60 * 1000

interface LedgerEntry {
  at: number
  costUsd: number
}

interface LedgerState {
  byServer: Map<string, LedgerEntry[]>
}

const ledgerState = Instance.state<LedgerState>(() => ({ byServer: new Map() }))

function prune(entries: LedgerEntry[], now: number): LedgerEntry[] {
  const cutoff = now - SAMPLING_CAP_WINDOW_MS
  while (entries.length > 0 && entries[0].at < cutoff) entries.shift()
  return entries
}

/** Sum of recorded costs for `server` within the window. */
export function totalSamplingCostUsd(server: string, now: number = Date.now()): number {
  const entries = ledgerState().byServer.get(server)
  if (!entries) return 0
  prune(entries, now)
  return entries.reduce((sum, e) => sum + e.costUsd, 0)
}

/** Record a settled cost against the window. */
export function recordSamplingCost(server: string, costUsd: number, now: number = Date.now()): void {
  const s = ledgerState()
  const entries = s.byServer.get(server) ?? []
  entries.push({ at: now, costUsd })
  prune(entries, now)
  s.byServer.set(server, entries)
}

export type CapCheckResult =
  | { ok: true; remainingUsd: number }
  | { ok: false; reason: string; remainingUsd: number }

/**
 * Would charging `proposedCostUsd` to `server` breach `capUsd`? The
 * caller typically passes a pre-call upper-bound estimate so we can
 * reject before spending any tokens.
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
      reason:
        `Sampling cap exceeded for ${input.server}: $${input.proposedCostUsd.toFixed(4)} ` +
        `> $${remaining.toFixed(4)} remaining (cap $${input.capUsd.toFixed(2)}/hr).`,
      remainingUsd: remaining,
    }
  }
  return { ok: true, remainingUsd: remaining - input.proposedCostUsd }
}

/** Reset the ledger for one server (called on Disconnect). */
export function clearSamplingLedger(server: string): void {
  ledgerState().byServer.delete(server)
}

/** Reset everything — used by tests. */
export function resetAllSamplingLedgers(): void {
  ledgerState().byServer.clear()
}
