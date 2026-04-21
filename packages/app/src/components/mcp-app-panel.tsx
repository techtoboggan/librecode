/**
 * McpAppPanel — sandboxed iframe host for MCP App UI resources.
 *
 * Architecture:
 * - Fetches the app HTML from the backend via `GET /mcp/apps/html`
 * - Injects a CSP `<meta>` tag before rendering (required for WebkitGTK, which
 *   cannot intercept iframe response headers)
 * - Renders the HTML in a sandboxed `<iframe srcdoc>` with `allow-scripts` only
 *   (null origin — app cannot access host storage or cookies)
 * - Wires up `AppBridge` + `PostMessageTransport` for bidirectional JSON-RPC 2.0
 *   communication between the app and the host (tool call proxying, theme tokens,
 *   host context)
 * - Verifies postMessage by `event.source` rather than `event.origin` (which is
 *   always `"null"` for srcdoc/blob iframes)
 *
 * Usage:
 *   <McpAppPanel server="my-server" uri="ui://my-server/app" />
 */

import { type Accessor, createEffect, createResource, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

// ─── CSP helpers ─────────────────────────────────────────────────────────────

/**
 * Default Content Security Policy injected into MCP App iframes.
 *
 * - `script-src 'unsafe-inline' 'unsafe-eval'` — most MCP apps are bundled
 *   single-file SPAs with no nonces; unsafe-eval required for some bundlers
 * - `connect-src 'none'` — apps communicate exclusively through the AppBridge
 *   postMessage channel, not direct HTTP (security boundary)
 * - `frame-src 'none'` — no nested iframes
 */
const DEFAULT_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data: blob:; " +
  "font-src data: blob:; " +
  "connect-src 'none'; " +
  "frame-src 'none';"

function injectCsp(html: string, csp: string): string {
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}">`
  // Insert after <head> if present, otherwise prepend a <head> block
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/(<head(\s[^>]*)?>)/i, `$1\n${metaTag}`)
  }
  return `<head>\n${metaTag}\n</head>\n${html}`
}

// ─── Theme sync ──────────────────────────────────────────────────────────────

/**
 * Theme tokens forwarded into MCP App iframes as CSS custom properties on
 * `:root`. Built-in apps (and cooperating MCP apps) can style themselves via
 * `var(--lc-bg)`, `var(--lc-text)`, etc. Without this, apps look like they
 * don't belong to the host — hardcoded dark colors that clash with light
 * mode, wrong borders, etc.
 *
 * Kept small on purpose: the app owns its own layout; the host just gives
 * it the palette.
 */
const THEME_TOKENS = [
  ["--lc-bg", "--background-base"],
  ["--lc-bg-subtle", "--background-subtle"],
  ["--lc-bg-raised", "--surface-raised-base"],
  ["--lc-bg-panel", "--surface-panel"],
  ["--lc-text", "--text-base"],
  ["--lc-text-strong", "--text-strong"],
  ["--lc-text-weak", "--text-weak"],
  ["--lc-text-weaker", "--text-weaker"],
  ["--lc-border", "--border-weak-base"],
  ["--lc-border-weaker", "--border-weaker-base"],
  ["--lc-accent", "--text-accent"],
  ["--lc-danger", "--text-danger"],
] as const

function readThemeTokens(): Record<string, string> {
  if (typeof document === "undefined") return {}
  const style = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const [appVar, hostVar] of THEME_TOKENS) {
    const value = style.getPropertyValue(hostVar).trim()
    if (value) out[appVar] = value
  }
  return out
}

export function buildThemeCss(tokens: Record<string, string>): string {
  const vars = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")
  // Inject defaults so the iframe inherits the host look even if the app's
  // own stylesheet doesn't reference the vars explicitly. body fallbacks to
  // --lc-bg / --lc-text; html is transparent so the host container shows
  // through during the CSP-enforced srcdoc load.
  return `<style>
:root {
${vars}
}
html, body {
  background: var(--lc-bg, transparent);
  color: var(--lc-text, inherit);
  color-scheme: light dark;
}
</style>`
}

export function injectTheme(html: string, tokens: Record<string, string>): string {
  const styleTag = buildThemeCss(tokens)
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/(<head(\s[^>]*)?>)/i, `$1\n${styleTag}`)
  }
  return `<head>\n${styleTag}\n</head>\n${html}`
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function fetchAppHtml(
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

// ─── Initial snapshot forwarding ──────────────────────────────────────────────

/** Built-in URI → seed responsibility map. Exported for test coverage. */
export const BUILTIN_URI_ACTIVITY_GRAPH = "ui://builtin/activity-graph"
export const BUILTIN_URI_SESSION_STATS = "ui://builtin/session-stats"

export const SEEDABLE_BUILTIN_URIS = new Set<string>([BUILTIN_URI_ACTIVITY_GRAPH, BUILTIN_URI_SESSION_STATS])

/**
 * Fetch a session's current activity state. Used to seed the Activity Graph
 * iframe on mount so it shows existing data immediately instead of
 * "Waiting for activity…" until the next SSE tick.
 */
async function fetchSessionActivity(
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

/** Pure: shape the `activity.updated` seed payload for an iframe. */
export function buildActivitySeedPayload(
  sessionID: string,
  activity: { files: Record<string, unknown>; agents: Record<string, unknown> },
  now: number = Date.now(),
) {
  return {
    type: "activity.updated" as const,
    properties: {
      sessionID,
      files: activity.files,
      agents: activity.agents,
      updatedAt: now,
    },
  }
}

type SeedMessage = { role: string; cost: number; tokens: unknown; parts: unknown[] }

/**
 * Pure: shape the `session.stats` seed payload. Accepts raw message + part
 * lookups so tests don't need to stand up a whole sync context.
 */
export function buildStatsSeedPayload(
  messages: ReadonlyArray<{ id: string; role: string; cost?: number; tokens?: unknown }>,
  getParts: (messageID: string) => unknown[] | undefined,
): { type: "session.stats"; messages: SeedMessage[] } {
  return {
    type: "session.stats",
    messages: messages.map((m) => ({
      role: m.role,
      cost: m.cost ?? 0,
      tokens: m.tokens ?? {},
      parts: getParts(m.id) ?? [],
    })),
  }
}

/**
 * Build the `mcp-app-ready` listener used to seed a freshly-mounted app
 * iframe with a one-time snapshot. Extracted so the source-verification,
 * fire-once, and built-in-URI dispatch logic can be exercised without
 * standing up a real iframe or a Solid root.
 */
export function createReadyHandler(options: {
  /** URI of the app being hosted — used to pick which seed to run. */
  uri: string
  /** Current session id; without one, no seeding happens. */
  sessionID: string | undefined
  /** The iframe's contentWindow — events with a different `source` are ignored. */
  contentWindow: unknown
  /** Run the activity-graph seed (async fetch + post). */
  seedActivity: (sessionID: string) => Promise<void>
  /** Run the session-stats seed (synchronous). */
  seedStats: (sessionID: string) => void
}) {
  let seeded = false
  return (e: { data?: unknown; source?: unknown }) => {
    if (e.source !== options.contentWindow) return
    const data = e.data as { type?: string } | undefined
    if (!data || data.type !== "mcp-app-ready") return
    if (seeded) return
    seeded = true
    const sessionID = options.sessionID
    if (!sessionID) return
    if (options.uri === BUILTIN_URI_ACTIVITY_GRAPH) void options.seedActivity(sessionID)
    else if (options.uri === BUILTIN_URI_SESSION_STATS) options.seedStats(sessionID)
  }
}

// ─── SSE event forwarding ─────────────────────────────────────────────────────

/**
 * Event types forwarded from the host SSE stream into the iframe via postMessage.
 *   - activity.updated        (for the FS Activity Graph)
 *   - message.part.updated    (for Session Stats token/cost tracking)
 *   - message.part.delta      (for streaming indicators)
 *   - session.status          (for busy/idle signals)
 */
export const FORWARDED_EVENT_TYPES = new Set([
  "activity.updated",
  "message.part.updated",
  "message.part.delta",
  "session.status",
])

/** Pure predicate — is this event eligible to be forwarded into an MCP app iframe? */
export function shouldForwardEvent(event: unknown): boolean {
  if (!event || typeof event !== "object" || !("type" in event)) return false
  return FORWARDED_EVENT_TYPES.has((event as { type: unknown }).type as string)
}

type PostTarget = { postMessage: (message: unknown, targetOrigin: string) => void } | null | undefined

/**
 * Wire a global-event listener to a postMessage target. Returns an unsubscribe.
 * Extracted from the hook so the forwarding logic is unit-testable without
 * Solid reactivity or a full iframe.
 */
export function createEventForwarder(
  listen: (cb: (e: { name: string; details: unknown }) => void) => () => void,
  getTarget: () => PostTarget,
): () => void {
  return listen((e) => {
    const event = e.details
    if (!shouldForwardEvent(event)) return
    try {
      getTarget()?.postMessage(event, "*")
    } catch {
      // iframe may be detached during re-render
    }
  })
}

function useEventForwarding(iframeRef: Accessor<HTMLIFrameElement | undefined>) {
  const globalSDK = useGlobalSDK()

  createEffect(() => {
    const iframe = iframeRef()
    if (!iframe) return
    const unsub = createEventForwarder(
      (cb) => globalSDK.event.listen(cb),
      () => iframe.contentWindow,
    )
    onCleanup(unsub)
  })
}

// ─── AppBridge lifecycle ──────────────────────────────────────────────────────

function useAppBridge(iframeRef: Accessor<HTMLIFrameElement | undefined>) {
  createEffect(() => {
    const iframe = iframeRef()
    if (!iframe?.contentWindow) return

    const transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow)

    const bridge = new AppBridge(
      null, // no MCP client proxying at this layer — tools are called via the tool registry
      { name: "librecode", version: "0" },
      {}, // host capabilities: bare minimum
      {}, // no initial host context — theme sync is a follow-up
    )

    // Connect once the iframe's srcdoc has loaded
    const handleLoad = () => {
      bridge.connect(transport).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes("already connected")) return
        console.error("[McpAppPanel] AppBridge connect failed:", err)
      })
    }

    iframe.addEventListener("load", handleLoad)

    onCleanup(() => {
      iframe.removeEventListener("load", handleLoad)
      bridge.close().catch(() => {})
    })
  })
}

// ─── McpAppPanel component ────────────────────────────────────────────────────

export interface McpAppPanelProps {
  /** MCP server name (used to route the HTML fetch). */
  server: string
  /** UI resource URI (`ui://...`). */
  uri: string
  /**
   * Current session id. When set, the host forwards an initial snapshot
   * (activity state, message history) to the iframe once it signals ready —
   * so built-in apps show existing data instead of an empty placeholder.
   */
  sessionID?: string
  /** Optional explicit class for the wrapper. */
  class?: string
}

export function McpAppPanel(props: McpAppPanelProps): JSX.Element {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const sync = useSync()
  let iframeRef: HTMLIFrameElement | undefined
  const [iframeSignal, setIframeSignal] = createSignal<HTMLIFrameElement | undefined>(undefined)

  const [html] = createResource(
    () => ({ server: props.server, uri: props.uri }),
    ({ server, uri }) => fetchAppHtml(globalSDK.fetch, sdk.url, sdk.directory, server, uri),
  )

  const srcdoc = () => {
    const raw = html()
    if (!raw) return undefined
    const withCsp = injectCsp(raw, DEFAULT_CSP)
    return injectTheme(withCsp, readThemeTokens())
  }

  // Wire up AppBridge once we have the iframe ref
  useAppBridge(iframeSignal)
  // Forward SSE events to the iframe so built-in apps receive live data
  useEventForwarding(iframeSignal)

  // Seed the iframe with a snapshot the first time it tells us it's ready.
  // The built-in apps only listen for incremental events, so on a fresh mount
  // they would sit on an empty placeholder until a tool call happens. We
  // listen for `{type: "mcp-app-ready"}` from the iframe and reply with the
  // current activity / stats state.
  createEffect(() => {
    const iframe = iframeSignal()
    if (!iframe) return

    const post = (message: unknown) => {
      try {
        iframe.contentWindow?.postMessage(message, "*")
      } catch {
        // iframe detached — ignore
      }
    }

    const seedActivity = async (sessionID: string) => {
      const activity = await fetchSessionActivity(globalSDK.fetch, sdk.url, sdk.directory, sessionID)
      if (!activity) return
      post(buildActivitySeedPayload(sessionID, activity))
    }

    const seedStats = (sessionID: string) => {
      post(buildStatsSeedPayload(sync.data.message[sessionID] ?? [], (id) => sync.data.part[id]))
    }

    const handleMessage = createReadyHandler({
      uri: props.uri,
      sessionID: props.sessionID,
      contentWindow: iframe.contentWindow,
      seedActivity,
      seedStats,
    })

    window.addEventListener("message", handleMessage)
    onCleanup(() => window.removeEventListener("message", handleMessage))
  })

  return (
    <div
      class={`relative w-full h-full flex flex-col overflow-hidden ${props.class ?? ""}`}
      data-component="mcp-app-panel"
    >
      <Show when={html.loading}>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-12-regular text-text-weak animate-pulse">Loading app…</span>
        </div>
      </Show>

      <Show when={html.error}>
        <div class="absolute inset-0 flex items-center justify-center px-6">
          <div class="text-12-regular text-text-danger text-center">Failed to load MCP App: {String(html.error)}</div>
        </div>
      </Show>

      <Show when={srcdoc()}>
        {(doc) => (
          <iframe
            ref={(el) => {
              iframeRef = el
              setIframeSignal(el)
            }}
            srcdoc={doc()}
            // allow-scripts: JavaScript execution (required for all MCP apps)
            // Intentionally NO allow-same-origin — keeps the app in a null-origin
            // sandbox so it cannot access host cookies, localStorage, or IndexedDB.
            sandbox="allow-scripts"
            class="w-full flex-1 border-none bg-background-base"
            title="MCP App"
            aria-label={`MCP App: ${props.server}`}
          />
        )}
      </Show>
    </div>
  )
}

// ─── McpAppsTab — the side-panel tab content ──────────────────────────────────

export interface McpAppResource {
  server: string
  name: string
  uri: string
  description?: string
}

async function fetchAppList(fetchFn: FetchLike, baseUrl: string, directory: string): Promise<McpAppResource[]> {
  const url = new URL(`${baseUrl}/mcp/apps`)
  url.searchParams.set("directory", directory)
  const res = await fetchFn(url.toString())
  if (!res.ok) throw new Error(`Failed to fetch MCP App list: ${res.status}`)
  return res.json() as Promise<McpAppResource[]>
}

export interface McpAppsTabProps {
  /** URIs that are currently pinned as dedicated tabs (so we can show "pinned" state). */
  pinnedUris?: string[]
  /** Called when the user pins an app to its own sidebar tab. */
  onPin?: (app: McpAppResource) => void
  /** Called when the user unpins an app. */
  onUnpin?: (uri: string) => void
  /** Current session id — forwarded to the embedded panel so built-in apps get seeded. */
  sessionID?: string
}

export function McpAppsTab(props: McpAppsTabProps): JSX.Element {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const [apps] = createResource(() => fetchAppList(globalSDK.fetch, sdk.url, sdk.directory))
  const [activeApp, setActiveApp] = createSignal<McpAppResource | undefined>(undefined)

  // Auto-select first app when list loads
  createEffect(() => {
    const list = apps()
    if (list && list.length > 0 && !activeApp()) {
      setActiveApp(list[0])
    }
  })

  const isPinned = (uri: string) => props.pinnedUris?.includes(uri) ?? false

  return (
    <div class="w-full h-full flex flex-col overflow-hidden">
      <Show when={apps.loading}>
        <div class="flex-1 flex items-center justify-center">
          <span class="text-12-regular text-text-weak animate-pulse">Checking for MCP Apps…</span>
        </div>
      </Show>

      <Show when={!apps.loading && (!apps() || apps()!.length === 0)}>
        <div class="flex-1 flex flex-col items-center justify-center gap-3 px-6 pb-16 text-center">
          <div class="text-12-regular text-text-weak">No MCP Apps connected</div>
          <div class="text-11-regular text-text-weaker max-w-48">
            Connect an MCP server that exposes a <code class="font-mono">ui://</code> resource to see apps here.
          </div>
        </div>
      </Show>

      <Show when={apps() && apps()!.length > 0}>
        {/* App picker bar — always shown so users can pin/switch apps */}
        <div class="shrink-0 flex gap-1 px-3 py-2 overflow-x-auto no-scrollbar border-b border-border-weaker-base">
          {apps()?.map((app) => (
            <div class="shrink-0 flex items-center gap-0.5">
              <button
                type="button"
                class="px-2.5 py-1 rounded-md text-11-medium transition-colors"
                classList={{
                  "bg-background-active text-text-strong": activeApp()?.uri === app.uri,
                  "text-text-weak hover:text-text-base hover:bg-background-subtle": activeApp()?.uri !== app.uri,
                }}
                onClick={() => setActiveApp(app)}
                title={app.description}
              >
                {app.name}
              </button>
              <Show when={props.onPin}>
                <button
                  type="button"
                  class="w-5 h-5 flex items-center justify-center rounded transition-colors"
                  classList={{
                    "text-text-strong bg-background-active": isPinned(app.uri),
                    "text-text-weaker hover:text-text-weak": !isPinned(app.uri),
                  }}
                  title={isPinned(app.uri) ? "Unpin tab" : "Pin as tab"}
                  onClick={() => {
                    if (isPinned(app.uri)) {
                      props.onUnpin?.(app.uri)
                    } else {
                      props.onPin?.(app)
                    }
                  }}
                >
                  {/* Simple pin icon using SVG */}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill={isPinned(app.uri) ? "currentColor" : "none"}
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="12" y1="17" x2="12" y2="22" />
                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                  </svg>
                </button>
              </Show>
            </div>
          ))}
        </div>

        <Show when={activeApp()}>
          {(app) => (
            <McpAppPanel server={app().server} uri={app().uri} sessionID={props.sessionID} class="flex-1 min-h-0" />
          )}
        </Show>
      </Show>
    </div>
  )
}
