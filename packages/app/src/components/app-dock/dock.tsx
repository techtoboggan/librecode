import { Show, createSignal, onCleanup, type JSX } from "solid-js"
import { McpAppPanel } from "@/components/mcp-app-panel"
import type { McpAppResource } from "@/components/mcp-app-panel/types"
import { useAppDockState } from "./use-dock-state"
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "./types"

export interface AppDockProps {
  sessionID?: string
  /**
   * Called when the empty-state "Try it" button is clicked. The parent supplies a
   * built-in app reference (typically Session Stats) so the dock doesn't need to
   * reach into the built-in-apps registry directly.
   */
  exampleApp?: McpAppResource
}

/**
 * Right-side App Dock pane.
 *
 * ADR-006 / iframe preservation: visibility toggling uses CSS `display:none`
 * rather than conditional unmount. The McpAppPanel iframe stays alive across
 * hide/show cycles so the AppBridge, postMessage transport, and accumulated
 * app state all survive a Ctrl+\ toggle.
 */
export function AppDock(props: AppDockProps): JSX.Element {
  const dock = useAppDockState()
  const [dragging, setDragging] = createSignal(false)

  const onResizePointerDown = (e: PointerEvent) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  const onResizePointerMove = (e: PointerEvent) => {
    if (!dragging()) return
    const newWidth = window.innerWidth - e.clientX
    dock.resize(newWidth)
  }

  const onResizePointerUp = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement
    target.releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  onCleanup(() => {
    setDragging(false)
  })

  const entry = () => dock.state().entries[0]

  return (
    // Outer wrapper: always in DOM when dock feature is active, hidden via
    // display:none when visibility === "hidden". This preserves the iframe.
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

      {/* Content area */}
      <Show when={entry()} fallback={<EmptyDockState exampleApp={props.exampleApp} onAdd={(app) => dock.add(app)} />}>
        {(e) => (
          <DockPane
            entry={{ server: e().app.server, uri: e().app.uri, name: e().app.name }}
            sessionID={props.sessionID}
            onRemove={() => dock.remove(e().uri)}
          />
        )}
      </Show>
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
  entry: { server: string; uri: string; name: string }
  sessionID?: string
  onRemove: () => void
}

function DockPane(props: DockPaneProps): JSX.Element {
  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="flex items-center justify-between px-3 py-2 shrink-0 border-b border-border-weak-base">
        <span class="text-12-medium text-text-strong truncate">{props.entry.name}</span>
        <button
          data-testid="dock-remove-button"
          type="button"
          class="text-text-weak hover:text-text-base shrink-0 ml-2"
          aria-label={`Remove ${props.entry.name} from dock`}
          onClick={props.onRemove}
        >
          ×
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden">
        <McpAppPanel
          server={props.entry.server}
          uri={props.entry.uri}
          sessionID={props.sessionID}
          appName={props.entry.name}
          class="h-full"
        />
      </div>
    </div>
  )
}
