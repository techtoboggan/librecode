/**
 * v0.9.63 — postMessage bridge between MCP App iframes and the host's
 * `/mcp/apps/state` endpoint so apps can persist per-(server, uri) JSON
 * state across LibreCode restarts.
 *
 * Protocol (iframe → host):
 *   postMessage({ type: "mcp-app-state:load", requestID })
 *   postMessage({ type: "mcp-app-state:save", requestID, state })
 *
 * Host → iframe reply on the same `requestID`:
 *   { type: "mcp-app-state:loaded", requestID, state }
 *   { type: "mcp-app-state:saved",  requestID, ok, error? }
 *
 * A missing `requestID` is tolerated — the iframe just doesn't know
 * which save/load completed. We still drive the round-trip so built-in
 * apps that save fire-and-forget can stay simple.
 */

import type { FetchLike } from "./fetch"

export function createStateRelay(options: {
  server: string
  uri: string
  fetchFn: FetchLike
  baseUrl: string
  contentWindow: Window | null
}): (e: { data?: unknown; source?: unknown }) => void {
  const post = (message: Record<string, unknown>) => {
    try {
      options.contentWindow?.postMessage(message, "*")
    } catch {
      // iframe detached
    }
  }
  return async (e) => {
    if (e.source !== options.contentWindow) return
    const data = e.data as { type?: string; requestID?: string; state?: unknown } | undefined
    if (!data || typeof data.type !== "string") return
    const requestID = typeof data.requestID === "string" ? data.requestID : undefined

    if (data.type === "mcp-app-state:load") {
      const url = new URL(`${options.baseUrl}/mcp/apps/state`)
      url.searchParams.set("server", options.server)
      url.searchParams.set("uri", options.uri)
      try {
        const res = await options.fetchFn(url.toString())
        if (!res.ok) {
          post({ type: "mcp-app-state:loaded", requestID, state: null })
          return
        }
        const body = (await res.json()) as { state: unknown }
        post({ type: "mcp-app-state:loaded", requestID, state: body.state ?? null })
      } catch {
        post({ type: "mcp-app-state:loaded", requestID, state: null })
      }
      return
    }

    if (data.type === "mcp-app-state:save") {
      const url = new URL(`${options.baseUrl}/mcp/apps/state`)
      url.searchParams.set("server", options.server)
      url.searchParams.set("uri", options.uri)
      try {
        const res = await options.fetchFn(url.toString(), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state: data.state ?? null }),
        })
        if (!res.ok) {
          const reason = await res.text().catch(() => `HTTP ${res.status}`)
          post({ type: "mcp-app-state:saved", requestID, ok: false, error: reason })
          return
        }
        post({ type: "mcp-app-state:saved", requestID, ok: true })
      } catch (err) {
        post({ type: "mcp-app-state:saved", requestID, ok: false, error: String(err) })
      }
    }
  }
}
