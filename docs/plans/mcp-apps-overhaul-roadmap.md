# MCP Apps Overhaul — Phased Execution Roadmap

> Written 2026-05-22. Concrete phase-by-phase plan to make MCP apps
> first-class citizens of LibreCode. Each phase ships independently
> usable value, has a small scope (1–3 days), and builds incrementally
> toward the end state. Pre-1.0, prototype-and-prove cadence.
>
> **Rationale + design options:** see `mcp-apps-ux-redesign.md` (the
> brainstorm doc).
>
> **End state we're driving toward:**
>
> MCP apps live in a dedicated, resizable, multi-pane App Dock that
> persists per-workspace and survives session navigation. Dashboards
> (Stats, Activity Graph) are always-visible. Companion apps (Multica,
> todo, scratch) can run side-by-side with the agent's diff. Power
> users can detach apps into Tauri windows. Discovery is one canonical
> path (Start menu). The session tab strip becomes session-scoped
> again — Review, files, ports, context, and nothing else.

---

## How to use this roadmap

- **One phase at a time.** Pick a phase, scope it tightly, ship it,
  verify it. No "let me also do…" creep.
- **Every phase ends shippable.** Each phase produces a working
  intermediate state, not a half-built feature. If we stop after Phase
  43 the app is BETTER than today, not worse.
- **Gate after Phase 42.** Phase 42 is a prototype that's additive
  only (doesn't remove anything). Dogfood for a few days. If the dock
  model is wrong we learn cheaply and adjust. If it's right we
  commit to Phases 43–51 with confidence.
- **Version-agnostic.** Each phase ships as its own 0.9.x patch
  (likely v0.9.82, .83, .84, …). Don't tie the arc to a specific
  release; ship as ready.
- **Order matters.** Phases 42–46 are the foundational arc. Phases
  47–51 are polish + power features. The order can be rearranged
  AFTER 46 lands.

---

## Phase 42 — App Dock prototype (additive)

**Goal:** prove the dock model with one app, zero disruption to
existing UX. Dogfood for ~3 days before committing to Phase 43.

**Scope:**

- New `packages/app/src/components/app-dock/` directory with:
  - `dock.tsx` — the side-pane component (resizable container, vertical
    stack of pane slots)
  - `pane.tsx` — single pane wrapper (header bar with app name +
    collapse/expand + remove, body slot for `McpAppPanel`)
  - `state.tsx` — `useAppDockState()` context: which apps are docked,
    pane heights, dock width, visibility, persisted to localStorage
    via the existing `Persist.workspace` primitive
  - `resize-handle.tsx` — drag handle for dock width
- Mount in `packages/app/src/pages/session.tsx` as a sibling to the
  existing session side panel. Right-anchored. Default hidden.
- Feature flag in config: `experimental.app_dock` (default false). When
  on, the dock appears with a "+ Add" empty state. When off, no
  visible change.
- Single-pane support only. Stacking is Phase 43.
- One pre-populated example app via "Try it: Add Session Stats" button
  in the dock's empty state.

**Files touched:** ~5 new files (dock/), 1 edit to
`pages/session.tsx`, 1 edit to `config/schema.ts` (flag),
1 edit to PLAN.md.

**Success criteria:**

- With flag off, no UI change anywhere. Existing pinning behavior intact.
- With flag on, dock toggles open via a keyboard shortcut + a button
  in the top-right of the session view. Stats renders in the dock
  pane. Dock width resizes. State persists across reload.
- 6+ unit tests for the state context (visibility persistence, dock
  width clamping, add/remove pane).
- No regressions in the existing session side panel.

**Risks:**

- Iframe rendering in a new layout slot might trip a Suspense flash.
  Mitigation: follow the ADR-006 pattern; new file goes into the
  danger-zone glob.
- Resizable layout adds 200–300px of horizontal real estate. Test
  on a 13" laptop early.

**Estimate:** 1–2 days (one focused session).

**After this phase ships:** open issues with users, gather feedback
on whether multiple apps in a vertical stack feels right. If yes,
proceed to Phase 43. If no, we've learned and can pivot before
investing further.

---

## Phase 43 — Multi-pane dock + reorder + collapse

**Goal:** the dock holds N apps in a configurable stack. Drag-to-reorder.
Individual pane collapse.

**Scope:**

- Multi-pane support: dock renders `<For each={dockApps()}>` of
  `<DockPane>` components.
- Per-pane `collapsed` state (header still visible, body hidden).
  Persists per workspace.
- Per-pane height with a drag handle between panes. Min/max constraints
  (≥150px, ≤80% of viewport).
- Drag-to-reorder via `@thisbeyond/solid-dnd` (already a dependency
  for file tabs).
- "+ Add" button at bottom of dock opens the Start menu filtered to
  "apps you can add to dock" with current dock state grayed-out.

**Files touched:** edits to dock/, no new components except possibly
a `<PaneHeader>` extract.

**Success criteria:**

- 3+ apps stacked. Smooth resize between panes. Reorder works without
  losing pane state.
- Collapsed panes don't render their iframe content (memory win).
- Add/remove updates the persisted layout.
- 8+ unit tests across reorder, collapse, height clamping.

**Risks:**

- Iframe mount/unmount on collapse may break some apps' state. Need
  to keep the iframe alive but hide it, similar to the current
  `forceMount + opacity:0` approach but scoped to one pane. Mitigation:
  reuse the existing pattern from `mcp-app-panel/`.

**Estimate:** 1–2 days.

---

## Phase 44 — Workspace-scoped dock state

**Goal:** different projects get different dock layouts. Switching
projects swaps the dock.

**Scope:**

- Move `useAppDockState` from global localStorage to workspace-scoped
  storage. The existing pinned-apps context (in
  `packages/app/src/context/pinned-apps.tsx`) is keyed on the global
  SDK; refactor to key on `Instance.project.id` instead.
- Workspace switch: when the active project changes, the dock state
  reloads from that project's storage. Empty state if first time.
- Settings: a per-project dock UI in the Control Panel (Phase 34's
  Settings dialog) that shows the dock layout + lets the user copy
  layout from another project.
- Migration: on first launch of v0.9.x with this phase, take the
  existing global pinnedApps and seed it into ALL existing projects'
  dock state. Idempotent — runs once.

**Files touched:** `context/pinned-apps.tsx` (refactor), `app-dock/state.tsx`
(workspace-scoped storage), `Persist` helper, settings dialog.

**Success criteria:**

- Pinning Multica in project A doesn't pin it in project B.
- Removing it in A doesn't affect B.
- Old localStorage seed migrates cleanly.
- Reload preserves both projects' independent layouts.
- 5+ unit tests for the migration + switching paths.

**Risks:**

- Project ID can be `global` (the catch-all). Need a sensible fallback:
  "global" project dock state acts as the default for projects with no
  state yet.
- Migration is a one-shot; need a flag to prevent re-running on
  subsequent launches.

**Estimate:** 1 day.

---

## Phase 45 — Discovery consolidation

**Goal:** one canonical place to discover and add MCP apps — the Start
menu. The "Apps" tab in the session strip goes away.

**Scope:**

- Remove the `<Tabs.Trigger value="apps">` entry from
  `session-side-panel.tsx`.
- Remove the `<Tabs.Content value="apps">` block.
- Remove `McpAppsTab` from that file's imports (component itself
  stays — Start menu re-uses it).
- Start menu (`start-menu.tsx`) gains:
  - **"In dock"** indicator next to apps already added (icon + dim)
  - **"+ Add to dock"** primary action (replaces "Pin as tab")
  - **Marketplace search** inline at the top (preview of Phase 41
    integration — surfaces installable apps if local set is small)
- Old pinned-tab logic: when a user has pre-existing pinned-tab MCP
  apps, on first launch with this phase they auto-migrate to dock state
  via the Phase 44 migration step.

**Files touched:** `session-side-panel.tsx`, `start-menu.tsx`,
`mcp-app-panel.tsx` (maybe — to lift `McpAppsTab` out of the
session panel coupling).

**Success criteria:**

- Apps tab is gone from the session strip.
- Start menu shows all available apps with clear dock-state indicators.
- Adding from Start menu inserts into the dock.
- Existing pinned tabs auto-migrate without user action.
- ADR-006 lint stays clean (start menu was a danger zone).

**Risks:**

- Auto-migration could surprise users. Mitigation: log a one-time
  toast "Your pinned apps moved to the new App Dock — see
  `librecode.app/docs/dock`".

**Estimate:** 1–2 days.

---

## Phase 46 — Activity duplication resolution

**Goal:** end the "Activity tab vs Activity Graph pinnable app"
confusion. Two views of the same data, but one is a session log
(tab) and the other is a dashboard (dock).

**Scope:**

- Rename the "Activity" built-in tab to "Timeline". Update the
  `session.tab.activity` i18n key. The Timeline is a chronological
  event log: file edits, tool calls, errors, message timestamps.
  Lives in the session tab strip alongside Review.
- "Activity Graph" pinnable MCP app stays as the visualization. Lives
  in the dock. It's optional, and great for live charts of the same
  events Timeline shows as a list.
- Make the relationship explicit: Timeline has a "View as graph"
  button that adds Activity Graph to the dock (if not already).
- Update `docs/architecture.md` with the model split.

**Files touched:** session side panel, i18n keys, activity-grid.tsx
(rename + minor UI), built-in apps list.

**Success criteria:**

- No more user confusion about "which Activity is which."
- Timeline tab exists; Activity Graph is in the dock.
- The "View as graph" affordance works.
- 3+ i18n languages updated (en + 2 most-translated).

**Risks:**

- I18n drift — easy to leave the old "Activity" string in some
  locales. Mitigation: existing librecode-i18n CI catches missing keys.

**Estimate:** 1 day.

---

## Phase 47 — App lifecycle UX

**Goal:** every dock pane shows clear connection status, lets the
user manage the app inline, surfaces updates.

**Scope:**

- **Status badge** per pane: connected (green dot), connecting (spinner),
  error (red dot with tooltip), idle (gray). Wired to `MCP.status`
  - the AppBridge running counter from Phase 31.
- **Pane settings menu**: right-click or "⋮" button opens a popover
  with: Disconnect, Reconnect, Open in settings, Update available, View
  logs, Remove from dock.
- **Update available** notification: when the marketplace (Phase 41) or
  the local catalog reports a newer version of an installed app, the
  pane header gets a blue dot. Click to update.
- **Per-app settings** route inside the existing Settings dialog,
  surfaced via "Open in settings" from the pane menu. Shows the app's
  configuration (env vars, OAuth state, char limits, sampling caps).

**Files touched:** new `app-dock/pane-status.tsx`, edits to
`mcp-app-panel.tsx` (expose status), edits to Settings dialog.

**Success criteria:**

- Status badge accurately reflects connection state at all times.
- Disconnect/reconnect cycle works without leaking the iframe.
- Update flow round-trips through the install pipeline.
- 6+ unit tests across status states + settings affordances.

**Risks:**

- "Update available" requires knowing the current installed version vs
  the latest available. Cross-references to the marketplace; in early
  phases (pre-marketplace launch) it can show "updates" only for
  built-in apps tied to LibreCode versions.

**Estimate:** 1–2 days.

---

## Phase 48 — Tab strip cleanup + drop legacy code

**Goal:** the session tab strip is session-scoped again. All the dead
code paths from pinned-app rendering go away.

**Scope:**

- Remove the pinned-app `<For>` block in `session-side-panel.tsx`
  (lines ~334–353 in the current file). All pinned apps now live in
  the dock — no need for them in the tab strip.
- Remove the `forceMount + opacity:0` overlay hack (lines ~445–488).
  The dock pane manages its own iframe lifecycle without this trick.
- Remove the `tabValue.startsWith("mcp-app:")` filter in
  `sortableFileTabs` (no longer needed).
- Remove `mcpTabValue` helper if unused after the above.
- Remove the Apps tab + its content block (already done in Phase 45,
  this phase just removes the imports and dead types).
- File-size check: `session-side-panel.tsx` should shrink from 649
  lines to <500. Wins.

**Files touched:** mostly deletes from `session-side-panel.tsx`.

**Success criteria:**

- session-side-panel.tsx is ≤500 lines.
- No regressions — all session tab functionality (Review, Timeline,
  Context, files, port previews) keeps working.
- The `forceMount` hack is gone; switching panes is cleaner.

**Risks:**

- Hidden coupling — something else might import `mcpTabValue` or
  rely on a removed shape. Mitigation: full test suite + manual
  smoke test of all tab interactions before merging.

**Estimate:** 1 day. Mostly deletion.

---

## Phase 49 — Detachable Tauri windows (desktop)

**Goal:** power users can pop any dock pane out into a separate Tauri
window. Multi-monitor setups become first-class.

**Scope:**

- "Detach" button in pane header → opens new Tauri window with the
  same `McpAppPanel` rendered standalone.
- Window state (position, size, monitor) persists per app per
  workspace.
- Window has a "Re-attach to dock" button → closes window, app returns
  to dock.
- Closing the window normally counts as "still detached" — re-opens
  the window on next session in the same position.
- IPC bridge between the Tauri window and the main window for SSE event
  forwarding (the AppBridge currently lives in the iframe inside the
  main window; need to wire it across).
- Web users (browser only): the Detach button is hidden. The dock-only
  experience is the canonical web experience.

**Files touched:** new `packages/desktop/src-tauri/src/app_window.rs`,
new `app-dock/detached.tsx`, IPC setup, web fallback hide logic.

**Success criteria:**

- Detach + re-attach works without losing iframe state.
- Multi-monitor: opening Multica detached on monitor 2 stays there
  across LibreCode restarts.
- Web build still works; Detach button hidden gracefully.
- 4+ integration tests (manual smoke + at least an e2e via Tauri test
  harness).

**Risks:**

- Tauri 2.x multi-window has a steep learning curve. May discover
  IPC limitations mid-implementation. Mitigation: timebox the
  prototype; fall back to "open in default browser window" if Tauri
  multi-window proves too painful.
- Web fallback edge cases (a user clicks Detach in dev:web — does it
  open a popup window?). Need a clear "this is desktop-only" message.

**Estimate:** 2–3 days. The riskiest phase.

---

## Phase 50 — Performance + accessibility polish

**Goal:** the dock is fast, accessible, and not a memory hog at scale.

**Scope:**

- **Lazy iframe mount** — collapsed panes' iframes don't exist in the
  DOM at all (`<Show when={!collapsed()}>` wraps the iframe). Previous
  state preserved by serializing the iframe's last-known state to
  localStorage before unmount (via the existing v0.9.62 state relay).
- **Iframe pool** — when re-opening an app that was recently closed,
  reuse the prior iframe if it's still in memory (5-minute window).
  Skips the cold-start fetch + handshake.
- **Keyboard navigation** — `Ctrl+Shift+1`…`Ctrl+Shift+9` jumps to
  the Nth dock pane. `Ctrl+Shift+\` toggles the dock. `Ctrl+Shift+D`
  detaches the active pane.
- **A11y audit** — every dock pane is a labelled landmark; collapsed
  state is announced; resize handles have aria-\* labels and keyboard
  resize support.
- **Performance metrics** — wire dock-pane lifecycle events to Phoenix
  telemetry (opt-in). Track mount/unmount times, iframe-ready latency,
  re-mount count per session.

**Files touched:** many small edits across dock/, plus a new
keyboard-shortcut module.

**Success criteria:**

- 5 panes + 3 collapsed: memory footprint within 50MB of "1 pane".
- Keyboard navigation works in a screen-reader audit.
- p95 pane-switch latency <50ms.
- Phoenix dashboard shows healthy mount/ready/unmount counts.

**Risks:**

- Lazy iframe mount can lose ephemeral state (scroll position, modal
  state). Mitigation: rely on the v0.9.62 state-relay protocol; apps
  that implement it survive unmount/remount; apps that don't get
  warned in their pane that "this app doesn't persist state across
  collapses."

**Estimate:** 1–2 days.

---

## Phase 51 — Public docs + announcement

**Goal:** the new model is documented, the migration path is clear,
and external app developers know what changed.

**Scope:**

- **`docs/mcp-apps.md`** — updated user-facing guide: dock model, how
  to pin, how to detach, how to configure per-workspace.
- **`docs/mcp-apps-development.md`** — developer-facing: state relay
  contract, AppBridge changes, what to test on, dock-vs-detached
  considerations.
- **Migration guide**: a section in the release notes explaining what
  changed for users upgrading from the tab-strip model. Screenshots
  before/after.
- **ADR-009** — formalize the dock model as an architectural decision.
  Replaces the implicit model that grew through Phases 15-32.
- **Blog post / announcement** — short narrative for the upcoming
  release: "How LibreCode's app dock makes MCP apps first-class."
- Update `PLAN.md` to mark Phases 42–51 complete and note the
  resulting v0.9.x version range.

**Files touched:** docs only.

**Success criteria:**

- All public-facing docs reflect the new model.
- ADR-009 ratified.
- Release notes give a clear before/after.

**Estimate:** 1 day.

---

## Cumulative arc

| Phase  | Title                           | Effort | Cumulative |
| ------ | ------------------------------- | ------ | ---------- |
| **42** | App Dock prototype (additive)   | 1-2 d  | 1-2 d      |
| **43** | Multi-pane + reorder + collapse | 1-2 d  | 2-4 d      |
| **44** | Workspace-scoped dock state     | 1 d    | 3-5 d      |
| **45** | Discovery consolidation         | 1-2 d  | 4-7 d      |
| **46** | Activity duplication resolution | 1 d    | 5-8 d      |
| **47** | App lifecycle UX                | 1-2 d  | 6-10 d     |
| **48** | Tab strip cleanup               | 1 d    | 7-11 d     |
| **49** | Detachable Tauri windows        | 2-3 d  | 9-14 d     |
| **50** | Performance + accessibility     | 1-2 d  | 10-16 d    |
| **51** | Public docs + announcement      | 1 d    | 11-17 d    |

**Net: 2–3 weeks of focused work to ship the full overhaul.**

Each phase produces a usable intermediate state, so we can ship as
0.9.82, .83, .84, …, .91 in lockstep. Or batch a couple of phases
into one release if they're trivially related (43 + 44 could ship
together, for instance).

---

## Decision gates

Three explicit "should we continue?" points:

### Gate 1 — after Phase 42 (the prototype)

Dogfood for ~3 days. Questions to answer:

- Does the dock feel like a natural place for apps, or like it's
  competing with the session view?
- Is the resizable side pane intuitive, or does it confuse the layout?
- Multiple iframes side-by-side in the same browser context — any
  performance issues?
- Does the keyboard toggle (`Ctrl+B`-style) feel right, or do users
  forget it exists?

**If the dock feels wrong:** pivot. Maybe Option B (detachable windows
only) or Option C (grouped tab strip) is the right path. We've spent
1-2 days and have a working prototype to compare against.

**If it feels right:** commit to 43–46 (the foundational arc) with
confidence.

### Gate 2 — after Phase 46 (the foundation lands)

Phases 42–46 collectively replace the old tab-strip-everything model
with the dock model. By the end of 46:

- Dock has multi-pane, workspace-scoped, lifecycle UX.
- Apps tab is gone from session strip.
- Activity duplication is resolved.

Questions to answer:

- Are users actually using the dock, or sticking with old habits?
- Did we miss any UX rough edges (drag-reorder, collapse, etc.)?

**If usage is low:** investigate before doing 47–51. Maybe the dock
visibility default is wrong, or the keyboard shortcut isn't discovered.

**If usage is high:** ship 47–51 to round out the experience.

### Gate 3 — after Phase 49 (the riskiest phase)

Tauri multi-window is the highest-risk phase. After it ships:

- Does detach/re-attach work reliably?
- Is the multi-monitor story compelling, or a power-user-only feature
  that adds complexity for everyone?

**If multi-window is flaky:** keep the dock-only experience as the
canonical path; mark detach as experimental.

**If it works:** lean into it for the public announcement (Phase 51).

---

## What this overhaul DOESN'T touch

To keep scope honest:

- **The agent thread.** Composer + message timeline UI stays.
- **The Review surface.** Reviewing diffs is unchanged.
- **The MCP-Apps protocol.** `text/html;profile=mcp-app`, AppBridge
  JSON-RPC, `ui://` resources — all unchanged.
- **Existing apps.** Multica, Stats, Activity Graph — all keep working
  through every phase. Migration happens at the layout layer, not the
  app layer.
- **Marketplace integration.** Phase 41 is separate. The dock will
  integrate with it (Phase 47's "update available", Phase 45's
  search) but doesn't depend on it shipping first.
- **TUI.** The TUI uses its own panels (Phase 19 ActivityPanel etc.).
  The dock concept doesn't apply there.

---

## What success looks like at the end of Phase 51

A user opens LibreCode. The session view shows the agent thread on
the left with Review/Timeline/Context/files in a clean tab strip.
On the right, an App Dock with their pinned Stats, Activity Graph,
and Multica panes — exactly as they left it last time they worked
on this project. They can drag a pane out into its own window on
their second monitor. They can collapse panes they don't need right
now. They can `Ctrl+Shift+3` to focus the third pane. They can
right-click any pane for status, settings, update notifications.

Apps are tools that travel WITH the user, not session metadata that
clutters one strip. The architecture supports the user's workflow
instead of forcing them around its limitations.

That's the prize.
