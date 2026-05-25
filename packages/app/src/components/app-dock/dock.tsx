import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { DragDropProvider, DragDropSensors, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { createDroppable } from "@thisbeyond/solid-dnd"
import { showToast } from "@librecode/ui/toast"
import { McpAppPanel } from "@/components/mcp-app-panel"
import type { McpAppResource } from "@/components/mcp-app-panel/types"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { usePlatform } from "@/context/platform"
import { useAppDockState } from "./use-dock-state"
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH, type DockEntry } from "./types"
import { PaneHeader } from "./pane-header"
import { PaneDetachedPlaceholder } from "./pane-detached-placeholder"
import { PaneDivider } from "./divider"
import { AddAppPopover } from "./add-app-popover"
import { paneHeight, PANE_MIN_HEIGHT } from "./sizing"
import { deriveStatus } from "./pane-status"

export interface AppDockProps {
  sessionID?: string
  /**
   * Supplied by the parent: used to populate the "Try it" CTA in the
   * empty state. Phase 42 compatibility — dock does not need to reach
   * into the built-in-apps registry directly.
   */
  exampleApp?: McpAppResource
}

/**
 * Right-side App Dock pane — Phase 43 multi-pane edition.
 *
 * Displays N stacked panes, each hosting a McpAppPanel iframe.
 * Supports:
 *   - Drag-to-reorder via @thisbeyond/solid-dnd
 *   - Per-pane collapse (iframe preserved via display:none)
 *   - Horizontal divider drag to resize adjacent panes
 *   - "+ Add" popover for adding new apps
 *
 * ADR-006 / iframe preservation:
 *   The outer wrapper uses display:none (not unmount) for dock
 *   visibility. Collapse also uses display:none on the pane body.
 *   Reorder uses <For> keyed on stable URI strings so iframes
 *   survive reordering without re-mount.
 */
export function AppDock(props: AppDockProps): JSX.Element {
  const dock = useAppDockState()
  const platform = usePlatform()
  const [dragging, setDragging] = createSignal(false)
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>()
  const [availablePx, setAvailablePx] = createSignal(400)

  // Measure the pane-list container height so paneHeight() can compute
  // equal distributions. Updated whenever the container resizes.
  createEffect(() => {
    const el = containerRef()
    if (!el) return
    setAvailablePx(el.clientHeight)
    const obs = new ResizeObserver(() => setAvailablePx(el.clientHeight))
    obs.observe(el)
    onCleanup(() => obs.disconnect())
  })

  // Phase 49 — listen for dock.reattach IPC events emitted by detached windows.
  // Only register on desktop (listenTauriEvent is undefined on web).
  createEffect(() => {
    if (!platform.listenTauriEvent) return
    let unlisten: (() => void) | undefined

    platform
      .listenTauriEvent<{ uri: string }>("dock.reattach", (payload) => {
        dock.reattach(payload.uri)
      })
      .then((fn) => {
        unlisten = fn
      })
      .catch(() => undefined)

    onCleanup(() => {
      unlisten?.()
    })
  })

  // ── Dock-width resize handle ──────────────────────────────────────────────

  const onResizePointerDown = (e: PointerEvent) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  const onResizePointerMove = (e: PointerEvent) => {
    if (!dragging()) return
    dock.resize(window.innerWidth - e.clientX)
  }

  const onResizePointerUp = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement
    target.releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  onCleanup(() => setDragging(false))

  // ── Drag-to-reorder ───────────────────────────────────────────────────────

  const handleDragOver = (event: DragEvent) => {
    const { draggable: d, droppable } = event
    if (!d || !droppable) return
    dock.reorder(String(d.id), String(droppable.id))
  }

  // Derived: stable array of URIs for <For> keying (avoids iframe remount
  // on reorder — see Pitfall #1 in phase-43-spec.md).
  const paneUris = () => dock.state().entries.map((e) => e.uri)

  const entryByUri = (uri: string): DockEntry | undefined => dock.state().entries.find((e) => e.uri === uri)

  return (
    <div
      data-testid="app-dock"
      style={{
        display: dock.state().visibility === "hidden" ? "none" : "flex",
        width: `${dock.state().width}px`,
        "min-width": `${DOCK_MIN_WIDTH}px`,
        "max-width": `${DOCK_MAX_WIDTH}px`,
      }}
      class="relative flex-col h-full bg-background-stronger border-l border-border-weak-base overflow-hidden shrink-0"
    >
      {/* Left-edge resize handle */}
      <div
        data-testid="dock-resize-handle"
        class="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-border-base"
        style={{ "min-width": "4px" }}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />

      {/* Content area — pane list or empty state */}
      <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
        <Show
          when={dock.state().entries.length > 0}
          fallback={<EmptyDockState exampleApp={props.exampleApp} onAdd={(app) => dock.add(app)} />}
        >
          {/* DragDropProvider must NOT wrap the AddAppPopover — see Pitfall #3. */}
          <DragDropProvider onDragOver={handleDragOver} collisionDetector={closestCenter}>
            <DragDropSensors />
            <div ref={setContainerRef} class="flex flex-col flex-1 min-h-0 overflow-y-auto">
              <For each={paneUris()}>
                {(uri, idx) => {
                  const entry = () => entryByUri(uri)
                  return (
                    <Show when={entry()}>
                      {(e) => (
                        <>
                          <DockPane entry={e()} sessionID={props.sessionID} availablePx={availablePx()} />
                          <Show when={idx() < dock.state().entries.length - 1}>
                            <PaneDivider
                              onResize={(delta) => {
                                const entries = dock.state().entries
                                const below = entries[idx() + 1]
                                if (below) dock.applyDividerDrag(uri, below.uri, delta, availablePx())
                              }}
                            />
                          </Show>
                        </>
                      )}
                    </Show>
                  )
                }}
              </For>
            </div>
          </DragDropProvider>
        </Show>
      </div>

      {/* Footer — add button always visible so user can add more apps.
          Rendered OUTSIDE the DragDropProvider to avoid click interception. */}
      <div class="shrink-0 border-t border-border-weak-base">
        <AddAppPopover />
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

interface EmptyDockStateProps {
  exampleApp?: McpAppResource
  onAdd: (app: McpAppResource) => void
}

function EmptyDockState(props: EmptyDockStateProps): JSX.Element {
  return (
    <div data-testid="dock-empty-state" class="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <p class="text-14-regular text-text-weak">Add an app to your dock</p>
      <Show when={props.exampleApp}>
        {(app) => (
          <button
            data-testid="dock-try-button"
            type="button"
            class="text-12-regular px-3 py-1.5 rounded-md border border-border-base bg-surface-panel hover:bg-surface-raised-base-hover text-text-base"
            onClick={() => props.onAdd(app())}
          >
            Try it: Add {app().name}
          </button>
        )}
      </Show>
    </div>
  )
}

interface DockPaneProps {
  entry: DockEntry
  sessionID?: string
  availablePx: number
}

/**
 * Reconnect an MCP server via the SDK. No-ops for built-in apps.
 * On error, shows a toast so the user knows what went wrong.
 */
async function reconnectMcpServer(sdk: ReturnType<typeof useSDK>, server: string): Promise<void> {
  if (server === "__builtin__") return
  const result = await sdk.client.mcp.reconnect({ server })
  if (result.error) {
    showToast({
      variant: "error",
      title: "Reconnect failed",
      description: String(result.error),
    })
  }
}

function DockPane(props: DockPaneProps): JSX.Element {
  const dock = useAppDockState()
  const sync = useSync()
  const sdk = useSDK()
  const platform = usePlatform()
  const [viewingError, setViewingError] = createSignal(false)

  // Register this pane as a drop target so drag-over events populate
  // event.droppable.id with the pane's URI.
  const droppable = createDroppable(props.entry.uri)

  // Derived status from live sync.data.mcp — reactive getter, no createResource.
  // adr-006 N/A: reads sync store (stable SSE-fed source), not a user-event signal.
  const status = () => deriveStatus(props.entry.app, sync.data.mcp ?? {})

  const height = () => paneHeight(dock.state(), props.entry.uri, props.availablePx)

  const onReconnect = () => {
    setViewingError(false)
    void reconnectMcpServer(sdk, props.entry.app.server)
  }
  const onViewError = () => setViewingError(true)
  const closeError = () => setViewingError(false)

  // Phase 49 — detach this pane into its own Tauri window.
  const onDetach = async (): Promise<void> => {
    if (!platform.openDetachedWindow) return
    try {
      await platform.openDetachedWindow({
        server: props.entry.app.server,
        uri: props.entry.uri,
        appName: props.entry.app.name,
        dir: sdk.directory,
      })
      dock.detach(props.entry.uri)
    } catch (err) {
      showToast({
        variant: "error",
        title: `Failed to detach ${props.entry.app.name}`,
        description: String(err),
      })
    }
  }

  return (
    <div
      ref={droppable.ref}
      data-testid={`dock-pane-${props.entry.uri}`}
      style={{ height: `${height()}px`, "min-height": `${PANE_MIN_HEIGHT}px` }}
      class="flex flex-col overflow-hidden shrink-0"
    >
      <PaneHeader
        uri={props.entry.uri}
        appName={props.entry.app.name}
        server={props.entry.app.server}
        collapsed={props.entry.collapsed ?? false}
        detached={props.entry.detached ?? false}
        status={status()}
        onToggleCollapse={() => dock.setCollapsed(props.entry.uri, !(props.entry.collapsed ?? false))}
        onRemove={() => dock.remove(props.entry.uri)}
        onReconnect={onReconnect}
        onViewError={onViewError}
        onDetach={() => void onDetach()}
      />
      {/* Pane body — display:none keeps the iframe alive (state preserved across collapse). */}
      <div class="flex-1 min-h-0 overflow-hidden" style={{ display: props.entry.collapsed ? "none" : "flex" }}>
        {/* Phase 49 — if detached, show placeholder instead of the iframe. */}
        <Show
          when={!props.entry.detached}
          fallback={
            <PaneDetachedPlaceholder
              app={props.entry.app}
              onReattach={() => dock.reattach(props.entry.uri)}
              onFocus={() =>
                void platform.focusDetachedWindow?.({
                  server: props.entry.app.server,
                  uri: props.entry.uri,
                })
              }
            />
          }
        >
          {/*
            Phase 47: error panel toggled via display:none, NOT <Show>, so the iframe
            is never unmounted (preserves bridge state per ADR-006 / Phase 42 design).
          */}
          <div
            class="h-full w-full"
            style={{ display: viewingError() && status().kind === "failed" ? "none" : "flex" }}
          >
            <McpAppPanel
              server={props.entry.app.server}
              uri={props.entry.app.uri}
              sessionID={props.sessionID}
              appName={props.entry.app.name}
              class="h-full"
            />
          </div>
          <Show when={viewingError() && status().kind === "failed"}>
            <PaneErrorPanel error={status().error ?? "Unknown error"} onClose={closeError} />
          </Show>
        </Show>
      </div>
    </div>
  )
}

interface PaneErrorPanelProps {
  error: string
  onClose: () => void
}

function PaneErrorPanel(props: PaneErrorPanelProps): JSX.Element {
  return (
    <div data-testid="pane-error-panel" class="flex flex-col p-4 gap-3 text-12-regular w-full">
      <p class="text-text-danger-base font-mono break-words">{props.error}</p>
      <button type="button" class="text-text-weak hover:text-text-base self-start" onClick={props.onClose}>
        ← Back to app
      </button>
    </div>
  )
}
