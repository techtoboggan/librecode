import { type JSX } from "solid-js"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

/**
 * Placeholder shown in the dock when an app has been popped out into
 * its own window. Includes "Focus window" and "Bring back to dock" actions.
 *
 * Phase 49 — replaces the iframe when DockEntry.detached === true.
 */
export interface PaneDetachedPlaceholderProps {
  app: McpAppResource
  onReattach: () => void
  onFocus: () => void
}

export function PaneDetachedPlaceholder(props: PaneDetachedPlaceholderProps): JSX.Element {
  return (
    <div
      data-testid={`detached-placeholder-${props.app.uri}`}
      class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center bg-background-subtle"
    >
      <div class="text-12-medium text-text-weak">{props.app.name} is detached</div>
      <div class="text-11-regular text-text-weaker max-w-64">
        This app is running in its own window. Bring it back to the dock or focus the window.
      </div>
      <div class="flex gap-2 mt-2">
        <button
          type="button"
          data-testid={`detached-placeholder-focus-${props.app.uri}`}
          class="text-11-medium text-text-weak hover:text-text-base px-2 py-1 rounded-md border border-border-weaker-base"
          onClick={() => props.onFocus()}
        >
          Focus window
        </button>
        <button
          type="button"
          data-testid={`detached-placeholder-reattach-${props.app.uri}`}
          class="text-11-medium text-text-base hover:text-accent-strong px-2 py-1 rounded-md bg-accent-subtle"
          onClick={() => props.onReattach()}
        >
          Bring back to dock
        </button>
      </div>
    </div>
  )
}
