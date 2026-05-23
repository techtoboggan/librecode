/**
 * Phase 40 / upstream #20503 — single-flight async coalescer.
 *
 * Returns a function that, when called concurrently, runs `fn` at most
 * once per slot. While the first invocation is in-flight, every
 * subsequent caller awaits the SAME promise. Once it settles (resolve
 * or reject), the slot clears and the next call gets a fresh invocation.
 *
 * Where this matters most: OAuth refresh paths. When a session fires
 * five concurrent LLM requests right as the access token expires,
 * naive code calls `refreshAccessToken` five times. The first call
 * succeeds and rotates the refresh_token; the next four reach the
 * server with the now-revoked old refresh_token and get 4xx'd. The
 * session sees intermittent failures until the user re-runs /connect.
 * Single-flight collapses the five calls into one HTTP request.
 *
 * Usage:
 *   const refresh = createSingleFlight(() => refreshAccessToken(...))
 *   // multiple concurrent calls all await one in-flight refresh
 *   await refresh()
 *
 * Not bound to a specific transport — works for any async function
 * whose semantics are "I want this to happen at most once even if many
 * callers ask for it at the same time."
 */
export function createSingleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | undefined
  return () => {
    if (inflight) return inflight
    inflight = fn().finally(() => {
      inflight = undefined
    })
    return inflight
  }
}
