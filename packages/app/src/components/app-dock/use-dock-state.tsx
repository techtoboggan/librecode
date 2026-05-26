import { batch, createContext, createSignal, onMount, startTransition, untrack, useContext, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useSDK } from "@/context/sdk"
import { usePinnedApps } from "@/context/pinned-apps"
import type { McpAppResource } from "@/components/mcp-app-panel/types"
import { showToast } from "@librecode/ui/toast"
import { DOCK_STATE_KEY, type DockState } from "./types"
import {
  addEntry,
  defaultDockState,
  detachEntry,
  migrateDockState,
  reattachEntry,
  removeEntry,
  setEntryCollapsed,
  setEntryHeight,
  setWidth,
  toggleVisibility,
} from "./state"
import { planLegacyMigration, markMigrated } from "./migration"
import { reorderEntriesByUri } from "./reorder"
import { applyDividerDrag as applyDividerDragFn } from "./sizing"

export interface DockContextValue {
  state: () => DockState
  toggle: () => void
  add: (app: McpAppResource) => void
  remove: (uri: string) => void
  resize: (width: number) => void
  /** Phase 43 — move the pane identified by draggedUri to the position of overUri. */
  reorder: (draggedUri: string, overUri: string) => void
  /** Phase 43 — toggle collapsed state on a pane. */
  setCollapsed: (uri: string, collapsed: boolean) => void
  /** Phase 43 — set explicit pixel height on a pane. */
  setHeight: (uri: string, heightPx: number) => void
  /** Phase 43 — apply a divider drag between two adjacent panes. */
  applyDividerDrag: (aboveUri: string, belowUri: string, deltaPx: number, availablePx: number) => void
  /** Phase 49 — mark an entry as detached (popped out to its own Tauri window). */
  detach: (uri: string) => void
  /** Phase 49 — un-detach an entry (re-attach it to the dock inline). */
  reattach: (uri: string) => void
  /**
   * Phase 50b — set of app URIs that have emitted at least one
   * `mcp-app-state:save` message this session. Transient (resets
   * on dock unmount/reload). Used by shouldKeepIframeAlive.
   */
  observedRelay: () => ReadonlySet<string>
  /**
   * Phase 50b — record that an app has been observed emitting
   * state-relay save traffic. Idempotent; uses batch() internally.
   */
  markRelayObserved: (uri: string) => void
}

/** Exported for testing — wrap with DockContext.Provider to inject a mock. */
export const DockContext = createContext<DockContextValue>()

interface ProviderProps {
  children: JSX.Element
}

export function AppDockProvider(props: ProviderProps): JSX.Element {
  // Phase 50b — transient set of URIs observed emitting state-relay saves.
  // Resets on dock provider unmount (workspace switch effectively resets it
  // because the provider is workspace-scoped and remounts on navigation).
  const [observedRelaySet, setObservedRelaySet] = createSignal<ReadonlySet<string>>(new Set<string>())

  // adr-006: keyed on sdk.directory which is mount-time stable. The
  // persisted store fires NO createResource directly here — it uses
  // synchronous localStorage hydration. Visibility/width changes mutate
  // the store but don't trigger any resource loads under this provider.
  const sdk = useSDK()
  const dir = untrack(() => sdk.directory)
  const target = Persist.workspace(dir, DOCK_STATE_KEY)
  const [store, setStore] = persisted(
    { ...target, migrate: migrateDockState },
    createStore<DockState>(defaultDockState()),
  )

  // Phase 44 — one-shot legacy pinned-apps migration.
  // PinnedAppsProvider wraps AppDockProvider in session.tsx, so
  // usePinnedApps() is always available here.
  const pinnedApps = usePinnedApps()
  onMount(() => {
    // One-shot read — don't subscribe reactively so future pin/unpin
    // actions don't re-trigger migration. (ADR-006: no reactive source
    // coupling on a user interaction.)
    const snapshot = untrack(() => pinnedApps.pinned())
    const next = planLegacyMigration(store as DockState, snapshot)
    if (next !== null) {
      void startTransition(() => setStore(next))
      // Toast only when we actually seeded entries from legacy pins.
      if (snapshot.length > 0 && (store as DockState).entries.length === 0) {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: `Restored ${snapshot.length} app${snapshot.length === 1 ? "" : "s"} from your tab pins`,
          description: "Find them in the App Dock on the right.",
        })
      }
    } else if (typeof (store as DockState).migratedFromPinnedAt !== "number") {
      // No legacy pins and no migration needed — still mark migrated so we
      // don't run through this check on every subsequent mount.
      void setStore(markMigrated(store as DockState))
    }
  })

  const state = () => store as DockState
  const toggle = () => void startTransition(() => setStore(toggleVisibility(store as DockState)))
  const add = (app: McpAppResource) =>
    void startTransition(() => setStore(addEntry(store as DockState, { uri: app.uri, app })))
  const remove = (uri: string) => void startTransition(() => setStore(removeEntry(store as DockState, uri)))
  const resize = (width: number) => setStore(setWidth(store as DockState, width))
  const reorder = (draggedUri: string, overUri: string) =>
    void startTransition(() => setStore(reorderEntriesByUri(store as DockState, draggedUri, overUri)))
  const setCollapsed = (uri: string, collapsed: boolean) =>
    void startTransition(() => setStore(setEntryCollapsed(store as DockState, uri, collapsed)))
  const setHeight = (uri: string, heightPx: number) =>
    void startTransition(() => setStore(setEntryHeight(store as DockState, uri, heightPx)))
  const applyDividerDrag = (aboveUri: string, belowUri: string, deltaPx: number, availablePx: number) =>
    setStore(applyDividerDragFn(store as DockState, aboveUri, belowUri, deltaPx, availablePx))
  const detach = (uri: string) => void startTransition(() => setStore(detachEntry(store as DockState, uri)))
  const reattach = (uri: string) => void startTransition(() => setStore(reattachEntry(store as DockState, uri)))

  // Phase 50b — mark a URI as having observed state-relay traffic.
  // Idempotent: if the URI is already in the set, skip the update.
  const markRelayObserved = (uri: string): void => {
    batch(() => {
      const current = observedRelaySet()
      if (current.has(uri)) return
      const next = new Set(current)
      next.add(uri)
      setObservedRelaySet(next)
    })
  }

  const value: DockContextValue = {
    state,
    toggle,
    add,
    remove,
    resize,
    reorder,
    setCollapsed,
    setHeight,
    applyDividerDrag,
    detach,
    reattach,
    observedRelay: observedRelaySet,
    markRelayObserved,
  }

  return <DockContext.Provider value={value}>{props.children}</DockContext.Provider>
}

export function useAppDockState(): DockContextValue {
  const ctx = useContext(DockContext)
  if (!ctx) throw new Error("useAppDockState must be used inside <AppDockProvider>")
  return ctx
}
