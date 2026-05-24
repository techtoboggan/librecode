# Phase 46 — Activity Duplication Resolution (Spec Stub)

> **Status:** Not started. Phase 45 (v0.9.85) is the prerequisite.
>
> Full roadmap context: `docs/plans/mcp-apps-overhaul-roadmap.md`

---

## Goal (one sentence)

End the "Activity tab vs Activity Graph app" confusion by renaming the
tab to "Timeline" and making the relationship between the two views
explicit with a "View as graph" button.

## What "done" looks like

- The session side panel has a "Timeline" tab (was "Activity") showing the
  chronological event log: file edits, tool calls, errors, timestamps.
- The "Activity Graph" built-in MCP app lives in the dock — optional.
- A "View as graph" button in the Timeline tab calls `dock.add(activityGraphApp)`
  if not already present (using the same Phase 45 `dockCtx.add()` path).
- `session.tab.activity` i18n key renamed to `session.tab.timeline` in
  `librecode-i18n` (en + other languages).
- No user sees "Activity" in two places referring to different things.

---

## Pre-flight: read these before touching code

- Phase 45 wired `dockCtx.add()` as the canonical dock-insertion path. Use
  the exact same pattern for the "View as graph" button.
- `session-side-panel.tsx` already has `<Show when={!dockEnabled()}>` guards
  (Phase 45). The Timeline tab does NOT get gated — it's always visible.
  Only the old "Apps" tab was dock-gated.
- The i18n rename requires a PR in `librecode-i18n` repo AND a version bump
  of `@librecode/i18n` before the main repo PR lands. Coordinate the two.
- The `Activity` → `Timeline` rename touches `createSessionTabs` in
  `helpers.ts`: the active-tab redirect effect added in Phase 45 redirects
  "apps" → "activity". Update that to redirect to "timeline" after the rename
  (or keep "activity" as an alias until Phase 48 cleanup).

---

## Pitfalls from Phase 45 (fold these into the Phase 46 work)

### 1. `scripts/release.sh` first arg IS the version string — not a flag

`scripts/release.sh --dry-run` writes `"--dry-run"` into every package.json.
Always call with the actual version: `scripts/release.sh 0.9.86`.
If working tree is polluted, use `git stash` to restore, then run the script.

### 2. AppDockProvider is ALWAYS mounted (not behind the feature flag)

`AppDockProvider` mounts unconditionally in `session.tsx` (line 870). Only
`<AppDock>` is conditionally rendered at line 1036. Therefore:

- `useContext(DockContext)` always returns a `DockContextValue` inside the
  session route — it will NOT be `undefined`.
- `useAppDockState()` is safe to call from any session-mounted component.
- You still MUST check `sync.data.config?.experimental?.app_dock` before
  routing to `dockCtx.add()`. The context existing ≠ dock being enabled.

### 3. "Browse marketplace" button is a modal dialog, not an `<a>` tag

The spec described a plain external `<a href="https://mcpappfoundry.app">`.
The actual implementation (v0.9.64) is a button that opens `MarketplaceDialog`.
Don't add a second link — the dialog already satisfies the requirement.

### 4. `inDock` short-circuits correctly when dock flag is off

Combine the flag check AND the entries check:

```ts
const inDock = (app) => dockEnabled() && entries.some((e) => e.uri === app.uri)
```

Without `dockEnabled()` guard, apps could appear "in dock" even when the user
hasn't enabled the dock feature, since the provider is always mounted.

### 5. Phase 45 `createEffect` redirects "apps" → "activity"

The effect added to `session-side-panel.tsx` in Phase 45:

```ts
createEffect(() => {
  if (!dockEnabled()) return
  if (tabState.activeTab() !== "apps") return
  void startTransition(() => tabs().setActive("activity"))
})
```

When you rename "activity" → "timeline" in Phase 46, UPDATE THIS EFFECT
to redirect to "timeline" instead. Otherwise, users enabling the dock
after having the "apps" tab active will land on "activity" (which may
not exist anymore after the rename).

---

## Rough execution order (to be expanded into a full spec)

1. Update `librecode-i18n` repo: rename `session.tab.activity` → `session.tab.timeline`.
2. Bump `@librecode/i18n` version and publish.
3. Update `session-side-panel.tsx`: rename the Activity tab trigger/content + the
   Phase 45 redirect effect target.
4. Update `activity-grid.tsx` (the ActivityTab component): rename to TimelineTab
   or add an alias export.
5. Add the "View as graph" button inside TimelineTab using `dockCtx.add()`.
6. Update `createSessionTabs` in `helpers.ts`: add "timeline" as a known static tab
   (alongside "review", "apps", "activity" for backwards compat during transition).
7. Update `docs/architecture.md` with the Timeline vs. Activity Graph model split.
8. Tests: unit tests for "timeline" tab routing; E2E for "View as graph" button.
9. Version bump to v0.9.86.
