import type { DockState } from "./types"

/**
 * Move the entry at index `from` to index `to`. No-op if either index
 * is out of range or `from === to`. Returns a new state with the
 * entries array reordered.
 */
export function reorderEntries(state: DockState, from: number, to: number): DockState {
  const n = state.entries.length
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return state
  const next = [...state.entries]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return { ...state, entries: next }
}

/**
 * Reorder by URI rather than index — convenient for solid-dnd drop handlers
 * which give us the dragged + over IDs as strings.
 */
export function reorderEntriesByUri(state: DockState, draggedUri: string, overUri: string): DockState {
  const from = state.entries.findIndex((e) => e.uri === draggedUri)
  const to = state.entries.findIndex((e) => e.uri === overUri)
  if (from === -1 || to === -1) return state
  return reorderEntries(state, from, to)
}
