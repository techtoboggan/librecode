import { Popover } from "@kobalte/core/popover"
import { Show, type JSX } from "solid-js"
import type { PaneStatus } from "./pane-status"

export interface PaneMenuProps {
  uri: string
  appName: string
  status: PaneStatus
  onReconnect: () => void
  onViewError: () => void
  onRemove: () => void
  /**
   * Phase 50b — when true, show the "Always keep loaded" toggle item.
   * Hidden for built-in apps (they're always kept alive regardless).
   */
  canAlwaysKeepLoaded?: boolean
  /** Phase 50b — current alwaysLoaded state (checked vs unchecked). */
  alwaysLoaded?: boolean
  /** Phase 50b — called when the user clicks the toggle item. */
  onToggleAlwaysLoaded?: () => void
  /** Phase 55 — when provided, show a "Disconnect" item that drops this app's
   *  session permission grants + closes its bridge (keeps the pane). Distinct
   *  from onRemove (unpins). Omitted while no live bridge exists. */
  onDisconnect?: () => void
}

export function PaneMenu(props: PaneMenuProps): JSX.Element {
  return (
    <Popover>
      <Popover.Trigger
        data-testid={`pane-menu-${props.uri}`}
        class="text-text-weak hover:text-text-base shrink-0 ml-1 px-1"
        aria-label={`${props.appName} menu`}
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        ⋮
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 min-w-[180px] rounded-md border border-border-weak-base bg-surface-float-base shadow-lg p-1">
          <Show when={props.status.recoverable}>
            <MenuItem testId={`pane-menu-reconnect-${props.uri}`} onClick={props.onReconnect}>
              Reconnect
            </MenuItem>
          </Show>
          <Show when={props.status.kind === "failed" && !!props.status.error}>
            <MenuItem testId={`pane-menu-view-error-${props.uri}`} onClick={props.onViewError}>
              View error
            </MenuItem>
          </Show>
          {/* Phase 50b — "Always keep loaded" toggle for non-builtin apps. */}
          <Show when={props.canAlwaysKeepLoaded}>
            <button
              data-testid={`pane-menu-always-loaded-${props.uri}`}
              type="button"
              role="menuitemcheckbox"
              aria-checked={props.alwaysLoaded ?? false}
              class="block w-full text-left px-3 py-1.5 text-12-regular rounded-sm hover:bg-surface-raised-base-hover text-text-base"
              onClick={(e: MouseEvent) => {
                e.stopPropagation()
                props.onToggleAlwaysLoaded?.()
              }}
            >
              <span aria-hidden="true">{props.alwaysLoaded ? "✓ " : "  "}</span>Always keep loaded
            </button>
          </Show>
          {/* Phase 55 — Disconnect drops session permission grants + closes the
              bridge but keeps the pane; Remove (below) unpins it entirely. */}
          <Show when={props.onDisconnect}>
            <MenuItem testId={`pane-menu-disconnect-${props.uri}`} onClick={() => props.onDisconnect?.()}>
              Disconnect
            </MenuItem>
          </Show>
          <MenuItem testId={`pane-menu-remove-${props.uri}`} onClick={props.onRemove} variant="danger">
            Remove from dock
          </MenuItem>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

interface MenuItemProps {
  testId: string
  onClick: () => void
  variant?: "default" | "danger"
  children: JSX.Element
}

function MenuItem(props: MenuItemProps): JSX.Element {
  const cls = () => (props.variant === "danger" ? "text-text-danger-base" : "text-text-base")
  return (
    <button
      data-testid={props.testId}
      type="button"
      class={`block w-full text-left px-3 py-1.5 text-12-regular rounded-sm hover:bg-surface-raised-base-hover ${cls()}`}
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        props.onClick()
      }}
    >
      {props.children}
    </button>
  )
}
