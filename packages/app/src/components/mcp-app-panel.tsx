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
 * Modules in `./mcp-app-panel/` own the pure pieces (CSP, theme, fetch,
 * seed payloads, state relay, SSE forwarding, AppBridge handler factories).
 * This file owns the Solid-aware glue: `useEventForwarding`, `useAppBridge`,
 * and the two visible components (`McpAppPanel` + `McpAppsTab`).
 *
 * Usage:
 *   <McpAppPanel server="my-server" uri="ui://my-server/app" />
 */

import {
  type Accessor,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"
import z from "zod"
import { useDialog } from "@librecode/ui/context/dialog"
import { useTheme } from "@librecode/ui/theme"
import { useGlobalSDK } from "@/context/global-sdk"
import { useMcpAppSettings } from "@/context/mcp-app-settings"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { McpAppDownloadDialog } from "./mcp-app-download-dialog"
import { McpAppPermissionPrompt } from "./mcp-app-permission-prompt"
import { createDownloadHandler, deliverBlobAsDownload } from "./mcp-app-download"
import { HOST_AVAILABLE_DISPLAY_MODES, type HostDisplayMode, resolveDisplayModeRequest } from "./mcp-app-display-mode"
import { createUiMessageHandler, createUpdateContextHandler } from "./mcp-app-message"
import { createSamplingHandler } from "./mcp-app-sampling"
import { DEFAULT_CSP, injectCsp } from "./mcp-app-panel/csp"
import { injectTheme, readThemeTokens } from "./mcp-app-panel/theme"
import { fetchAppHtml, fetchAppList, fetchSessionActivity, fetchSessionStatsSeed } from "./mcp-app-panel/fetch"
import {
  BUILTIN_URI_SESSION_STATS,
  buildActivitySeedPayload,
  buildStatsSeedPayload,
  createReadyHandler,
  seedForSession,
} from "./mcp-app-panel/seed"
import { createStateRelay } from "./mcp-app-panel/state-relay"
import { createEventForwarder } from "./mcp-app-panel/events"
import {
  createCallToolHandler,
  createListPromptsHandler,
  createListResourceTemplatesHandler,
  createListResourcesHandler,
  createLogHandler,
  createOpenLinkHandler,
  createReadResourceHandler,
  withRunning,
} from "./mcp-app-panel/handlers"
import type { McpAppResource } from "./mcp-app-panel/types"

// ─── Backward-compatible re-exports ──────────────────────────────────────────
//
// Tests + sibling modules import these from `./mcp-app-panel`. Forwarding
// here keeps every import path unchanged after the split.

export { DEFAULT_CSP, injectCsp } from "./mcp-app-panel/csp"
export { buildThemeCss, injectTheme } from "./mcp-app-panel/theme"
export {
  BUILTIN_URI_ACTIVITY_GRAPH,
  BUILTIN_URI_SESSION_STATS,
  SEEDABLE_BUILTIN_URIS,
  buildActivitySeedPayload,
  buildStatsSeedPayload,
  createReadyHandler,
  seedForSession,
} from "./mcp-app-panel/seed"
export { createStateRelay } from "./mcp-app-panel/state-relay"
export { FORWARDED_EVENT_TYPES, createEventForwarder, shouldForwardEvent } from "./mcp-app-panel/events"
export {
  OPEN_LINK_ALLOWED_SCHEMES,
  createCallToolHandler,
  createListPromptsHandler,
  createListResourceTemplatesHandler,
  createListResourcesHandler,
  createLogHandler,
  createOpenLinkHandler,
  createReadResourceHandler,
  isSafeOpenUrl,
} from "./mcp-app-panel/handlers"
export type { McpAppResource } from "./mcp-app-panel/types"

// Download / display-mode / message / sampling helpers — already in their
// own files, re-exported here for the same reason.
export type { DownloadItem } from "./mcp-app-download"
export {
  createDownloadHandler,
  deliverBlobAsDownload,
  downloadItemFilename,
  embeddedResourceToBlob,
  isSafeDownloadUrl,
} from "./mcp-app-download"
export { HOST_AVAILABLE_DISPLAY_MODES, type HostDisplayMode, resolveDisplayModeRequest } from "./mcp-app-display-mode"
export {
  DEFAULT_MCP_MESSAGE_CHAR_LIMIT,
  type McpContentBlock,
  createUiMessageHandler,
  createUpdateContextHandler,
  summarizeContextContent,
  summarizeMessageText,
  validateMessageContent,
} from "./mcp-app-message"
export {
  DEFAULT_SAMPLING_HOURLY_USD_CAP,
  SAMPLING_CAP_WINDOW_MS,
  checkSamplingCap,
  clearSamplingLedger,
  createSamplingHandler,
  recordSamplingCost,
  totalSamplingCostUsd,
} from "./mcp-app-sampling"

// ─── SSE event forwarding hook ───────────────────────────────────────────────

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

// ─── Sampling request schema ─────────────────────────────────────────────────
//
// v0.9.53 — minimal Zod schema for `sampling/createMessage`. Hand-written
// rather than depending on `@modelcontextprotocol/sdk` directly (it's a
// transitive dep of ext-apps) to keep the app package's dep graph tight.
// The server route does strict validation a second time, so this only
// needs to satisfy the bridge's `Protocol.setRequestHandler` signature
// — catch the method + forward the params through.

const SamplingTextContent = z.object({ type: z.literal("text"), text: z.string() })
const SamplingMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([SamplingTextContent, z.array(SamplingTextContent)]),
})
const SamplingCreateMessageRequestSchema = z.object({
  method: z.literal("sampling/createMessage"),
  params: z.object({
    messages: z.array(SamplingMessageSchema).min(1),
    maxTokens: z.number().int().positive(),
    systemPrompt: z.string().optional(),
    temperature: z.number().optional(),
    stopSequences: z.array(z.string()).optional(),
    // Ignored client-side (server picks the model); accepted so the
    // spec's shape validates.
    modelPreferences: z.unknown().optional(),
    includeContext: z.unknown().optional(),
    metadata: z.unknown().optional(),
    tools: z.unknown().optional(),
    toolChoice: z.unknown().optional(),
  }),
})
type SamplingRequestParams = z.infer<typeof SamplingCreateMessageRequestSchema>["params"]

// ─── AppBridge lifecycle hook ────────────────────────────────────────────────

function useAppBridge(
  iframeRef: Accessor<HTMLIFrameElement | undefined>,
  context: {
    sessionID: () => string | undefined
    server: string
    uri: string
    appName: () => string
  },
) {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const theme = useTheme()
  const dialog = useDialog()
  const mcpAppSettings = useMcpAppSettings()
  const [bridgeSignal, setBridgeSignal] = createSignal<AppBridge | undefined>()
  const [running, setRunning] = createSignal(0)
  const [displayMode, setDisplayMode] = createSignal<HostDisplayMode>("inline")
  const inc = () => setRunning((n) => n + 1)
  const dec = () => setRunning((n) => Math.max(0, n - 1))

  createEffect(() => {
    const iframe = iframeRef()
    if (!iframe?.contentWindow) return

    const transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow)

    // Host capabilities advertised to the iframe:
    //   * serverTools — iframe may issue tools/call (proxied via our
    //     oncalltool handler to the host endpoint with manifest gate).
    //   * serverResources — iframe may issue resources/list +
    //     resources/read + resources/templates/list. Prompts share the
    //     same proxy path even though there's no dedicated capability
    //     in the spec schema.
    //   * openLinks — iframe may issue ui/open-link.
    //   * downloadFile — iframe may issue ui/download-file.
    //   * logging — iframe may issue notifications/message.
    const bridge = new AppBridge(
      null, // not auto-forwarding via a pre-built MCP Client — we proxy
      { name: "librecode", version: "0" },
      {
        serverTools: {},
        serverResources: {},
        openLinks: {},
        downloadFile: {},
        // v0.9.46 — declare which content-block kinds we accept on
        // ui/message. Text only for now; adding image/audio/etc. is
        // an additive change once renderer support lands.
        message: { text: {} },
        // v0.9.47 — text + structuredContent for ui/update-model-context.
        updateModelContext: { text: {}, structuredContent: {} },
        logging: {},
      },
      {
        hostContext: {
          theme: theme.mode(),
          displayMode: displayMode(),
          // v0.9.45 — surface what we support so apps can hide a
          // fullscreen toggle if we ever need to drop the capability.
          availableDisplayModes: [...HOST_AVAILABLE_DISPLAY_MODES],
        },
      },
    )

    // Common args reused by every proxy factory.
    const proxyOpts = {
      fetchFn: globalSDK.fetch,
      baseUrl: sdk.url,
      sessionID: context.sessionID(),
      server: context.server,
    }

    // Tool-call proxy → /session/:id/mcp-apps/tool with manifest gate.
    const callTool = createCallToolHandler({ ...proxyOpts, uri: context.uri })
    // Cast: AppBridge expects a `CallToolResult` typed against the MCP SDK's
    // strict content union. Our handler returns the same JSON shape but
    // pre-typed as unknown[] (we don't validate the bytes from the server
    // route — they're already a CallToolResult). The runtime contract holds.
    bridge.oncalltool = withRunning(callTool, inc, dec) as unknown as NonNullable<typeof bridge.oncalltool>

    // Read-only proxies (ADR-005 §4) — no permission gate; scoped to the
    // app's MCP server; resources/read additionally checked server-side
    // against the resources/list result so apps can't read URIs the
    // server didn't advertise.
    bridge.onlistresources = withRunning(createListResourcesHandler(proxyOpts), inc, dec) as unknown as NonNullable<
      typeof bridge.onlistresources
    >
    bridge.onreadresource = withRunning(createReadResourceHandler(proxyOpts), inc, dec) as unknown as NonNullable<
      typeof bridge.onreadresource
    >
    bridge.onlistresourcetemplates = withRunning(
      createListResourceTemplatesHandler(proxyOpts),
      inc,
      dec,
    ) as unknown as NonNullable<typeof bridge.onlistresourcetemplates>
    bridge.onlistprompts = withRunning(createListPromptsHandler(proxyOpts), inc, dec) as unknown as NonNullable<
      typeof bridge.onlistprompts
    >

    // ui/open-link → platform.openLink (with scheme allowlist).
    bridge.onopenlink = withRunning(
      createOpenLinkHandler((url) => platform.openLink(url)),
      inc,
      dec,
    )

    // ui/download-file → confirm dialog, then deliver inline blobs +
    // open ResourceLink urls. Per ADR-005 §6 + the user's "no
    // automatic save" policy: every batch needs explicit consent.
    const onDownload = createDownloadHandler({
      confirm: (items) =>
        new Promise<boolean>((resolve) => {
          let decided = false
          const decide = (approve: boolean) => {
            if (decided) return
            decided = true
            dialog.close()
            resolve(approve)
          }
          dialog.show(
            () => <McpAppDownloadDialog appName={context.appName()} items={items} onDecide={decide} />,
            () => decide(false),
          )
        }),
      deliverBlob: deliverBlobAsDownload,
      openUrl: (url) => platform.openLink(url),
    })
    bridge.ondownloadfile = withRunning(onDownload, inc, dec) as unknown as NonNullable<typeof bridge.ondownloadfile>

    // notifications/message → console with severity tag (no in-flight
    // tracking — these are fire-and-forget notifications, not requests).
    bridge.onloggingmessage = createLogHandler({ server: context.server })

    // ui/message → POST to /session/:id/mcp-apps/message which gates
    // through the permission system, char-limits, and posts into the
    // chat thread. The host returns {} on success and never the model's
    // follow-up — apps cannot use this as an exfiltration channel
    // (ADR-005 §8 + the v0.9.46 implementation). v0.9.48 lets the
    // user override the char limit per-server via Settings → MCP Apps.
    bridge.onmessage = withRunning(
      createUiMessageHandler({
        ...proxyOpts,
        uri: context.uri,
        charLimit: mcpAppSettings.messageCharLimitOf(context.server),
      }),
      inc,
      dec,
    ) as unknown as NonNullable<typeof bridge.onmessage>

    // ui/update-model-context → POST to /session/:id/mcp-apps/context
    // which validates char caps, stores replace-on-write, and the prompt
    // builder injects the entries into the next model turn as
    // <mcp-app server="..." uri="...">...</mcp-app> system segments.
    // ADR-005 §7 + v0.9.47.
    bridge.onupdatemodelcontext = withRunning(
      createUpdateContextHandler({ ...proxyOpts, uri: context.uri }),
      inc,
      dec,
    ) as unknown as NonNullable<typeof bridge.onupdatemodelcontext>

    // sampling/createMessage — v0.9.53 enables the full path. The
    // server route gates through the permission system + the per-app
    // hourly USD cap, runs the inference on the user's account using
    // the session's current model, and records the settled cost
    // server-side. A breached cap comes back as `{isError: true}`
    // in-band so the bridge stays connected.
    const sampleHandler = createSamplingHandler({
      ...proxyOpts,
      uri: context.uri,
      capUsd: mcpAppSettings.samplingHourlyUsdCapOf(context.server),
    })
    bridge.setRequestHandler(SamplingCreateMessageRequestSchema, async (req) => {
      return await withRunning(
        async (params: SamplingRequestParams) => sampleHandler(params),
        inc,
        dec,
      )(req.params as SamplingRequestParams)
    })

    // ui/request-display-mode → toggle the panel's overlay state.
    // ADR-005 §5 + v0.9.45 — fullscreen supported, pip deferred. Per
    // the MCP spec we MUST report back the mode actually in effect,
    // even when the request is unsupported (no exceptions).
    bridge.onrequestdisplaymode = withRunning(
      async (params: { mode: string }) => {
        const next = resolveDisplayModeRequest(params.mode, displayMode())
        setDisplayMode(next)
        return { mode: next }
      },
      inc,
      dec,
    ) as unknown as NonNullable<typeof bridge.onrequestdisplaymode>

    // Connect once the iframe's srcdoc has loaded
    const handleLoad = () => {
      bridge.connect(transport).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes("already connected")) return
        console.error("[McpAppPanel] AppBridge connect failed:", err)
      })
    }

    iframe.addEventListener("load", handleLoad)
    setBridgeSignal(bridge)

    onCleanup(() => {
      iframe.removeEventListener("load", handleLoad)
      setBridgeSignal(undefined)
      bridge.close().catch(() => {})
    })
  })

  // Push theme changes into the live bridge — separate effect so a host
  // theme toggle pushes a ui/notifications/host-context-changed without
  // rebuilding the whole bridge.
  createEffect(() => {
    const bridge = bridgeSignal()
    if (!bridge) return
    const mode = theme.mode()
    try {
      bridge.setHostContext({ theme: mode })
    } catch {
      // Bridge not initialized yet (pre-handshake) — Kobalte/AppBridge
      // raises if we push before initialize completes. That's fine: the
      // bridge constructor already received the initial mode, so the app
      // gets the correct theme when it first reads host context.
    }
  })

  // Push display-mode changes too — apps that want to react to fullscreen
  // entry/exit can listen for ui/notifications/host-context-changed.
  createEffect(() => {
    const bridge = bridgeSignal()
    if (!bridge) return
    const mode = displayMode()
    try {
      bridge.setHostContext({ displayMode: mode })
    } catch {
      // pre-handshake — initial value already supplied via constructor.
    }
  })

  /**
   * v0.9.44 Disconnect action: closes the bridge transport (terminating
   * any in-flight requests) and POSTs to the host to drop this app's
   * session-scoped permission grants. Persistent rules stay (those go
   * through the v0.9.48 Settings pane). After disconnect the iframe
   * still shows whatever it was showing, but the bridge is dead — new
   * tools/call requests will fail. The user can re-pin the app to get
   * a fresh bridge.
   */
  const disconnect = async () => {
    const bridge = bridgeSignal()
    if (bridge) {
      await bridge.close().catch(() => {})
      setBridgeSignal(undefined)
    }
    const sessionID = context.sessionID()
    if (!sessionID) return
    try {
      const url = new URL(`${sdk.url}/session/${sessionID}/mcp-apps/disconnect`)
      await globalSDK.fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: context.server }),
      })
    } catch {
      // Best-effort — bridge is already closed locally.
    }
  }

  return { running, disconnect, displayMode, setDisplayMode }
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
  /** Display name of the app — used in the inline permission prompt copy. */
  appName?: string
  /** Optional explicit class for the wrapper. */
  class?: string
}

export function McpAppPanel(props: McpAppPanelProps): JSX.Element {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const sync = useSync()
  const permission = usePermission()
  let iframeRef: HTMLIFrameElement | undefined
  const [iframeSignal, setIframeSignal] = createSignal<HTMLIFrameElement | undefined>(undefined)

  // adr-006: keyed on (server, uri) — both are props supplied at mount and
  // never written by event handlers in this component. Re-keys only when
  // the parent picks a different app, which is a legitimate reload.
  const [html] = createResource(
    () => ({ server: props.server, uri: props.uri }),
    ({ server, uri }) => fetchAppHtml(globalSDK.fetch, sdk.url, sdk.directory, server, uri),
  )

  const srcdoc = () => {
    // v0.9.61 — guard against reading an errored resource. Solid's
    // resource accessor re-throws when the last fetch failed; without
    // this guard an unreachable MCP app (server disconnected, 404, etc.)
    // bubbles past our in-panel `<Show when={html.error}>` handler and
    // crashes the whole app via the root ErrorBoundary. This was
    // latent until persistence landed — previously `pinnedApps` was
    // in-memory only, so an app couldn't outlive its server's
    // availability across a restart.
    if (html.error) return undefined
    const raw = html.latest
    if (!raw) return undefined
    const withCsp = injectCsp(raw, DEFAULT_CSP)
    return injectTheme(withCsp, readThemeTokens())
  }

  // Wire up AppBridge once we have the iframe ref. The bridge proxies any
  // `tools/call` from the iframe to /session/:id/mcp-apps/tool, gated by
  // the resource's _meta.ui.allowedTools manifest server-side (ADR-005).
  // `running` is a count of in-flight bridge requests (powers the running
  // dot); `disconnect` tears down the bridge + drops session grants for
  // this app (the v0.9.44 Disconnect action). `displayMode` toggles
  // between "inline" and "fullscreen" via ui/request-display-mode.
  const { running, disconnect, displayMode, setDisplayMode } = useAppBridge(iframeSignal, {
    sessionID: () => props.sessionID,
    server: props.server,
    uri: props.uri,
    appName: () => props.appName ?? props.server,
  })

  // Esc exits fullscreen — common keyboard convention. Active only
  // while the panel is in fullscreen mode so we don't intercept Esc
  // for other UI when inline.
  createEffect(() => {
    if (displayMode() !== "fullscreen") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDisplayMode("inline")
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // ADR-005 §2: when the host's tool-call route blocks on a permission
  // prompt for THIS app (matched by mcp-app:server:tool permission name
  // + uri pattern), surface it inline beneath the iframe. Independent
  // of the agent's composer dock so MCP-app prompts don't preempt the
  // agent and the user can tell which side initiated the call.
  const pendingPrompt = createMemo(() => {
    const sessionID = props.sessionID
    if (!sessionID) return undefined
    const requests = sync.data.permission?.[sessionID] ?? []
    return requests.find(
      (req) => req.permission.startsWith(`mcp-app:${props.server}:`) && (req.patterns ?? []).includes(props.uri),
    )
  })

  const decideOnPrompt = (decision: "once" | "session" | "always" | "reject") => {
    const req = pendingPrompt()
    if (!req) return
    permission.respond({
      sessionID: req.sessionID,
      permissionID: req.id,
      response: decision,
      directory: sdk.directory,
    })
  }
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

    const seedStats = async (sessionID: string) => {
      // v0.9.68 — prefer the server-side seed endpoint so initial
      // state doesn't depend on sync's hydration timing. Falls back
      // to the client-side sync store on a server error so dev
      // builds without the new route still work.
      const server = await fetchSessionStatsSeed(globalSDK.fetch, sdk.url, sdk.directory, sessionID)
      if (server) {
        post(server)
        return
      }
      post(buildStatsSeedPayload(sync.data.message[sessionID] ?? [], (id) => sync.data.part[id]))
    }

    const handleMessage = createReadyHandler({
      uri: props.uri,
      sessionID: props.sessionID,
      contentWindow: iframe.contentWindow,
      seedActivity,
      seedStats,
    })

    // v0.9.63 — bridge `mcp-app-state:load` / `:save` posts from the
    // iframe through to `/mcp/apps/state`. Lets MCP apps persist their
    // own per-(server, uri) state (e.g. user preferences, view
    // settings, custom dashboards) across LibreCode restarts.
    const handleStateRelay = createStateRelay({
      server: props.server,
      uri: props.uri,
      fetchFn: globalSDK.fetch,
      baseUrl: sdk.url,
      contentWindow: iframe.contentWindow,
    })

    window.addEventListener("message", handleMessage)
    window.addEventListener("message", handleStateRelay)
    onCleanup(() => {
      window.removeEventListener("message", handleMessage)
      window.removeEventListener("message", handleStateRelay)
    })
  })

  // v0.9.56 + v0.9.62 — seeding lifecycle:
  //
  //   a) initial seed when the iframe first reports ready
  //      (createReadyHandler above), AND
  //   b) re-seed whenever `props.sessionID` changes post-mount
  //      (seedForSession below — keyed (uri, sessionID) so we don't
  //      re-seed on every reactive re-read), AND
  //   c) re-seed whenever the session's message history grows
  //      (v0.9.62 fix — `sync.data.message[sessionID]` is empty while
  //      the session's messages hydrate from SSE, and the initial
  //      seed fires before hydration completes. Without re-seeding,
  //      a reload of a session with existing history shows empty
  //      stats until the next new message arrives).
  //
  // The iframe's `session.stats` handler resets state and re-ingests
  // from scratch each time, so repeated posts are idempotent.
  const seededForSession = new Set<string>()
  createEffect(() => {
    const iframe = iframeSignal()
    if (!iframe) return
    const sessionID = props.sessionID
    if (!sessionID) return
    const key = `${props.uri}|${sessionID}`
    if (seededForSession.has(key)) return
    seededForSession.add(key)

    const post = (message: unknown) => {
      try {
        iframe.contentWindow?.postMessage(message, "*")
      } catch {
        // iframe detached
      }
    }
    seedForSession({
      uri: props.uri,
      sessionID,
      seedActivity: async (id) => {
        const activity = await fetchSessionActivity(globalSDK.fetch, sdk.url, sdk.directory, id)
        if (!activity) return
        post(buildActivitySeedPayload(id, activity))
      },
      seedStats: async (id) => {
        // v0.9.68 — server-side seed first so the stats populate even
        // if sync hasn't hydrated yet. Fall through to the client-side
        // store if the dedicated endpoint is unavailable.
        const server = await fetchSessionStatsSeed(globalSDK.fetch, sdk.url, sdk.directory, id)
        if (server) {
          post(server)
          return
        }
        post(buildStatsSeedPayload(sync.data.message[id] ?? [], (pid) => sync.data.part[pid]))
      },
    })
  })

  // v0.9.62 — re-seed whenever the session's message history grows.
  // The initial seed fires before sync's SSE hydration completes, so
  // a reload of a long-running session would show empty stats until
  // the next live event. Watching `messages.length` catches history
  // arrival; the iframe handles repeated seeds idempotently.
  createEffect(() => {
    const iframe = iframeSignal()
    if (!iframe) return
    const sessionID = props.sessionID
    if (!sessionID) return
    // Only the session-stats app consumes buildStatsSeedPayload.
    // Activity Graph is seeded once from the /activity endpoint and
    // gets live updates via SSE, so it doesn't need this re-seed.
    if (props.uri !== BUILTIN_URI_SESSION_STATS) return
    const messages = sync.data.message[sessionID]
    if (!messages || messages.length === 0) return
    // Track the length so we only re-seed when it actually changes.
    // `messages` read above is reactive via the sync store proxy.
    try {
      iframe.contentWindow?.postMessage(
        buildStatsSeedPayload(messages, (pid) => sync.data.part[pid]),
        "*",
      )
    } catch {
      // iframe detached — ignore
    }
  })

  return (
    <div
      class={`flex flex-col overflow-hidden ${props.class ?? ""}`}
      classList={{
        "relative w-full h-full": displayMode() !== "fullscreen",
        // v0.9.45 fullscreen overlay: pin to viewport, top of stack,
        // black-out background. Esc + the header X both return to inline.
        "fixed inset-0 z-50 bg-background-base": displayMode() === "fullscreen",
      }}
      data-component="mcp-app-panel"
      data-display-mode={displayMode()}
    >
      {/*
        v0.9.44 header bar: compact toolbar above the iframe with the
        app name, a "running" indicator dot when the bridge has any
        in-flight request, a Disconnect action that drops session
        grants for this app and closes the bridge transport, and (new
        in v0.9.45) an Exit fullscreen button when the app has
        requested fullscreen.
      */}
      <Show when={srcdoc()}>
        <div class="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border-weak-base bg-surface-panel text-12-regular">
          <span class="text-text-strong truncate">{props.appName ?? props.server}</span>
          <Show when={running() > 0}>
            <span
              class="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse"
              title={`${running()} in-flight request${running() === 1 ? "" : "s"}`}
              aria-label="MCP app is running a request"
            />
          </Show>
          <span class="flex-1" />
          <Show when={displayMode() === "fullscreen"}>
            <button
              type="button"
              class="px-2 py-0.5 rounded text-11-regular text-text-weak hover:text-text-base hover:bg-background-stronger transition-colors"
              onClick={() => setDisplayMode("inline")}
              title="Exit fullscreen (Esc)"
              aria-label="Exit fullscreen"
            >
              Exit fullscreen
            </button>
          </Show>
          <button
            type="button"
            class="px-2 py-0.5 rounded text-11-regular text-text-weak hover:text-text-base hover:bg-background-stronger transition-colors"
            onClick={() => void disconnect()}
            title="Close the bridge and drop this app's session grants"
            aria-label="Disconnect MCP app"
          >
            Disconnect
          </button>
        </div>
      </Show>

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

      <Show when={pendingPrompt()} keyed>
        {(req) => (
          <McpAppPermissionPrompt
            request={req}
            appName={props.appName ?? props.server}
            responding={false}
            onDecide={decideOnPrompt}
          />
        )}
      </Show>
    </div>
  )
}

// ─── McpAppsTab — the side-panel tab content ──────────────────────────────────

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
  // adr-006: no-arg fetcher — fires once at mount, never re-keys. The
  // active-app signal below is pure UI state and doesn't gate this resource.
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
            <McpAppPanel
              server={app().server}
              uri={app().uri}
              sessionID={props.sessionID}
              appName={app().name}
              class="flex-1 min-h-0"
            />
          )}
        </Show>
      </Show>
    </div>
  )
}
