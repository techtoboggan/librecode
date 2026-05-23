import type { JSX } from "solid-js"
import { IconButton } from "@librecode/ui/icon-button"
import { useAppDockState } from "./use-dock-state"

/**
 * Thin toggle button for the session header. Calls `dock.toggle()` on click.
 * Must be rendered inside <AppDockProvider>.
 */
export function DockToggleButton(): JSX.Element {
  const dock = useAppDockState()
  const label = () => (dock.state().visibility === "visible" ? "Hide app dock" : "Show app dock")

  return (
    <IconButton
      icon="dot-grid"
      variant="ghost"
      onClick={() => dock.toggle()}
      aria-label={label()}
      title={`Toggle app dock (${typeof navigator !== "undefined" && navigator.platform.startsWith("Mac") ? "Cmd" : "Ctrl"}+\\)`}
    />
  )
}
