import { createDraggable } from "@thisbeyond/solid-dnd"
import { Show, type JSX } from "solid-js"
import { PaneMenu } from "./pane-menu"
import { PaneStatusDot } from "./pane-status-dot"
import type { PaneStatus } from "./pane-status"

export interface PaneHeaderProps {
  uri: string
  appName: string
  collapsed: boolean
  status: PaneStatus
  onToggleCollapse: () => void
  onRemove: () => void
  onReconnect: () => void
  onViewError: () => void
}

/**
 * Per-pane header: drag handle + status dot + app name + collapse chevron + ⋮ menu.
 *
 * Phase 47: added PaneStatusDot and PaneMenu (replaces the inline remove button).
 * The entire header is the drag target using @thisbeyond/solid-dnd's
 * createDraggable (declared in env.d.ts Directives). Collapse and menu
 * buttons stopPropagation to prevent triggering a drag.
 *
 * adr-006 N/A: no createResource in this component.
 */
export function PaneHeader(props: PaneHeaderProps): JSX.Element {
  const draggable = createDraggable(props.uri)

  return (
    <div
      use:draggable
      data-testid={`pane-header-${props.uri}`}
      data-uri={props.uri}
      class="flex items-center justify-between px-3 py-2 shrink-0 border-b border-border-weak-base cursor-grab active:cursor-grabbing select-none"
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
      <PaneMenu
        uri={props.uri}
        appName={props.appName}
        status={props.status}
        onReconnect={props.onReconnect}
        onViewError={props.onViewError}
        onRemove={props.onRemove}
      />
    </div>
  )
}
