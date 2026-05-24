# Phase 45 — Discovery Consolidation (Detailed Execution Spec)

> Self-contained brief for an executor who hasn't been in the
> conversation. Phase 44 (legacy → dock migration) is merged at
> v0.9.84; this builds directly on it. After this phase the Start
> menu becomes the single canonical place to discover and add MCP
> apps when the dock is enabled.

---

## Goal (one sentence)

When `experimental.app_dock = true`, the session strip's "Apps" tab
disappears, and the **Start menu** becomes the single canonical entry
point for adding apps — routing launches to the dock instead of the
legacy pinned-tab strip.

## What "done" looks like for THIS phase

A user with `experimental.app_dock = true`:

1. Opens a session. The session tab strip shows Review / Activity /
   Context / file tabs. There is **no** "Apps" tab.
2. Clicks the **Start** button in the session header. The Start menu
   opens listing Built-in apps + MCP-server apps.
3. Each app in the menu shows an "in dock" badge if it's already in
   the dock. Those rows are dimmed and not clickable.
4. Clicks an app not yet in the dock → it appears in the dock as a
   new pane (using the Phase 43 `dock.add()` path). The Start menu
   closes. **No** new tab appears in the session strip.
5. Opens the menu again → the just-added app now shows "in dock" too.
6. At the bottom of the menu, a "Browse marketplace" link points to
   `https://mcpappfoundry.app` (opens externally; marketplace
   integration itself is Phase 41).

A user with `experimental.app_dock = false` (default):

7. Sees zero change from v0.9.84. Apps tab is present. Start menu
   launches still go through `pinnedApps.pin()` (legacy tab path).

The legacy `pinned-apps.tsx` storage is **still untouched** in this
phase — both paths coexist until Phase 48.

---

## Pre-flight: read these before touching code

### What Phases 42–44 shipped

- `packages/app/src/components/app-dock/` — full multi-pane dock with
  state, migration, reorder, collapse, dividers, add-app popover.
- `dock.add(app)` is the canonical insertion point for new apps when
  the dock is on.
- Phase 44's migration runs automatically on first dock mount per
  workspace — already-pinned apps appear in the dock on first launch.
- Start menu currently lives at `packages/app/src/components/start-menu.tsx`
  and is mounted in `packages/app/src/components/session/session-header.tsx`.
  Its `onLaunch` callback currently does
  `batch(() => { pinnedApps.pin(...); tabs().open(...) })`.

### CLAUDE.md rules (recap)

- No semicolons / 120 char width / no `any`.
- ADR-006 lint covers `start-menu.tsx` (already in the danger zone glob).
  Phase 42 added it. No new `createResource` calls expected; if one
  sneaks in, annotate with `// adr-006: <reason>`.
- File size: stay well under limits. `start-menu.tsx` is 253 lines
  today; after this phase, probably ~290.

### The feature-flag boundary

This phase changes Start-menu and session-side-panel behavior **only
when the dock is on**. Users who haven't flipped the flag see no
change. Concretely:

- `<Show when={experimental.app_dock}>` wraps both:
  - The branch that calls `dock.add()` instead of `pinnedApps.pin()` in
    the Start menu's `onLaunch`.
  - The hiding of the Apps tab + content in `session-side-panel.tsx`.

This is critical. Don't unconditionally remove the Apps tab — Phase 48
is the unconditional removal. Phase 45 is the conditional handoff.

### Config flag access

The dock flag lives at `experimental.app_dock` in config (added in
Phase 42). Reading it from a component looks like:

```ts
import { useGlobalSync } from "@/context/global-sync"
const sync = useGlobalSync()
const dockEnabled = () => sync.data.config?.experimental?.app_dock === true
```

The exact import path may differ — match whatever the existing
`session-side-panel.tsx` already does (it reads config in other
places). Read it before duplicating.

---

## Files to modify

### `packages/app/src/components/start-menu.tsx`

The biggest changes. Roughly:

#### Add new context hooks

```ts
import { useAppDockState } from "@/components/app-dock/use-dock-state"
import { useGlobalSync } from "@/context/global-sync" // or whatever the existing pattern uses
// ... existing imports ...
```

Inside the component:

```ts
const sync = useGlobalSync()
const dockEnabled = () => sync.data.config?.experimental?.app_dock === true

// dock is only available when the flag is on. When flag is off, this
// throws because AppDockProvider isn't mounted. Defensive use of
// useContext directly + null check to avoid the throw.
const dockMaybe = (): ReturnType<typeof useAppDockState> | undefined => {
  // Either: (a) call useAppDockState() inside a Show-gated subtree,
  // OR (b) use useContext(DockContext) with a manual undefined check.
  // Pick whichever the existing Phase 42-44 code patterns prefer.
}
```

(Verify the cleanest pattern by looking at how `usePinnedApps()` is
gracefully consumed elsewhere or how Phase 44's `use-dock-state.tsx`
behaves when called outside its provider.)

#### Add "in dock" indicator

In the For loop that renders each app row, compute:

```ts
const inDock = (app: AppEntry) => dockEnabled() && (dockMaybe()?.state().entries ?? []).some((e) => e.uri === app.uri)
```

Render the indicator alongside the name:

```tsx
<button
  disabled={inDock(app)}
  class="... disabled:opacity-50 disabled:cursor-not-allowed"
  onClick={() => {
    if (inDock(app)) return
    handleLaunch(app)
  }}
>
  <div class="flex items-center justify-between gap-2">
    <div class="min-w-0">
      <div class="text-13-medium text-text-base">{app.name}</div>
      <Show when={app.description}>
        <div class="text-11-regular text-text-weak mt-0.5">{app.description}</div>
      </Show>
    </div>
    <Show when={inDock(app)}>
      <span class="text-10-regular text-text-weaker shrink-0">in dock</span>
    </Show>
  </div>
</button>
```

Apply to both the Built-in and MCP-server sections (the menu has two
For loops today; both need the indicator).

#### Branch `onLaunch` on the dock flag

Currently the menu has its own onClick handlers that call
`props.onLaunch(app)` for both Built-in and MCP-server sections.

Refactor so the parent's `onLaunch` (in `session-header.tsx`)
receives a single callback that branches internally on dock-enabled.
Two options:

**Option A (preferred):** keep `onLaunch` as a single prop on
StartMenu but have its CALLER (session-header.tsx) do the branching.

**Option B:** add a `dockEnabled` prop + a separate `onAddToDock`
callback, route inside the menu.

Go with Option A — it's a smaller, more local change. Specifically:

In `start-menu.tsx`, no changes to the launch wiring beyond the "in
dock" indicator. The component still has one `onLaunch` prop.

In `session-header.tsx` (around line 338), expand the `onLaunch` to
branch:

```tsx
<StartMenu
  onLaunch={(app) => {
    if (sync.data.config?.experimental?.app_dock === true && dockCtx) {
      // Phase 45 — dock-enabled path: add to dock, don't pin.
      dockCtx.add({
        server: app.server,
        name: app.name,
        uri: app.uri,
        description: app.description,
      })
      return
    }
    // Legacy path: pin + open tab.
    batch(() => {
      pinnedApps.pin({ server: app.server, name: app.name, uri: app.uri, description: app.description })
      void tabs().open(`mcp-app:${app.server}:${encodeURIComponent(app.uri)}`)
    })
  }}
/>
```

Where `dockCtx` is the dock context fetched via the same defensive
pattern (`useContext(DockContext)` with undefined check, or a parent
wrapper that's only rendered when the flag is on).

The session-header.tsx import block needs a new `useAppDockState`
import (or `useContext(DockContext)` if that's the pattern). Match
the convention.

#### Add the "Browse marketplace" link

At the bottom of the Start menu panel, after both app lists:

```tsx
<div class="border-t border-border-weaker-base mt-2 pt-2">
  <a
    href="https://mcpappfoundry.app"
    target="_blank"
    rel="noopener noreferrer"
    class="block w-full text-left px-2 py-2 rounded-sm hover:bg-surface-raised-base transition-colors text-11-regular text-text-weak"
    onClick={() => setOpen(false)}
  >
    <div class="flex items-center justify-between">
      <span>Browse marketplace</span>
      <span class="text-text-weaker">↗</span>
    </div>
  </a>
</div>
```

Use whichever existing pattern start-menu has for external links. If
there isn't one, this is fine.

### `packages/app/src/pages/session/session-side-panel.tsx`

Gate the Apps tab + content on the dock flag being **off**.

The current code at line ~328:

```tsx
<Tabs.Trigger value="apps">
  <div>{language.t("session.tab.apps")}</div>
</Tabs.Trigger>
```

Becomes:

```tsx
<Show when={!dockEnabled()}>
  <Tabs.Trigger value="apps">
    <div>{language.t("session.tab.apps")}</div>
  </Tabs.Trigger>
</Show>
```

And the content at line ~434:

```tsx
<Tabs.Content value="apps" class="...">
  <Show when={activeTab() === "apps"}>
    <McpAppsTab ... />
  </Show>
</Tabs.Content>
```

Becomes:

```tsx
<Show when={!dockEnabled()}>
  <Tabs.Content value="apps" class="...">
    <Show when={activeTab() === "apps"}>
      <McpAppsTab ... />
    </Show>
  </Tabs.Content>
</Show>
```

`dockEnabled()` accessor — add a single computed at the top of the
component reading the config flag the same way Start menu does.

**Edge case:** if the active tab is "apps" at the moment the flag flips
on (rare — would require a config-edit race), the active-tab signal
would point at a no-longer-rendered tab. Phase 42's `tabState` /
`createSessionTabs` helper falls back to a sensible default if the
active tab disappears. Verify this by reading
`packages/app/src/pages/session/helpers.ts` — if the fallback already
handles "tab not in list", you're fine. If not, you need to add a
`createEffect` that re-routes "apps" → "review" (or whatever's
appropriate) when the flag is on. Confirm before coding.

### `docs/adr/009-app-dock.md`

Append a "Phase 45 changelog" subsection:

```markdown
## Phase 45 — Discovery consolidation

When `experimental.app_dock = true`:

- The session strip's "Apps" tab is hidden (Trigger + Content both
  gated on the flag).
- The Start menu (`session-header.tsx`) routes launches to
  `dock.add(app)` instead of `pinnedApps.pin(...) + tabs().open(...)`.
- The Start menu shows "in dock" badges + disables rows for apps
  already added.
- A "Browse marketplace" link surfaces `mcpappfoundry.app` for Phase
  41 discoverability.

Users with the flag off see no change — both the Apps tab and the
legacy launch path remain. Phase 48 removes the legacy path
unconditionally.
```

### `PLAN.md`

Add a Phase 45 entry under Phase 44. Update the header (`Last
updated`, version, test count) once the bump lands.

---

## Files to create

### `packages/app/src/components/start-menu.test.tsx` (~150 lines)

New file — the Start menu has zero tests today (verified via
`find packages/app/src/components -name "start-menu*test*"`). Test
coverage for Phase 45's new behavior:

- Renders Built-in apps (mocked list).
- Renders MCP-server apps (mocked list).
- "in dock" badge appears for apps in the dock when flag is on.
- "in dock" badge does NOT appear when flag is off.
- Clicking an in-dock row is a no-op (button disabled).
- Clicking a non-dock row fires onLaunch with the right app shape.
- "Browse marketplace" link points at mcpappfoundry.app.
- Esc key closes the menu (existing behavior — regression guard).

Mock `useGlobalSync`, `useAppDockState`, and the app-list fetch (which
the menu does internally — see lines ~70-80 of start-menu.tsx for the
exact resource it uses). Match the mocking pattern from
`packages/app/src/components/app-dock/use-dock-state.test.tsx`.

This file requires happy-dom — keep `bun run test:unit` as the runner.

---

## Tests required

**Total: ~20 new tests.**

- `start-menu.test.tsx` — 10+ unit tests covering all new branches.
- `session-side-panel` — no existing test file; if there's a test for
  it, extend with 2 cases ("Apps tab hidden when flag on", "Apps tab
  visible when flag off"). If no test, skip and rely on BDD.
- BDD: 4 new scenarios in `packages/app/e2e/app-dock.spec.ts`:

```gherkin
Scenario: Apps tab is hidden when dock is enabled
  Given LibreCode is running with experimental.app_dock = true
  When I open a session
  Then I should not see the "Apps" tab in the session side panel

Scenario: Apps tab is visible when dock is disabled (regression)
  Given LibreCode is running with experimental.app_dock = false
  When I open a session
  Then I should see the "Apps" tab in the session side panel

Scenario: Start menu launches go to the dock when flag is on
  Given the dock is enabled and currently empty
  When I open the Start menu
  And I click Session Stats
  Then the dock should contain Session Stats
  And the session strip should NOT have a new MCP-app tab

Scenario: "in dock" badge prevents re-adding
  Given the dock contains Session Stats
  When I open the Start menu
  Then Session Stats should be marked "in dock"
  And clicking the Session Stats row should be a no-op
```

Add BDD helpers as needed in `packages/app/e2e/bdd/{given,then}.ts`.

---

## Step-by-step execution order

### Step 1 — Recon

- Read `start-menu.tsx` start-to-finish.
- Read `session-header.tsx` lines 338-360 (the onLaunch wiring).
- Read `session-side-panel.tsx` lines 326-330 + 432-442 (Apps tab + content).
- Read `helpers.ts`'s `createSessionTabs` to confirm what happens when
  the active tab disappears.
- Confirm whether `useAppDockState()` can be called outside
  `AppDockProvider` without throwing. If it throws, you need the
  defensive `useContext(DockContext)` pattern.
- Run `bun run typecheck && bun run lint` — confirm clean baseline.

### Step 2 — "in dock" indicator + disabled rows

- Update `start-menu.tsx` with the `useAppDockState` / config-flag
  reads + the `inDock` accessor + the row rendering changes.
- `bun run typecheck` — clean.

### Step 3 — Session-header onLaunch branch

- Update `session-header.tsx` to branch on the flag inside `onLaunch`.
- `bun run typecheck` — clean.

### Step 4 — Hide Apps tab in side panel

- Update `session-side-panel.tsx` with the two `<Show when={!dockEnabled()}>`
  gates.
- If `createSessionTabs` doesn't gracefully fall back when "apps" tab
  disappears, add a `createEffect` that routes the active tab away from
  "apps" when the flag flips on.
- `bun run typecheck` — clean.

### Step 5 — Browse marketplace link

- Add the bottom link to the Start menu.
- `bun run typecheck` — clean.

### Step 6 — Unit tests for the Start menu

- Create `start-menu.test.tsx`.
- Mock dock context, sync context, app-list fetch.
- Cover all 10+ cases.
- `cd packages/app && bun run test:unit` — all green.

### Step 7 — Manual smoke test

With `experimental.app_dock = true`:

- Open a session. Apps tab NOT visible. Dock is visible.
- Open Start menu. Click Session Stats → appears in dock as a pane.
- Open Start menu again. Session Stats shows "in dock" + disabled.
- Click Activity Graph → appears in dock as second pane. No new
  session-strip tab.
- "Browse marketplace" opens https://mcpappfoundry.app in a new tab.

With `experimental.app_dock = false`:

- Open a session. Apps tab IS visible. Dock is not.
- Open Start menu. Click Session Stats → pins as a tab (legacy
  behavior unchanged).

### Step 8 — BDD/E2E

- Extend `packages/app/e2e/app-dock.spec.ts` with the 4 new scenarios.
- Add BDD helpers as needed.
- `cd packages/app && bun run test:e2e:local` — all green.

### Step 9 — ADR + PLAN updates

- Append Phase 45 changelog to `docs/adr/009-app-dock.md`.
- Add Phase 45 entry to `PLAN.md`.
- Update PLAN.md header.
- `bunx prettier --check` — clean.

### Step 10 — Final verification

- `bun run typecheck` → clean.
- `bun run lint` → clean (biome + adr-006).
- `cd packages/app && bun run test:unit` → ~20 new tests, all green.
- `cd packages/librecode && bun run test:unit` → no regressions.

### Step 11 — Atomic commits (use these subjects)

1. `feat(start-menu): show "in dock" indicators when dock enabled (Phase 45)`
2. `feat(session-header): route launches to dock when experimental.app_dock = true`
3. `feat(session-side-panel): hide Apps tab when dock enabled`
4. `feat(start-menu): Browse marketplace link to mcpappfoundry.app`
5. `test(start-menu): coverage for dock-aware Start menu behavior`
6. `test(app-dock): BDD scenarios for discovery consolidation`
7. `docs(adr): ADR-009 Phase 45 discovery consolidation changelog`
8. `docs(plan): Phase 45 entry in PLAN.md`

### Step 12 — Bump + push

- Bump to v0.9.85 across all package.jsons + Cargo.toml.
- Commit: `chore: bump version to 0.9.85`.
- Tag `v0.9.85`. Push.
- Watch the release pipeline (~17 minutes based on recent runs).

---

## Verification checklist

- [ ] Start menu shows "in dock" + disables rows for apps already added.
- [ ] Clicking a Start menu row with dock-on calls `dock.add()`, not
      `pinnedApps.pin()`.
- [ ] Apps tab hidden when dock-on; visible when dock-off.
- [ ] Marketplace link present at bottom of Start menu.
- [ ] `bun run typecheck` clean.
- [ ] `bun run lint` clean (biome + adr-006).
- [ ] `cd packages/app && bun run test:unit` — ~20 new tests, all green.
- [ ] `cd packages/librecode && bun run test:unit` — no regressions.
- [ ] BDD scenarios pass (4 new).
- [ ] Manual smoke test (Step 7) — all 5 cases pass.
- [ ] ADR-009 Phase 45 changelog appended.
- [ ] PLAN.md Phase 45 entry added + header refreshed.
- [ ] v0.9.85 release pipeline green.

---

## Common pitfalls

### 1. `useAppDockState()` throws when called outside its provider

Phase 42's hook does `throw new Error(...)` if used outside
`AppDockProvider`. The Start menu mounts inside `SessionHeader`, which
mounts inside the session route. The dock provider also lives inside
that route (Phase 42 wired it there). So in practice the context IS
available. **But don't assume** — read the provider tree and verify
before writing code that assumes the hook works.

If the hook isn't safe everywhere the Start menu mounts, use
`useContext(DockContext)` directly (which returns `undefined` instead
of throwing) and guard:

```ts
import { useContext } from "solid-js"
import { DockContext } from "@/components/app-dock/use-dock-state"
const dockCtx = useContext(DockContext)
const inDock = (app: AppEntry) => (dockCtx?.state().entries ?? []).some((e) => e.uri === app.uri)
```

### 2. Don't break flag-off users

The whole point of feature-flagging Phase 45 is that users without
`experimental.app_dock = true` see ZERO change. Test this explicitly:

- With the flag off, the Apps tab is still in the strip.
- With the flag off, the Start menu still pins as a tab.
- With the flag off, no in-dock badges appear (the dock is empty
  because the user isn't using it).

If you can't manually verify the flag-off path passes the v0.9.84
behavior unchanged, you broke it. Fix before committing.

### 3. The Apps tab might be active when the flag flips on

If a user has `activeTab === "apps"` in localStorage from a previous
session, then enables the flag, the side panel will render with an
active-tab pointing at a no-longer-existing trigger. The
`createSessionTabs` helper has fallback logic — verify it covers this.
If not, add an effect that switches away from "apps" when dock-on.

### 4. The marketplace link is a Phase 41 teaser, not a feature

The link goes to `https://mcpappfoundry.app` (the eventual marketplace
domain). The marketplace API itself isn't live yet. Don't try to
embed search inline here — that's a Phase 41 deliverable. Just the
external link.

### 5. `dock.add()` is the right call, not `dock.toggle()` + `dock.add()`

When the dock is hidden and the user clicks an app in the Start menu,
the dock should auto-open to show the new pane. Phase 42's `dock.add()`
already handles this — it adds the entry AND `addEntry` returns state
with `visibility: "visible"` indirectly. Verify by reading
`use-dock-state.tsx`. If the auto-open doesn't happen, call
`dock.toggle()` after `dock.add()` to force open.

Actually, double-check this: Phase 42's `addEntry` does NOT set
`visibility: "visible"`. Only `planLegacyMigration` does. The Start
menu's onLaunch may need to explicitly ensure visibility:

```ts
if (dockEnabled() && dockCtx) {
  dockCtx.add({ ... })
  if (dockCtx.state().visibility === "hidden") {
    dockCtx.toggle()
  }
}
```

Confirm and adapt.

### 6. `session-side-panel.tsx` is in the ADR-006 danger zone

It's already in the glob. No new `createResource` should be added in
this phase, but if you find yourself adding one, it needs the
`// adr-006: <reason>` comment.

---

## When you're done

Report back with:

- The 9 commit IDs (8 feature + bump).
- The v0.9.85 release URL.
- Test count delta (e.g., "636 → ~656 app tests, +20").
- Confirmation that all 5 manual smoke test cases passed (3 dock-on
  - 2 dock-off).
- Any deviations from this spec with rationale.
- Any pitfalls hit that aren't in this doc — they go in the Phase 46
  spec's pitfall list.
