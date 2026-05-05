/**
 * AppBridge handler factories — pure builders for the `bridge.on*`
 * callbacks that proxy iframe-originated requests to the host's MCP
 * routes. Pulled out so unit tests don't have to mount Solid + Kobalte.
 *
 * Every handler MUST resolve (never reject) so the AppBridge stays
 * alive on transport failure. The contract is the in-band MCP shape
 * `{isError: true, content: [...]}`.
 */

import type { FetchLike } from "./fetch"

// ─── Open-link ───────────────────────────────────────────────────────────────

/**
 * Allowlist for `ui/open-link` requests. Apps may only ask the host to
 * open standard web URLs — `javascript:`, `data:`, `file:`, `blob:` and
 * any scheme not in this set are silently rejected. ADR-005 §5.
 */
export const OPEN_LINK_ALLOWED_SCHEMES = new Set(["http:", "https:"])

/** Pure: validate that a string is a safe link target. */
export function isSafeOpenUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return OPEN_LINK_ALLOWED_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Build the `bridge.onopenlink` handler. Returns a permissive `{}` on
 * success and `{isError: true}` on a rejected scheme — the iframe sees a
 * standard MCP UI result either way and stays alive.
 */
export function createOpenLinkHandler(open: (url: string) => void) {
  return async (params: { url: string }) => {
    if (!isSafeOpenUrl(params.url)) return { isError: true }
    try {
      open(params.url)
      return {}
    } catch {
      return { isError: true }
    }
  }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"

/**
 * Build the `bridge.onloggingmessage` handler. Routes app-emitted
 * notifications/message frames to the browser console with the matching
 * severity. We tag them with [mcp-app: <server>] so they're easy to find.
 */
export function createLogHandler(options: {
  server: string
  console?: Pick<Console, "log" | "info" | "warn" | "error">
}) {
  const target = options.console ?? console
  return (params: { level: LogLevel; logger?: string; data: unknown }) => {
    const tag = `[mcp-app:${options.server}${params.logger ? "/" + params.logger : ""}]`
    switch (params.level) {
      case "debug":
      case "info":
      case "notice":
        target.info(tag, params.data)
        return
      case "warning":
        target.warn(tag, params.data)
        return
      case "error":
      case "critical":
      case "alert":
      case "emergency":
        target.error(tag, params.data)
        return
      default:
        target.log(tag, params.data)
    }
  }
}

// ─── Read-only proxies (resources/list, resources/read, prompts) ─────────────

/**
 * Generic POST → in-band-isError JSON proxy used by every MCP-app
 * AppBridge handler. Centralises the HTTP-error / network-error /
 * missing-session shapes so the per-handler factories stay tiny.
 */
async function proxyJson(options: {
  fetchFn: FetchLike
  url: string
  body?: unknown
  method?: "GET" | "POST"
}): Promise<{ content: unknown[]; isError?: boolean } | Record<string, unknown>> {
  try {
    const init: RequestInit = { method: options.method ?? "POST" }
    if (options.body !== undefined) {
      init.headers = { "Content-Type": "application/json" }
      init.body = JSON.stringify(options.body)
    }
    const res = await options.fetchFn(options.url, init)
    if (!res.ok) {
      return { isError: true, content: [{ type: "text" as const, text: `Host rejected request: HTTP ${res.status}` }] }
    }
    return (await res.json()) as Record<string, unknown>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { isError: true, content: [{ type: "text" as const, text: `Transport error: ${message}` }] }
  }
}

interface ProxyOpts {
  fetchFn: FetchLike
  baseUrl: string
  sessionID: string | undefined
  server: string
}

/**
 * Build the AppBridge `onlistresources` handler. Proxies to
 * GET /session/:id/mcp-apps/resources?server=…
 */
export function createListResourcesHandler(options: ProxyOpts) {
  return async () => {
    if (!options.sessionID) {
      return { isError: true, content: [{ type: "text" as const, text: "No active session." }] }
    }
    const url = new URL(`${options.baseUrl}/session/${options.sessionID}/mcp-apps/resources`)
    url.searchParams.set("server", options.server)
    return proxyJson({ fetchFn: options.fetchFn, url: url.toString(), method: "GET" })
  }
}

/** Build the AppBridge `onreadresource` handler — POSTs {server, uri} to the read route. */
export function createReadResourceHandler(options: ProxyOpts) {
  return async (params: { uri: string }) => {
    if (!options.sessionID) {
      return { isError: true, content: [{ type: "text" as const, text: "No active session." }] }
    }
    return proxyJson({
      fetchFn: options.fetchFn,
      url: `${options.baseUrl}/session/${options.sessionID}/mcp-apps/resources/read`,
      body: { server: options.server, uri: params.uri },
    })
  }
}

/** Build the AppBridge `onlistresourcetemplates` handler. */
export function createListResourceTemplatesHandler(options: ProxyOpts) {
  return async () => {
    if (!options.sessionID) {
      return { isError: true, content: [{ type: "text" as const, text: "No active session." }] }
    }
    const url = new URL(`${options.baseUrl}/session/${options.sessionID}/mcp-apps/resource-templates`)
    url.searchParams.set("server", options.server)
    return proxyJson({ fetchFn: options.fetchFn, url: url.toString(), method: "GET" })
  }
}

/** Build the AppBridge `onlistprompts` handler. */
export function createListPromptsHandler(options: ProxyOpts) {
  return async () => {
    if (!options.sessionID) {
      return { isError: true, content: [{ type: "text" as const, text: "No active session." }] }
    }
    const url = new URL(`${options.baseUrl}/session/${options.sessionID}/mcp-apps/prompts`)
    url.searchParams.set("server", options.server)
    return proxyJson({ fetchFn: options.fetchFn, url: url.toString(), method: "GET" })
  }
}

// ─── Tool call proxy ─────────────────────────────────────────────────────────

/**
 * Build an `oncalltool` handler that proxies an iframe-originated tool
 * call to the host's `/session/:id/mcp-apps/tool` endpoint.
 *
 * The handler maps any HTTP / network failure into the standard MCP
 * `CallToolResult` `{isError: true, content: [...]}` shape so the iframe
 * always gets a valid response — never a JSON-RPC fault that would tear
 * down the bridge.
 */
export function createCallToolHandler(options: ProxyOpts & { uri: string }) {
  return async (params: { name: string; arguments?: Record<string, unknown> }) => {
    if (!options.sessionID) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "MCP app cannot call tools — no active session." }],
      }
    }
    try {
      const url = new URL(`${options.baseUrl}/session/${options.sessionID}/mcp-apps/tool`)
      const res = await options.fetchFn(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server: options.server,
          uri: options.uri,
          name: params.name,
          arguments: params.arguments ?? {},
        }),
      })
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Host rejected tool call: HTTP ${res.status}` }],
        }
      }
      return (await res.json()) as { content: unknown[]; isError?: boolean }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: "text" as const, text: `Tool call transport error: ${message}` }] }
    }
  }
}

// ─── In-flight counter wrapper ───────────────────────────────────────────────

/**
 * Wrap an AppBridge handler so each call increments + decrements an
 * in-flight counter. The panel uses the counter to surface a "running"
 * dot on its header. We use `unknown` for the param to fit every
 * `bridge.on*` shape without per-handler generics — every one takes a
 * single object argument and returns a promise.
 */
export function withRunning<F extends (param: never) => Promise<unknown>>(fn: F, inc: () => void, dec: () => void): F {
  return (async (param: never) => {
    inc()
    try {
      return await fn(param)
    } finally {
      dec()
    }
  }) as F
}
