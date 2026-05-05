/**
 * REST helpers used by the MCP App panel + tab to fetch HTML, the app
 * list, and the per-session seed payloads (activity + stats).
 *
 * Pure: every helper takes its `fetchFn` explicitly so tests can drive
 * them with a mock without standing up the SDK context.
 */

import type { McpAppResource } from "./types"

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export async function fetchAppHtml(
  fetchFn: FetchLike,
  baseUrl: string,
  directory: string,
  server: string,
  uri: string,
): Promise<string> {
  const url = new URL(`${baseUrl}/mcp/apps/html`)
  url.searchParams.set("server", server)
  url.searchParams.set("uri", uri)
  url.searchParams.set("directory", directory)
  const res = await fetchFn(url.toString())
  if (!res.ok) throw new Error(`Failed to fetch MCP App HTML: ${res.status} ${res.statusText}`)
  return res.text()
}

export async function fetchAppList(fetchFn: FetchLike, baseUrl: string, directory: string): Promise<McpAppResource[]> {
  const url = new URL(`${baseUrl}/mcp/apps`)
  url.searchParams.set("directory", directory)
  const res = await fetchFn(url.toString())
  if (!res.ok) throw new Error(`Failed to fetch MCP App list: ${res.status}`)
  return res.json() as Promise<McpAppResource[]>
}

/**
 * Fetch a session's current activity state. Used to seed the Activity Graph
 * iframe on mount so it shows existing data immediately instead of
 * "Waiting for activity…" until the next SSE tick.
 */
export async function fetchSessionActivity(
  fetchFn: FetchLike,
  baseUrl: string,
  directory: string,
  sessionID: string,
): Promise<{ files: Record<string, unknown>; agents: Record<string, unknown> } | undefined> {
  try {
    const url = new URL(`${baseUrl}/session/${sessionID}/activity`)
    url.searchParams.set("directory", directory)
    const res = await fetchFn(url.toString())
    if (!res.ok) return undefined
    return (await res.json()) as { files: Record<string, unknown>; agents: Record<string, unknown> }
  } catch {
    return undefined
  }
}

/**
 * v0.9.68 — fetch a session-stats seed payload directly from the host.
 *
 * Previously we built the seed client-side from `sync.data.message` /
 * `sync.data.part`, which failed on reload of a long-running session
 * because those stores hydrate asynchronously via SSE and there was
 * no deterministic point at which "everything's loaded" held. The
 * server already has the full history in SQLite; having it shape the
 * payload directly makes the iframe's initial state independent of
 * client-side timing. Mirrors the approach the Activity Graph has
 * used since it shipped.
 */
export async function fetchSessionStatsSeed(
  fetchFn: FetchLike,
  baseUrl: string,
  directory: string,
  sessionID: string,
): Promise<{ type: "session.stats"; messages: unknown[] } | undefined> {
  try {
    const url = new URL(`${baseUrl}/session/${sessionID}/stats-seed`)
    url.searchParams.set("directory", directory)
    const res = await fetchFn(url.toString())
    if (!res.ok) return undefined
    return (await res.json()) as { type: "session.stats"; messages: unknown[] }
  } catch {
    return undefined
  }
}
