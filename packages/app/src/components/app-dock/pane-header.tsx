import { createDraggable } from "@thisbeyond/solid-dnd"
import { Show, type JSX } from "solid-js"

export interface PaneHeaderProps {
  uri: string
  name: string
  collapsed: boolean
  onToggleCollapse: () => void
  onRemove: () => void
}

/**
 * Per-pane header: drag handle + app name + collapse chevron + remove button.
 *
 * The entire header is the drag target using @thisbeyond/solid-dnd's
 * createDraggable (declared in env.d.ts Directives). Collapse and
 * remove buttons stopPropagation to prevent triggering a drag.
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
          aria-label={props.collapsed ? `Expand ${props.name}` : `Collapse ${props.name}`}
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleCollapse()
          }}
        >
          <Show when={!props.collapsed} fallback={<span aria-hidden="true">▸</span>}>
            <span aria-hidden="true">▾</span>
          </Show>
        </button>
        <span class="text-12-medium text-text-strong truncate">{props.name}</span>
      </div>
      <button
        data-testid={`pane-remove-${props.uri}`}
        type="button"
        class="text-text-weak hover:text-text-base shrink-0 ml-2"
        aria-label={`Remove ${props.name} from dock`}
        onClick={(e) => {
          e.stopPropagation()
          props.onRemove()
        }}
      >
        ×
      </button>
    </div>
  )
}
