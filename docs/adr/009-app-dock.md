# ADR-009: App Dock as first-class layout for MCP apps

Date: 2026-05-23
Status: Legacy migration (Phase 44)

## Context

Through Phases 15–32 LibreCode shipped MCP-Apps support as a series of
patches against the session side panel's tab strip. The result mixed
seven categories of tabs into one horizontal strip:

- Review / Timeline / Context / file tabs — session-scoped, ephemeral
- Pinned MCP apps — workspace-scoped, durable
- Port previews — environment-scoped, transient

These categories have different lifecycles, owners, and interaction
models. A single horizontal strip forces them into a shared UX that
serves none of them well. The full friction inventory is in
`docs/plans/mcp-apps-ux-redesign.md`.

Specific problems with the old design:

1. **Tab overflow.** Heavy workspaces (5+ pinned apps, multiple file
   tabs) overflow the strip into a scrollable area that users miss.
2. **Lifecycle mismatch.** Closing the review panel also hides pinned
   apps, confusing users who want both open simultaneously.
3. **Suspense coupling.** Every additional tab that hosts a
   `createResource` extends the surface area of the session Suspense
   boundary (ADR-006 incidents v0.9.54, .58, .70, .71).

## Decision

Pinned MCP apps move to a dedicated right-side **App Dock** — a
resizable pane that is independent of the session side panel. The
session tab strip keeps only session-scoped content (Review, Timeline,
Context, file tabs, port previews).

Key properties of the dock:

- **Workspace-scoped.** State persists per directory via localStorage
  (`Persist.workspace`) so apps survive session switches and restarts.
- **Additive.** The dock coexists with the existing pinned-tabs system
  during Phases 42–43; both coexist without conflict.
- **Feature-flagged.** Controlled by `experimental.app_dock` in
  `librecode.jsonc`. Default OFF. Users opt in explicitly.
- **Iframe-preserving.** Visibility toggling (`Ctrl+\`) uses
  `display:none` rather than unmounting the McpAppPanel, so the iframe,
  AppBridge, and postMessage transport survive hide/show cycles.
- **ADR-006 safe.** No `createResource` in the dock is keyed on a
  signal written by a user event handler. The persisted store uses
  synchronous localStorage hydration (no async resource). See
  `use-dock-state.tsx` for the justification comment.

Phase 42 shipped the prototype: single-pane, no multi-app, no reorder.
Phase 43 extends to the full multi-pane model (see Phase 43 changelog
below). Subsequent phases (44–51) continue the overhaul. See
`docs/plans/mcp-apps-overhaul-roadmap.md`.

## Consequences

**For users:** MCP apps can live in the dock independently of the review
panel. Ctrl+\\ toggles the dock without affecting the session transcript
or the review panel. Dock state (which app, width) survives restarts.

**For contributors:** New MCP apps that should appear in the dock are
added via `dock.add(McpAppResource)`. Do NOT add new tabs to the session
side panel's tab strip for MCP apps. The `app-dock/` component subtree
is in the ADR-006 danger zone — every `createResource` call must carry
an `// adr-006:` justification comment.

**For app authors:** No change. The dock hosts a `McpAppPanel` with the
same `server` / `uri` props as the tab-strip version. AppBridge and
theme injection work identically.

## Alternatives considered

**Option B — Floating overlay panel.** An absolute-positioned panel
that slides over the session content. Rejected: hides the transcript,
conflicts with portal-rendered modals, and requires z-index management
across Tauri WebView and desktop window layers.

**Option C — Detached Tauri window (first).** Ship the dock as a
separate Tauri window from day one. Rejected: too much surface area for
the prototype. Phase 49 will add this as an option once the single-pane
dock is validated.

## File references

- Implementation: `packages/app/src/components/app-dock/`
- Session integration: `packages/app/src/pages/session.tsx`
- Config flag: `packages/librecode/src/config/schema.ts` (`experimental.app_dock`)
- Phase 42 spec: `docs/plans/phase-42-spec.md`
- Phase 43 spec: `docs/plans/phase-43-spec.md`
- Roadmap: `docs/plans/mcp-apps-overhaul-roadmap.md`

## Phase 43 changelog

Shipped in v0.9.83. Extends the prototype to full multi-pane behaviour:

- **N-pane stack.** `entries: DockEntry[]` was already array-shaped in
  Phase 42. Phase 43 renders all entries via a `<For>` loop keyed on
  stable URI strings (prevents iframe remount on reorder — Pitfall #1).
- **`+ Add` popover.** `AddAppPopover` (`add-app-popover.tsx`) fetches
  the MCP app list once at mount and shows already-docked apps as
  disabled. Rendered outside `DragDropProvider` to avoid click
  interception (Pitfall #3).
- **Drag-to-reorder.** `PaneHeader` (`pane-header.tsx`) uses
  `createDraggable`. Each `DockPane` uses `createDroppable`. `onDragOver`
  in the `DragDropProvider` calls `dock.reorder(draggedUri, overUri)`.
  Order is persisted to localStorage on every reorder.
- **Per-pane collapse.** `collapsed?: boolean` added to `DockEntry`.
  Pane body uses `display:none` (not unmount) to preserve iframe state.
  Collapse chevron in `PaneHeader` toggles the flag.
- **Horizontal divider.** `PaneDivider` (`divider.tsx`) sits between
  consecutive panes. Drag calls `dock.applyDividerDrag()` to allocate
  height between adjacent panes. `heightPx?: number` persisted per entry.
- **Height computation.** `paneHeight()` in `sizing.ts`: equal share by
  default; respects `heightPx` override; collapsed pane gets header
  height only.
- **Pure helpers.** `reorder.ts` and `sizing.ts` are pure functions with
  full unit-test coverage. `state.ts` extended with `setEntryCollapsed`
  and `setEntryHeight`.
- **New tests.** +45 unit tests. BDD E2E scenarios added in
  `packages/app/e2e/app-dock.spec.ts`.

## Phase 44 — Legacy pinned-apps migration

Shipped in v0.9.84. Bridges users who pinned apps under the old tab-strip
model before the dock existed.

- **Migration contract.** On first `AppDockProvider` mount in each
  workspace, the provider reads the legacy `pinned-apps` context (one-shot
  via `untrack`). If the dock is empty and legacy pins exist, those apps
  are seeded into the dock in pin order and the dock is set to `visible`.
  A success toast confirms: "Restored N apps from your tab pins".
- **Idempotent flag.** `DockState.migratedFromPinnedAt?: number` records
  the timestamp of the migration. Once set, the provider never re-runs
  migration for that workspace — even if the user later removes migrated
  apps.
- **Manual setup wins.** If the dock already has entries at migration time
  (user added apps manually before the migration ran), the legacy pins are
  NOT imported. The flag is still set to prevent future checks.
- **Legacy storage untouched.** `context/pinned-apps.tsx` is read-only in
  this phase. Both systems coexist until Phase 48 removes the legacy strip.
- **Pure helper.** `migration.ts` contains `planLegacyMigration`,
  `markMigrated`, and `migrationCount` — all pure functions with no
  Solid or DOM dependencies. 23 unit tests cover all branches.
