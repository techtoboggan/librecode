import {
  type DockEntry,
  type DockState,
  type DockVisibility,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
} from "./types"

/** Clamp a width value to the allowed range. Returns DEFAULT for NaN. */
export function clampWidth(value: number): number {
  if (Number.isNaN(value)) return DOCK_DEFAULT_WIDTH
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, value))
}

/**
 * Default state for a workspace that's never used the dock.
 *
 * Phase 48 (v0.9.88) flipped `experimental.app_dock` to default-on but
 * shipped this default as `visibility: "hidden"`. Result: users who got
 * their pinned apps auto-migrated to the dock saw "in dock" indicators
 * in the Start menu but the dock itself stayed invisible unless they
 * discovered the Ctrl+\ shortcut or the dot-grid button in the session
 * header. v0.9.91 ships `visibility: "visible"` as the default — users
 * who explicitly hid the dock keep their preference because
 * `migrateDockState` reads the persisted `visibility` field when present.
 */
export function defaultDockState(): DockState {
  return { visibility: "visible", width: DOCK_DEFAULT_WIDTH, entries: [] }
}

/** Guard a raw value to see if it is a valid DockVisibility. */
function isVisibility(v: unknown): v is DockVisibility {
  return v === "hidden" || v === "visible"
}

/**
 * Migrate raw localStorage values that may be malformed / from a future schema.
 * Always returns a fully valid DockState with sensible defaults for any
 * missing or invalid fields. Designed to be forward-compatible: unknown
 * fields in `entries` items are dropped, arrays that aren't arrays become [].
 */
export function migrateDockState(raw: unknown): DockState {
  const defaults = defaultDockState()
  if (!raw || typeof raw !== "object") return defaults

  const obj = raw as Record<string, unknown>

  const visibility = isVisibility(obj.visibility) ? obj.visibility : defaults.visibility
  const width = clampWidth(typeof obj.width === "number" ? obj.width : defaults.width)

  const rawEntries = Array.isArray(obj.entries) ? obj.entries : []
  const entries: DockEntry[] = []
  for (const item of rawEntries) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    if (typeof rec.uri !== "string" || !rec.uri) continue
    if (typeof rec.addedAt !== "number") continue
    const app = rec.app
    if (!app || typeof app !== "object") continue
    const a = app as Record<string, unknown>
    if (typeof a.server !== "string" || !a.server) continue
    if (typeof a.name !== "string" || !a.name) continue
    if (typeof a.uri !== "string" || !a.uri) continue
    entries.push({
      uri: rec.uri,
      addedAt: rec.addedAt,
      app: {
        server: a.server,
        name: a.name,
        uri: a.uri,
        description: typeof a.description === "string" ? a.description : undefined,
      },
      collapsed: typeof rec.collapsed === "boolean" ? rec.collapsed : false,
      heightPx: typeof rec.heightPx === "number" ? rec.heightPx : undefined,
      detached: typeof rec.detached === "boolean" ? rec.detached : false,
    })
  }

  // Phase 44 — treat 0 as "not migrated": a timestamp of 0 would mean
  // "migrated at the Unix epoch", which indicates a serialisation bug.
  const migratedFromPinnedAt =
    typeof obj.migratedFromPinnedAt === "number" && obj.migratedFromPinnedAt > 0 ? obj.migratedFromPinnedAt : undefined

  return { visibility, width, entries, migratedFromPinnedAt }
}

/** Add an entry. No-op if URI already present. Returns new state. */
export function addEntry(state: DockState, entry: Omit<DockEntry, "addedAt">): DockState {
  if (state.entries.some((e) => e.uri === entry.uri)) return state
  return { ...state, entries: [...state.entries, { ...entry, addedAt: Date.now() }] }
}

/** Remove by URI. No-op if not present. Returns new state. */
export function removeEntry(state: DockState, uri: string): DockState {
  const next = state.entries.filter((e) => e.uri !== uri)
  if (next.length === state.entries.length) return state
  return { ...state, entries: next }
}

/** Toggle visibility. Returns new state. */
export function toggleVisibility(state: DockState): DockState {
  return { ...state, visibility: state.visibility === "hidden" ? "visible" : "hidden" }
}

/** Set width — clamps to allowed range. Returns new state. */
export function setWidth(state: DockState, width: number): DockState {
  return { ...state, width: clampWidth(width) }
}

/** Set collapsed flag on an entry. Missing URI → identity. Returns new state. */
export function setEntryCollapsed(state: DockState, uri: string, collapsed: boolean): DockState {
  if (!state.entries.some((e) => e.uri === uri)) return state
  return { ...state, entries: state.entries.map((e) => (e.uri === uri ? { ...e, collapsed } : e)) }
}

/** Set explicit height on an entry. Missing URI → identity. Returns new state. */
export function setEntryHeight(state: DockState, uri: string, heightPx: number): DockState {
  if (!state.entries.some((e) => e.uri === uri)) return state
  return { ...state, entries: state.entries.map((e) => (e.uri === uri ? { ...e, heightPx } : e)) }
}

/** Mark an entry as detached (popped out to its own window). No-op if entry doesn't exist. */
export function detachEntry(state: DockState, uri: string): DockState {
  return {
    ...state,
    entries: state.entries.map((e) => (e.uri === uri ? { ...e, detached: true } : e)),
  }
}

/** Mark an entry as attached (un-detach). No-op if entry doesn't exist. */
export function reattachEntry(state: DockState, uri: string): DockState {
  return {
    ...state,
    entries: state.entries.map((e) => (e.uri === uri ? { ...e, detached: false } : e)),
  }
}
