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

## Phase 45 — Discovery consolidation

Shipped in v0.9.85. After this phase the Start menu is the single
canonical entry point for adding MCP apps when the dock is enabled.

- **Apps tab gated.** The session strip's "Apps" tab Trigger and Content
  are both wrapped in `<Show when={!dockEnabled()}>` in
  `session-side-panel.tsx`. Users with the flag off see zero change.
- **Active-tab redirect.** A `createEffect` in `session-side-panel.tsx`
  watches `activeTab()`. If the flag flips on while "apps" is active
  (e.g. from a previous session with the flag off), the active tab is
  redirected to "activity" via `startTransition` to avoid a blank panel.
- **Start-menu routing.** `session-header.tsx` `onLaunch` now branches:
  `experimental.app_dock = true` → `dockCtx.add(app)` + auto-open the
  dock if it's currently hidden. Flag off → legacy `pinnedApps.pin()` +
  `tabs().open()` path unchanged from v0.9.84.
- **"in dock" badge.** `start-menu.tsx` reads `DockContext` (always
  available — `AppDockProvider` is unconditionally mounted in
  `session.tsx`) and marks apps whose URI is present in
  `dockCtx.state().entries` as disabled + labeled "in dock".
- **Marketplace link.** The "Browse marketplace" button was already
  present from v0.9.64 (opens `MarketplaceDialog` which surfaces
  `mcpappfoundry.app`). No new link added; existing button satisfies
  the Phase 45 discoverability requirement.
- **Legacy path untouched.** `context/pinned-apps.tsx` is still not
  modified. Both systems coexist until Phase 48.
- **Tests.** +16 unit tests in `start-menu.test.tsx` (inDock predicate,
  row filtering, onLaunch branching). +4 BDD E2E scenarios in
  `packages/app/e2e/app-dock.spec.ts`.

## Phase 46 — Activity duplication resolution (display-only rename)

The session tab strip's "Activity" label is now "Timeline". The
internal tab identifier and component name (`ActivityTab`) are
unchanged — display-only rename in the i18n layer (`session.tab.activity`
value: `"Activity"` → `"Timeline"`). The full identifier rename is
deferred to Phase 48 alongside the legacy pinned-apps removal.

The Timeline tab gains a "View as graph →" button (visible only when
the dock is enabled) that adds the Activity Graph MCP app to the dock.
Clicking when the graph is already docked shows "In dock" and is
disabled.

Net effect: users no longer see "Activity" in two places. The tab is
the chronological event log (Timeline); the dock app is the live
visualization (Activity Graph). The bridge between them is the
View-as-graph button.

- **i18n.** `@librecode/i18n@0.9.33` changes only the English value.
  Other locales fall back to English. Internal key unchanged.
- **Phase 45 redirect untouched.** The `createEffect` in
  `session-side-panel.tsx` that redirects `activeTab === "apps"` →
  `"activity"` is unmodified; it still works because the internal
  value is still `"activity"`.
- **Tests.** +13 unit tests in `activity-grid.test.tsx`. +2 BDD E2E
  scenarios in `packages/app/e2e/app-dock.spec.ts` (Timeline label +
  View-as-graph flow).

## Phase 47 — App lifecycle UX

Each dock pane now shows a colored status dot and a ⋮ menu:

**Status dot colors:**

- Green: connected (or built-in — synthesized as always-connected)
- Yellow + pulse: connecting (server hasn't reported yet, undefined in sync.data.mcp)
- Amber: needs authentication
- Red: failed (with error text in tooltip)
- Gray: disabled

**⋮ menu actions:**

- **Reconnect** — visible when `status.recoverable === true` (failed or needs_auth).
  Calls the new `POST /mcp/reconnect/:server` endpoint.
- **View error** — visible when `status.kind === "failed"` AND error string is non-empty.
  Replaces the iframe content with an inline error panel (display:none toggle preserves
  the iframe bridge per ADR-006 / Phase 42 invariant). A "← Back to app" button restores.
- **Remove from dock** — always visible.

**New files:** `pane-status.ts`, `pane-status.test.ts`, `pane-status-dot.tsx`,
`pane-menu.tsx`, `pane-menu.test.tsx`.

**Modified:** `pane-header.tsx` (prop rename `name` → `appName`, new props),
`dock.tsx` (`DockPane` adds `useSync()`, `deriveStatus()`, `viewingError` signal,
`PaneErrorPanel`), `pane-header.test.tsx`, `dock.test.tsx`.

**Backend:** `MCP.reconnect(name)` added to `packages/librecode/src/mcp/index.ts`.
New route `POST /mcp/reconnect/:server` (`operationId: mcp.reconnect`) in
`packages/librecode/src/server/routes/mcp.ts`. SDK regenerated.

**Deferred to Phase 47b** (post-marketplace): Update available notifications,
Open in settings deep-link, View logs.

**Tests:** +16 unit tests (`pane-status.test.ts`), +17 tests (`pane-menu.test.tsx`),
+3 tests (`pane-header.test.tsx`), +4 tests (`dock.test.tsx`), +2 tests
(`test/mcp/reconnect.test.ts`), +3 BDD E2E scenarios (`app-dock.spec.ts`).
Total: +45 tests across 6 files.

## Phase 48 — Tab strip cleanup + drop legacy MCP code (v0.9.88)

Flipped `experimental.app_dock` default → on. The Zod schema now uses
`.default(true)` on `app_dock` and `.default({ app_dock: true })` on the
parent `experimental` object (Zod v4 requires the outer default to carry
the inner default value to handle the case where `experimental` is
completely absent from the config file).

Deleted all legacy MCP-pinned-app rendering from `session-side-panel.tsx`:

- `mcpTabValue` helper
- `fallbackActive` in `createSessionTabs` (first-pinned-app fallback)
- `<Show when={!dockEnabled()}>` wrapping Apps tab `Tabs.Trigger`
- `<For each={pinnedApps()}>` block of pinned-app `Tabs.Trigger` elements
- `<Show when={!dockEnabled()}>` wrapping Apps `Tabs.Content`
- The `forceMount + opacity:0 + position:absolute` overlay wrapper that kept
  pinned-app iframes alive across tab switches (the dock manages its own
  iframe lifecycle — this trick is retired)
- Phase 45 stale `activeTab === "apps"` redirect `createEffect` (dead with
  the dock default-on; any legacy persisted value silently no-ops)

Dead `tabs().open("mcp-app:...")` call removed from `session-header.tsx`
pin handler; `batch()` wrapper removed (only existed for the pin+open pair).

Right-side file-tree panel (file list + resize handle) extracted to
`session-file-tree-panel.tsx`. `session-side-panel.tsx`: 669 → 448 lines.

**Tests:** +3 schema tests (`schema.test.ts`), +12 mirror-function tests
(`session-file-tree-panel.test.ts`), +8 regression tests
(`session-side-panel.legacy.test.ts`), +1 regression test
(`session-header.test.ts`). Total: +24 tests across 4 files.

| Phase 48 (v0.9.88) | Flipped `experimental.app_dock` default → on. Deleted legacy MCP-pinned-app rendering from session tab strip. Dropped the `forceMount + opacity:0` overlay hack. Extracted `<SessionFileTreePanel>` to bring `session-side-panel.tsx` from 669 → 448 lines.                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 49 (v0.9.89) | Added detachable Tauri windows. Each dock pane can pop out into its own native window (⤢ Detach button in pane header). Windows persist position/size/monitor across restarts via `tauri-plugin-window-state`. Re-attach via window header menu or dock placeholder. The `dir` query param passes workspace context to the detached shell's SDKProvider. Web build hides Detach button. Built-in apps (`__builtin__`) not detachable in this phase (deferred). |
