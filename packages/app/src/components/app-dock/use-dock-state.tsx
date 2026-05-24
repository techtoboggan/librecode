import { createContext, startTransition, untrack, useContext, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useSDK } from "@/context/sdk"
import type { McpAppResource } from "@/components/mcp-app-panel/types"
import { DOCK_STATE_KEY, type DockState } from "./types"
import {
  addEntry,
  defaultDockState,
  migrateDockState,
  removeEntry,
  setEntryCollapsed,
  setEntryHeight,
  setWidth,
  toggleVisibility,
} from "./state"
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
}

/** Exported for testing — wrap with DockContext.Provider to inject a mock. */
export const DockContext = createContext<DockContextValue>()

interface ProviderProps {
  children: JSX.Element
}

export function AppDockProvider(props: ProviderProps): JSX.Element {
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
  }

  return <DockContext.Provider value={value}>{props.children}</DockContext.Provider>
}

export function useAppDockState(): DockContextValue {
  const ctx = useContext(DockContext)
  if (!ctx) throw new Error("useAppDockState must be used inside <AppDockProvider>")
  return ctx
}
