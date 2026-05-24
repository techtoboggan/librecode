import type { DockState } from "./types"

export const PANE_MIN_HEIGHT = 80
export const PANE_HEADER_HEIGHT = 36

/**
 * Compute the rendered height (px) for a pane, given the dock's
 * available height and the entry's optional explicit override.
 * Falls back to equal distribution among un-overridden panes.
 */
export function paneHeight(state: DockState, entryUri: string, availablePx: number): number {
  const entry = state.entries.find((e) => e.uri === entryUri)
  if (!entry) return 0
  if (entry.collapsed) return PANE_HEADER_HEIGHT
  if (typeof entry.heightPx === "number") return Math.max(PANE_MIN_HEIGHT, entry.heightPx)
  // Default: equal share of remaining space after collapsed panes take
  // their fixed header height.
  const collapsed = state.entries.filter((e) => e.collapsed).length
  const expanded = state.entries.filter((e) => !e.collapsed)
  const remaining = availablePx - collapsed * PANE_HEADER_HEIGHT
  return Math.max(PANE_MIN_HEIGHT, remaining / Math.max(1, expanded.length))
}

/**
 * Apply a divider drag: the pane ABOVE gets +delta px, the pane BELOW
 * gets -delta px (with min-height clamps). Returns new state with
 * explicit heightPx for both affected panes.
 */
export function applyDividerDrag(
  state: DockState,
  aboveUri: string,
  belowUri: string,
  deltaPx: number,
  availablePx: number,
): DockState {
  const above = state.entries.findIndex((e) => e.uri === aboveUri)
  const below = state.entries.findIndex((e) => e.uri === belowUri)
  if (above === -1 || below === -1) return state
  const aboveH = paneHeight(state, aboveUri, availablePx)
  const belowH = paneHeight(state, belowUri, availablePx)
  const newAbove = Math.max(PANE_MIN_HEIGHT, aboveH + deltaPx)
  const newBelow = Math.max(PANE_MIN_HEIGHT, belowH - deltaPx)
  const next = state.entries.map((e, i) => {
    if (i === above) return { ...e, heightPx: newAbove }
    if (i === below) return { ...e, heightPx: newBelow }
    return e
  })
  return { ...state, entries: next }
}
