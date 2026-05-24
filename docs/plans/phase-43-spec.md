# Phase 43 — Multi-pane Dock + Reorder + Collapse (Detailed Execution Spec)

> Written for an executor who hasn't been in the conversation that
> produced the roadmap. Self-contained brief: read this top to bottom
> and ship. Phase 42 (single-pane prototype) is already merged at
> v0.9.82; this builds directly on it.

---

## Goal (one sentence)

Extend the App Dock from one app to **N apps stacked vertically**, with
**drag-to-reorder**, **per-pane collapse**, and a **"+ Add"** affordance
that opens an app picker — still feature-flagged, still additive, still
zero disruption to the existing pinned-tab UX.

## What "done" looks like for THIS phase

A user with `experimental.app_dock = true` in their config:

1. Opens the dock. Currently empty.
2. Clicks "+ Add" at the bottom of the dock. A popover appears listing
   available MCP apps. Apps already in the dock are dimmed and labelled
   "in dock".
3. Clicks Session Stats → it appears as the first pane. Clicks "+ Add"
   again → picks Activity Graph → it appears below Session Stats.
   Adds Multica → three panes stacked vertically.
4. Clicks the collapse chevron in the Session Stats pane header. The
   pane body hides (iframe NOT unmounted — same `display:none` trick
   from Phase 42). The header remains. Click again to expand. Repeat
   the same gesture on Multica → both collapsed, just headers visible.
5. Grabs the drag handle on the Activity Graph pane header and drags
   it above Session Stats. The order updates. Refreshes the page. The
   new order persists.
6. Drags the **horizontal divider** between two panes up/down to
   reallocate vertical space. Refreshes the page. The custom heights
   survive.
7. Closes a pane with the "×" button. The remaining panes redistribute.

Existing functionality untouched: the legacy pinned-tab strip in the
session side panel still works. Both systems coexist for users with
mixed setups.

---

## Pre-flight: read these before touching code

### What Phase 42 shipped

Read [`docs/plans/phase-42-spec.md`](./phase-42-spec.md) and skim the
actual code at `packages/app/src/components/app-dock/`. Particularly:

- `types.ts` — types are already array-shaped (`entries: DockEntry[]`)
  in anticipation of this phase. The shape doesn't need to change.
- `state.ts` — `addEntry` / `removeEntry` already handle arrays. New
  functions needed: `reorderEntries`, `setEntryCollapsed`,
  `setEntryHeight`.
- `dock.tsx` — currently shows `entries[0]` as the only pane. Needs a
  loop for N panes + the pane-divider logic.
- `use-dock-state.tsx` — context API will gain `reorder`, `setCollapsed`,
  `setHeight` methods.

### CLAUDE.md rules (recap)

All the constraints from Phase 42 still apply. The relevant additions
for this phase:

- **`@thisbeyond/solid-dnd` is already a workspace dependency** (the
  file-tab strip uses it in `session-side-panel.tsx`). Use it for
  pane reorder — don't add a new drag library.
- **ADR-006 lint** runs over `app-dock/**` already (Phase 42 added the
  glob). Every new `createResource` call needs an `// adr-006:` comment.
- **File size**: stay well under 1000 lines per file. If `dock.tsx`
  approaches 300 lines, extract sub-components into siblings.
- **Atomic commits**: 10 named commits drafted at the bottom of this
  spec. Use them.

### PLAN.md numbering cleanup

PLAN.md currently has a numbering conflict:

- The **new** MCP-Apps overhaul roadmap claims Phases 42–51
  (`mcp-apps-overhaul-roadmap.md`).
- The **old** "Net-New Roadmap" section in PLAN.md has Phase 42b
  (Windows code-signing), Phase 43 (Linux AppImage updates), Phase 44
  (Plugin Marketplace), and Phase 45 (Enterprise features) sitting
  alongside the new entries.

**Fix as part of this phase:** renumber the old entries to 60+ to free
up 43–51 for the overhaul. The old items aren't going anywhere, they
just need different numbers:

| Old number | New number | What it is                                                           |
| ---------- | ---------- | -------------------------------------------------------------------- |
| Phase 42b  | Phase 60   | Windows code-signing + Store                                         |
| Phase 43   | Phase 61   | Linux AppImage auto-update                                           |
| Phase 44   | Phase 62   | (deprecated — superseded by Phase 41 marketplace plan; mark as such) |
| Phase 45   | Phase 63   | Enterprise features (post-1.0)                                       |

Update PLAN.md to reflect this. The MCP-Apps overhaul phases now own
42–51 cleanly.

---

## Files to create

### `packages/app/src/components/app-dock/divider.tsx` (~50 lines)

Horizontal drag handle that lives **between** two stacked panes. When
the user drags it, the pane ABOVE gets taller / shorter and the pane
BELOW gets the inverse. Pure component — receives `onResize(deltaPx)`
as a callback, doesn't reach into state directly.

```tsx
import { createSignal, onCleanup, type JSX } from "solid-js"

export interface PaneDividerProps {
  /** Called with each pointer-move while dragging. delta > 0 = drag down. */
  onResize: (deltaPx: number) => void
  /** Called once when drag ends. Used to persist the final values. */
  onResizeEnd?: () => void
}

export function PaneDivider(props: PaneDividerProps): JSX.Element {
  const [dragging, setDragging] = createSignal(false)
  let lastY = 0

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    lastY = e.clientY
    setDragging(true)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging()) return
    const delta = e.clientY - lastY
    lastY = e.clientY
    props.onResize(delta)
  }

  const onPointerUp = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement
    target.releasePointerCapture(e.pointerId)
    setDragging(false)
    props.onResizeEnd?.()
  }

  onCleanup(() => setDragging(false))

  return (
    <div
      data-testid="pane-divider"
      class="h-1 cursor-row-resize hover:bg-border-base shrink-0"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}
```

### `packages/app/src/components/app-dock/pane-header.tsx` (~80 lines)

Extracted from `dock.tsx`'s `DockPane`. Header bar with:

- Drag handle (the entire header is the drag target — uses the
  `@thisbeyond/solid-dnd` `useDraggable` hook).
- App name.
- Collapse chevron (toggles between ▾ expanded / ▸ collapsed).
- Remove button "×".

```tsx
import { createDraggable } from "@thisbeyond/solid-dnd"
import { type JSX, Show } from "solid-js"
import { IconButton } from "@librecode/ui/icon-button"

export interface PaneHeaderProps {
  uri: string
  name: string
  collapsed: boolean
  onToggleCollapse: () => void
  onRemove: () => void
}

export function PaneHeader(props: PaneHeaderProps): JSX.Element {
  // adr-006 N/A: no createResource here.
  // Draggable id is the stable dock URI — never written by event
  // handlers in this component.
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
          <Show when={!props.collapsed} fallback={<span>▸</span>}>
            <span>▾</span>
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
```

The Solid-DnD `use:draggable` directive needs the `createDraggable`
hook to be imported into the host module that uses it. Confirm the
exact pattern by looking at the existing
`packages/app/src/pages/session/session-side-panel.tsx` use of
`SortableTab` (which already uses solid-dnd).

### `packages/app/src/components/app-dock/add-app-popover.tsx` (~120 lines)

The "+ Add" button + popover. Fetches the list of available MCP apps,
shows them with "already in dock" indicators, calls `dock.add(app)` on
selection.

```tsx
import { createResource, For, Show, type JSX } from "solid-js"
import { Popover } from "@kobalte/core/popover"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { fetchAppList } from "@/components/mcp-app-panel/fetch"
import type { McpAppResource } from "@/components/mcp-app-panel/types"
import { useAppDockState } from "./use-dock-state"

export function AddAppPopover(): JSX.Element {
  const dock = useAppDockState()
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()

  // adr-006: keyed on sdk.url (mount-time stable). Fires once when the
  // popover is opened. NOT keyed on any dock-state signal so toggling
  // visibility / adding entries doesn't re-fetch.
  const [apps] = createResource(
    () => sdk.url,
    async () => fetchAppList(globalSDK.fetch, sdk.url, sdk.directory),
  )

  const isInDock = (uri: string) => dock.state().entries.some((e) => e.uri === uri)

  return (
    <Popover>
      <Popover.Trigger
        data-testid="dock-add-trigger"
        class="flex items-center justify-center gap-2 px-3 py-2 text-12-regular text-text-weak hover:text-text-base hover:bg-surface-raised-base-hover"
      >
        + Add app to dock
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 rounded-md border border-border-base bg-surface-panel shadow-lg max-w-sm">
          <Show when={apps()} fallback={<div class="p-3 text-12-regular text-text-weak">Loading apps…</div>}>
            {(list) => (
              <Show
                when={list().length > 0}
                fallback={
                  <div class="p-3 text-12-regular text-text-weak">
                    No MCP apps available. Configure an MCP server first.
                  </div>
                }
              >
                <For each={list()}>
                  {(app) => (
                    <button
                      data-testid={`dock-add-${app.uri}`}
                      type="button"
                      disabled={isInDock(app.uri)}
                      class="block w-full text-left px-3 py-2 text-12-regular hover:bg-surface-raised-base-hover disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => {
                        dock.add(app)
                      }}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-text-base truncate">{app.name}</span>
                        <Show when={isInDock(app.uri)}>
                          <span class="text-text-weaker text-11-regular shrink-0">in dock</span>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </Show>
            )}
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}
```

### `packages/app/src/components/app-dock/divider.test.tsx` (~50 lines)

- Renders. Pointer-down sets dragging. Pointer-move calls `onResize`
  with the y-delta. Pointer-up calls `onResizeEnd` exactly once.
- Multiple pointer-move events accumulate deltas correctly.
- A pointer-up without pointer-down is a no-op.

### `packages/app/src/components/app-dock/pane-header.test.tsx` (~80 lines)

- Renders name + URI in `data-uri`.
- Collapse button click fires `onToggleCollapse`.
- Remove button click fires `onRemove`.
- Collapsed state swaps the chevron glyph (▾ vs ▸).
- Click events `stopPropagation` so the parent draggable doesn't kick
  in on a collapse/remove click.

### `packages/app/src/components/app-dock/add-app-popover.test.tsx` (~100 lines)

- Fetches the app list on first open.
- Renders apps with their names.
- Apps already in the dock are `disabled` and show "in dock".
- Click on an available app calls `dock.add(app)`.
- Empty list shows empty-state copy.
- Loading state visible until fetch resolves.

Use `mock` to stub `fetchAppList`. Mock the dock context to inject
test state.

### `packages/app/src/components/app-dock/reorder.ts` (~40 lines, pure)

Pure helper for "move entry from index i to index j", with bounds
guards.

```ts
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
```

### `packages/app/src/components/app-dock/reorder.test.ts` (~80 lines)

8+ tests covering:

- Move from middle to end / end to middle / middle to middle.
- `from === to` → identity.
- Out-of-range → identity.
- Empty array → identity.
- Two-element array swap.
- `reorderEntriesByUri` with valid + invalid URIs.

### `packages/app/src/components/app-dock/sizing.ts` (~70 lines, pure)

Per-pane height management. The dock has a fixed total height
(the viewport minus the dock header/footer). Panes get a fractional
share by default; users can override with explicit pixel heights.

```ts
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
```

### `packages/app/src/components/app-dock/sizing.test.ts` (~80 lines)

8+ tests:

- All un-overridden panes get equal share.
- Collapsed pane takes only header height.
- Explicit `heightPx` is respected, clamped to MIN.
- `applyDividerDrag` adjusts above/below in opposite directions.
- Drag past min-height clamps both panes.
- Missing URI → identity.

---

## Files to modify

### `packages/app/src/components/app-dock/types.ts`

Add three fields to `DockEntry`:

```ts
export interface DockEntry {
  uri: string
  app: McpAppResource
  addedAt: number
  /** Phase 43 — when true, only the header is rendered; body iframe
   *  stays mounted (display:none) for state preservation. */
  collapsed?: boolean
  /** Phase 43 — explicit height in px. Undefined = equal share of
   *  un-overridden panes. */
  heightPx?: number
}
```

### `packages/app/src/components/app-dock/state.ts`

Add three new pure helpers and update `migrateDockState` to accept
the new optional fields. Don't break the Phase 42 contract — the new
fields are optional and migrate cleanly from old localStorage blobs.

```ts
export function setEntryCollapsed(state: DockState, uri: string, collapsed: boolean): DockState {
  const next = state.entries.map((e) => (e.uri === uri ? { ...e, collapsed } : e))
  // Skip identity check — collapsed toggle is idempotent enough that we
  // can return a new object every time without optimization complexity.
  return { ...state, entries: next }
}

export function setEntryHeight(state: DockState, uri: string, heightPx: number): DockState {
  const next = state.entries.map((e) => (e.uri === uri ? { ...e, heightPx } : e))
  return { ...state, entries: next }
}
```

Update `migrateDockState` to read `collapsed` (boolean fallback false)
and `heightPx` (number fallback undefined).

### `packages/app/src/components/app-dock/state.test.ts`

Add 6+ tests covering the new fields:

- `setEntryCollapsed` toggles. Missing URI → identity.
- `setEntryHeight` sets. Missing URI → identity.
- `migrateDockState` reads `collapsed: true` from raw input.
- `migrateDockState` reads `heightPx: 200` from raw input.
- `migrateDockState` defaults `collapsed` to `false` when missing.
- `migrateDockState` defaults `heightPx` to `undefined` when missing.

### `packages/app/src/components/app-dock/use-dock-state.tsx`

Add four new methods to the context value:

```ts
export interface DockContextValue {
  state: () => DockState
  toggle: () => void
  add: (app: McpAppResource) => void
  remove: (uri: string) => void
  resize: (width: number) => void
  /** Phase 43 */
  reorder: (draggedUri: string, overUri: string) => void
  setCollapsed: (uri: string, collapsed: boolean) => void
  setHeight: (uri: string, heightPx: number) => void
  applyDividerDrag: (aboveUri: string, belowUri: string, deltaPx: number, availablePx: number) => void
}
```

All wrapped in `startTransition` like the existing methods.

### `packages/app/src/components/app-dock/dock.tsx`

Major rewrite. The single-pane `<Show when={entry()}>` becomes a
`<For each={entries()}>`. Insert `<PaneDivider>` between consecutive
panes. Footer adds the `<AddAppPopover>`.

```tsx
import { createSignal, For, Show, type JSX } from "solid-js"
import { DragDropProvider, DragDropSensors, useDragDropContext } from "@thisbeyond/solid-dnd"
import { McpAppPanel } from "@/components/mcp-app-panel"
import type { McpAppResource } from "@/components/mcp-app-panel/types"
import { useAppDockState } from "./use-dock-state"
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "./types"
import { PaneHeader } from "./pane-header"
import { PaneDivider } from "./divider"
import { AddAppPopover } from "./add-app-popover"
import { paneHeight } from "./sizing"

export interface AppDockProps {
  sessionID?: string
  /** Phase 42 prop, kept for compatibility — used by empty state when
   *  the dock has no entries. */
  exampleApp?: McpAppResource
}

export function AppDock(props: AppDockProps): JSX.Element {
  const dock = useAppDockState()
  // ... resize handle logic (unchanged from Phase 42) ...
  // ... measure containerRef.clientHeight to compute availablePx ...

  return (
    <div /* ... outer wrapper, same as Phase 42 ... */>
      {/* resize handle, unchanged */}
      {/* content */}
      <Show when={dock.state().entries.length > 0} fallback={<EmptyDockState ... />}>
        <DragDropProvider /* ... */>
          <DragDropSensors />
          <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
            <For each={dock.state().entries}>
              {(entry, idx) => (
                <>
                  <DockPane
                    entry={entry}
                    sessionID={props.sessionID}
                    heightPx={paneHeight(dock.state(), entry.uri, availablePx())}
                  />
                  <Show when={idx() < dock.state().entries.length - 1}>
                    <PaneDivider
                      onResize={(delta) =>
                        dock.applyDividerDrag(
                          entry.uri,
                          dock.state().entries[idx() + 1].uri,
                          delta,
                          availablePx(),
                        )
                      }
                    />
                  </Show>
                </>
              )}
            </For>
          </div>
        </DragDropProvider>
      </Show>
      {/* footer with add button */}
      <Show when={dock.state().entries.length > 0}>
        <AddAppPopover />
      </Show>
    </div>
  )
}

// DockPane uses PaneHeader + collapsible body
function DockPane(props: { entry: DockEntry; sessionID?: string; heightPx: number }) {
  const dock = useAppDockState()
  return (
    <div style={{ height: `${props.heightPx}px`, "min-height": `${PANE_MIN_HEIGHT}px` }} class="flex flex-col overflow-hidden">
      <PaneHeader
        uri={props.entry.uri}
        name={props.entry.app.name}
        collapsed={props.entry.collapsed ?? false}
        onToggleCollapse={() => dock.setCollapsed(props.entry.uri, !(props.entry.collapsed ?? false))}
        onRemove={() => dock.remove(props.entry.uri)}
      />
      <div
        class="flex-1 min-h-0 overflow-hidden"
        style={{ display: props.entry.collapsed ? "none" : "flex" }}
      >
        <McpAppPanel
          server={props.entry.app.server}
          uri={props.entry.app.uri}
          sessionID={props.sessionID}
          appName={props.entry.app.name}
          class="h-full"
        />
      </div>
    </div>
  )
}
```

Wire DragDropProvider's `onDragEnd` to `dock.reorder(draggedId, overId)`.

### `packages/app/src/components/app-dock/dock.test.tsx`

Add 8+ new tests on top of existing:

- Multiple panes render simultaneously.
- Dividers appear between panes (N panes → N-1 dividers).
- Collapse one pane → body hidden, header visible.
- Iframe survives collapse toggle (`display:none`, not unmount).
- Divider drag calls `applyDividerDrag` with the right URIs.
- "+ Add" button appears when entries.length > 0.
- Reorder via drag updates dock state.
- Heights respect collapsed + explicit overrides.

### `packages/app/src/components/app-dock/index.ts`

Add new exports:

```ts
export { AppDock } from "./dock"
export { AppDockProvider, useAppDockState } from "./use-dock-state"
export { DockToggleButton } from "./toggle-button"
export type { DockEntry, DockState, DockVisibility } from "./types"
export { reorderEntries, reorderEntriesByUri } from "./reorder"
export { setEntryCollapsed, setEntryHeight } from "./state"
```

### `PLAN.md`

Do the renumbering cleanup (see "Pre-flight: PLAN.md numbering cleanup"
above):

- Phase 42b → Phase 60 (Windows code-signing)
- Phase 43 → Phase 61 (Linux AppImage)
- Phase 44 → Phase 62 (deprecated/superseded)
- Phase 45 → Phase 63 (Enterprise features)

Add the Phase 43 entry under the existing Phase 42 line:

```markdown
### Phase 43: Multi-pane Dock + Reorder + Collapse ✅

Detail: `docs/plans/phase-43-spec.md`
ADR: `docs/adr/009-app-dock.md` (updated in-place — same ADR, just
phase status moves from "Prototype" to "Multi-pane")

[ ... ship summary ... ]
```

### `docs/adr/009-app-dock.md`

Update the status from "Prototype (Phase 42)" to "Multi-pane (Phase 43)"
and append a "Phase 43 changelog" subsection documenting what changed:
multi-pane support, reorder, collapse, dividers, add-app popover.

---

## Tests required

**Total: ~35 new tests** distributed across:

### Pure logic (Bun, no DOM)

1. `state.test.ts` — 6 new tests for the new helpers (setEntryCollapsed,
   setEntryHeight, migrate w/ new fields).
2. `reorder.test.ts` — 8 tests.
3. `sizing.test.ts` — 8 tests.

### Solid component (Bun + happy-dom via `bun run test:unit`)

4. `divider.test.tsx` — 4 tests.
5. `pane-header.test.tsx` — 5 tests.
6. `add-app-popover.test.tsx` — 6 tests.
7. `dock.test.tsx` — 8 new tests on top of Phase 42's.

### BDD / E2E (Playwright)

8. Extend `packages/app/e2e/app-dock.spec.ts` with new scenarios:

```gherkin
Scenario: add multiple apps to the dock
  When I open the app dock
  And I add Session Stats
  And I add Activity Graph
  Then the dock should show 2 panes
  And the panes should appear in add order

Scenario: collapse a pane preserves its iframe state
  Given the dock has Session Stats added
  When I collapse the Session Stats pane
  Then only the Session Stats header should be visible
  And the iframe element should still be present in the DOM

Scenario: reorder via drag
  Given the dock has Session Stats and Activity Graph
  When I drag Activity Graph above Session Stats
  Then Activity Graph should be the first pane
  And the order should persist across reload

Scenario: resize pane via divider
  Given the dock has 2 panes
  When I drag the divider down 50px
  Then the upper pane should be taller
  And the lower pane should be shorter
  And the heights should persist across reload

Scenario: "+ Add" filters out already-added apps
  Given the dock has Session Stats added
  When I open the "+ Add" popover
  Then Session Stats should be marked "in dock"
  And the Session Stats button should be disabled
```

### Lint enforcement

9. ADR-006 lint stays clean — every `createResource` in the new files
   carries an `// adr-006:` comment (the popover's app-list fetch is
   the one new resource).

---

## Step-by-step execution order

Same discipline as Phase 42: each step ends in a known-good state.
Don't skip steps.

### Step 1 — Recon

- Re-read `phase-42-spec.md` execution-order section.
- Read the current `app-dock/dock.tsx` so you know what's already
  there.
- Read `session-side-panel.tsx`'s `SortableTab` usage for the
  solid-dnd pattern.
- Run `bun run typecheck && bun run lint` — confirm clean baseline.

### Step 2 — Pure helpers

- Create `reorder.ts` + `reorder.test.ts`.
- Create `sizing.ts` + `sizing.test.ts`.
- Update `types.ts` with `collapsed` + `heightPx`.
- Update `state.ts` with `setEntryCollapsed`, `setEntryHeight`, and
  the `migrateDockState` extension.
- Update `state.test.ts` with the new cases.
- `cd packages/app && bun run test:unit` — all green.

### Step 3 — Context API expansion

- Update `use-dock-state.tsx` with the new methods (reorder,
  setCollapsed, setHeight, applyDividerDrag).
- `bun run typecheck` — clean.

### Step 4 — Sub-components

- Create `divider.tsx` + `divider.test.tsx`.
- Create `pane-header.tsx` + `pane-header.test.tsx`.
- `bun run test:unit` — green.

### Step 5 — Add-app popover

- Create `add-app-popover.tsx` + `add-app-popover.test.tsx`.
- Mock `fetchAppList` in tests.
- `bun run test:unit` — green.

### Step 6 — Dock component rewrite

- Rewrite `dock.tsx` to multi-pane with `<For>` + dividers + the
  drag-drop wiring. Extract `DockPane` as a sibling helper (private
  to the module — don't export).
- Update `dock.test.tsx` with multi-pane scenarios.
- `bun run test:unit` — green.

### Step 7 — Barrel exports

- Update `app-dock/index.ts`.
- `bun run typecheck` — clean.

### Step 8 — Manual smoke test

- Local config: `experimental.app_dock = true`.
- `bun run dev` — verify:
  - Empty dock + "+ Add" popover works.
  - Add 3 apps. Three stacks render. Dividers visible.
  - Collapse pane 2. Pane 1 + 3 redistribute. Refresh — collapse persists.
  - Drag pane 3 above pane 1. Order updates. Refresh — order persists.
  - Drag divider between pane 1 and pane 2 up by 80px. Heights change.
    Refresh — heights persist.
  - Remove pane 2 via the × button. Remaining panes redistribute.

### Step 9 — BDD/E2E

- Extend `packages/app/e2e/app-dock.spec.ts` with the new scenarios.
- `cd packages/app && bun run test:e2e:local` — green.

### Step 10 — ADR + PLAN updates

- Update `docs/adr/009-app-dock.md` (status → Multi-pane).
- Update `PLAN.md`:
  - Add Phase 43 entry under Phase 42.
  - Renumber the OLD Phase 42b/43/44/45 entries to 60/61/62/63.
- `bunx prettier --check PLAN.md docs/adr/009-app-dock.md` — clean.

### Step 11 — Final verification

- `bun run typecheck` → clean.
- `bun run lint` → clean (incl. adr-006).
- `cd packages/app && bun run test:unit` → all green, ~35 new tests.
- `cd packages/librecode && bun run test:unit` → no regressions.

### Step 12 — Atomic commits (use these subjects)

1. `feat(app-dock): pure reorder + sizing helpers (Phase 43)`
2. `feat(app-dock): state helpers for collapsed + heightPx`
3. `feat(app-dock): expand context API with reorder/collapse/resize`
4. `feat(app-dock): PaneDivider + PaneHeader components`
5. `feat(app-dock): AddAppPopover with already-in-dock indicators`
6. `feat(app-dock): multi-pane dock with reorder + collapse + dividers`
7. `test(app-dock): BDD scenarios for Phase 43 multi-pane behavior`
8. `docs(adr): ADR-009 status → Multi-pane (Phase 43)`
9. `docs(plan): Phase 43 + renumber legacy roadmap items to 60-series`

### Step 13 — Bump + push

- Bump to v0.9.83 across all package.jsons + Cargo.toml.
- Commit: `chore: bump version to 0.9.83`.
- Tag `v0.9.83`. Push.
- Watch the release pipeline (~14 min based on v0.9.82 timing).

---

## Verification checklist

- [ ] All new files exist; each ≤ 200 lines.
- [ ] `bun run typecheck` clean.
- [ ] `bun run lint` clean (biome + adr-006 with all `app-dock/`
      files scanned).
- [ ] `cd packages/app && bun run test:unit` — all green.
- [ ] `cd packages/librecode && bun run test:unit` — no regressions.
- [ ] BDD scenarios pass.
- [ ] Manual smoke test (Step 8 above) — every bullet works.
- [ ] PLAN.md renumbering done; no duplicate phase numbers.
- [ ] ADR-009 status updated.
- [ ] v0.9.83 release pipeline green.

---

## Common pitfalls

### 1. Iframe re-mount on reorder

When you reorder panes, Solid's `<For>` will re-key the items. If the
key is index-based (`<For each={entries()} key={(e, i) => i}>`), the
iframes get remounted on every reorder and lose state.

**Fix:** key on the URI: `<For each={entries()}>` (Solid's default
keys array items by reference identity, which works as long as the
entry objects are stable). Or explicitly with a keyed loop using URI.

Test this manually: add Session Stats, scroll to a specific number,
add Multica, drag Multica above Stats, verify Stats's scroll position
preserved.

### 2. Divider math edge cases

When a user drags a divider past a pane's min-height, both panes
should clamp gracefully — not become negative. The `sizing.ts` tests
cover this; double-check the divider drag handler honors them.

### 3. solid-dnd nested with Popover

The "+ Add" popover uses Kobalte's Popover. The dock uses solid-dnd's
DragDropProvider. These don't naturally compose — make sure the
Popover.Portal renders OUTSIDE the DragDropProvider's DOM subtree so
clicks inside the popover don't get intercepted by the drag context.

### 4. Phase 42 tests must still pass

The Phase 42 single-pane behavior is preserved — when `entries.length
=== 1` and `collapsed === false`, the dock should look identical to
how it does today. Phase 42's tests should pass unchanged. If they
don't, you're regressing the single-pane case.

### 5. AddAppPopover's `createResource` and ADR-006

The popover fetches the app list via `createResource`. This is a new
resource in a danger-zone file. It must carry the `// adr-006:` comment
explaining what stable value it keys on (`sdk.url`).

If you forget, the pre-commit hook will block the commit. Don't
bypass it — add the comment.

### 6. PLAN.md renumbering — don't lose the old content

When renumbering Phase 42b → 60, don't just delete the old entry. Move
the entire content block to its new number. The Windows code-signing
phase is real future work; we're just freeing up the lower numbers
for the overhaul arc.

---

## When you're done

Report back with:

- The 10 commit IDs (matching the subjects in Step 12).
- The v0.9.83 release URL.
- Test count delta (e.g., "534 → 569 app tests, +35").
- Confirmation that the manual smoke test (Step 8) passed.
- Any deviations from this spec with rationale.
- Any pitfalls hit that aren't in this doc — they go in the Phase 44
  spec's pitfall list.

Update PLAN.md's `Last updated` line to today's date + the new test
count + version. Don't delete this spec — Phase 44 will reference it.
