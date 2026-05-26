import { createDraggable } from "@thisbeyond/solid-dnd"
import { Show, type JSX } from "solid-js"
import { usePlatform } from "@/context/platform"
import { PaneMenu } from "./pane-menu"
import { PaneStatusDot } from "./pane-status-dot"
import type { PaneStatus } from "./pane-status"

export interface PaneHeaderProps {
  uri: string
  appName: string
  /** Phase 49 — server name, used to detect built-in apps (Detach button hidden). */
  server: string
  collapsed: boolean
  /** Phase 49 — true when this pane is already detached into its own window. */
  detached: boolean
  status: PaneStatus
  onToggleCollapse: () => void
  onRemove: () => void
  onReconnect: () => void
  onViewError: () => void
  /** Phase 49 — called when user clicks the ⤢ Detach button. */
  onDetach: () => void
  /** Phase 50 — 0-based index of this pane; stored as data-pane-index so the
   *  keyboard handler can querySelector the right header. */
  paneIndex?: number
}

/**
 * Per-pane header: drag handle + status dot + app name + collapse chevron + ⤢ detach + ⋮ menu.
 *
 * Phase 47: added PaneStatusDot and PaneMenu (replaces the inline remove button).
 * Phase 49: added Detach button (⤢), hidden on web and for built-in apps.
 * The entire header is the drag target using @thisbeyond/solid-dnd's
 * createDraggable (declared in env.d.ts Directives). Collapse and menu
 * buttons stopPropagation to prevent triggering a drag.
 *
 * adr-006 N/A: no createResource in this component.
 */
export function PaneHeader(props: PaneHeaderProps): JSX.Element {
  const platform = usePlatform()
  const draggable = createDraggable(props.uri)

  // Detach button shown only on desktop, for non-builtin apps, and only when not yet detached.
  const canDetach = (): boolean => platform.platform === "desktop" && props.server !== "__builtin__" && !props.detached

  return (
    <div
      use:draggable
      data-testid={`pane-header-${props.uri}`}
      data-uri={props.uri}
      data-pane-index={props.paneIndex}
      tabindex="0"
      class="flex items-center justify-between px-3 py-2 shrink-0 border-b border-border-weak-base cursor-grab active:cursor-grabbing select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-strong focus-visible:outline-none"
    >
      <div class="flex items-center gap-2 min-w-0">
        <button
          data-testid={`pane-collapse-${props.uri}`}
          type="button"
          class="text-text-weak hover:text-text-base shrink-0"
          aria-label={props.collapsed ? `Expand ${props.appName}` : `Collapse ${props.appName}`}
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleCollapse()
          }}
        >
          <Show when={!props.collapsed} fallback={<span aria-hidden="true">▸</span>}>
            <span aria-hidden="true">▾</span>
          </Show>
        </button>
        <PaneStatusDot status={props.status} />
        <span class="text-12-medium text-text-strong truncate">{props.appName}</span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <Show when={canDetach()}>
          <button
            data-testid={`pane-detach-${props.uri}`}
            type="button"
            class="text-text-weak hover:text-text-base shrink-0 ml-1"
            aria-label={`Detach ${props.appName} into its own window`}
            title="Detach into its own window"
            onClick={(e) => {
              e.stopPropagation()
              props.onDetach()
            }}
          >
            <span aria-hidden="true">⤢</span>
          </button>
        </Show>
        <PaneMenu
          uri={props.uri}
          appName={props.appName}
          status={props.status}
          onReconnect={props.onReconnect}
          onViewError={props.onViewError}
          onRemove={props.onRemove}
        />
      </div>
    </div>
  )
}
