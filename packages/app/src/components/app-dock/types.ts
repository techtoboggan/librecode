import type { McpAppResource } from "@/components/mcp-app-panel/types"

/** A single entry in the dock. */
export interface DockEntry {
  /** Stable identifier — uses the app's MCP `ui://` URI. */
  uri: string
  /** The full MCP app resource, captured at add-time. */
  app: McpAppResource
  /** When the entry was added — used for diagnostics, not display. */
  addedAt: number
  /** Phase 43 — when true, only the header is rendered; body iframe
   *  stays mounted (display:none) for state preservation. */
  collapsed?: boolean
  /** Phase 43 — explicit height in px. Undefined = equal share of
   *  un-overridden panes. */
  heightPx?: number
  /** Phase 49 — true when this app is currently popped out into its own Tauri window. */
  detached?: boolean
}

/** Dock visibility states. */
export type DockVisibility = "hidden" | "visible"

/** Persisted-to-disk shape of the dock's state. */
export interface DockState {
  visibility: DockVisibility
  /** Dock pane width in px. Clamped to [MIN_WIDTH, MAX_WIDTH] on load. */
  width: number
  /** v0.9.x prototype — single entry only. Array shape for Phase 43 extension. */
  entries: DockEntry[]
  /**
   * Phase 44 — timestamp (ms since epoch) when the legacy pinned-apps
   * → dock migration ran for this workspace. Set once on first
   * AppDockProvider mount; never cleared. Undefined = migration has
   * not yet run.
   */
  migratedFromPinnedAt?: number
}

export const DOCK_MIN_WIDTH = 280
export const DOCK_MAX_WIDTH = 600
export const DOCK_DEFAULT_WIDTH = 320

/** localStorage key suffix (combines with workspace prefix). */
export const DOCK_STATE_KEY = "app-dock-state"
