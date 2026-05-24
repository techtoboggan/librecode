# Phase 46 — Activity Duplication Resolution (Detailed Execution Spec)

> Self-contained brief for an executor. Phase 45 (discovery
> consolidation) is merged at v0.9.85. This phase ends the "Activity
> tab vs Activity Graph app" confusion by relabeling the tab to
> "Timeline" and adding an explicit bridge between the two.
>
> Supersedes the Phase 46 stub committed in `7de65ef`. The stub's
> pitfall list is reproduced in full below and is still authoritative.

---

## Design choice up front: display-only rename

Sonnet's Phase 46 stub recommended a **full rename** — change the
internal tab value from `"activity"` to `"timeline"`, migrate persisted
activeTab states, update the Phase 45 redirect effect.

**This spec picks a smaller, safer path: display-only rename.**

Rationale:

- The user-facing problem is the **label**: "Activity" appears twice
  (the tab AND the dock app), confusing users about which is which.
  Rename the tab's user-visible label to "Timeline" and the confusion
  is gone.
- The **internal tab identifier** never appears in the UI. It's a
  string key used by `createSessionTabs` to track active state and by
  Phase 45's redirect effect. Users have `activeTab: "activity"` in
  their persisted state from past sessions — changing the identifier
  would force a migration step.
- Display-only rename: change the `session.tab.activity` i18n VALUE
  from "Activity" to "Timeline". Zero migration. Phase 45's redirect
  to `"activity"` keeps working. The component name (`ActivityTab`)
  stays as-is — internal naming is irrelevant to users.
- The "View as graph" button can still be added without renaming
  anything else.

The full rename can happen in Phase 48 (legacy cleanup) when we're
already doing migrations. Doing it as part of Phase 46 adds risk
without changing what users see.

---

## Goal (one sentence)

The tab labeled "Activity" in the session side panel is relabeled to
"Timeline", and the Timeline content gains a "View as graph" button
that adds the Activity Graph dock app — making the relationship between
the chronological log (tab) and the visualization (dock) explicit.

## What "done" looks like

A user (with or without `experimental.app_dock`):

1. Opens a session. The session tab strip shows: Review · **Timeline**
   · Context · file tabs (instead of "Activity" where "Timeline" now
   is). The tab content is unchanged — same activity grid, same files,
   same agents.
2. (Dock enabled) Inside the Timeline tab, a **"View as graph →"**
   button appears at the top right. Clicking it adds the Activity Graph
   built-in MCP app to the dock if not already present, and visibility
   toggles to "visible" if hidden.
3. (Dock enabled, graph already docked) The button reads "In dock" and
   is disabled.
4. (Dock disabled) The button is hidden. The user sees the Timeline
   tab content alone.
5. The "Activity Graph" app in the dock is unchanged — same
   visualization, same SSE event stream.
6. No more "Activity" appearing twice in the UI. Only:
   - "Timeline" — the session tab (chronological log)
   - "Activity Graph" — the dock app (live visualization)

---

## Pre-flight: read these before touching code

### What Phases 42–45 shipped

- App Dock fully working with multi-pane / reorder / collapse / migration
  / discovery consolidation.
- `experimental.app_dock` config flag gates dock-visible behavior.
- `AppDockProvider` mounts unconditionally; only `<AppDock>` is gated
  on the flag. `useContext(DockContext)` always returns a value inside
  the session route.
- Phase 45 added a `createEffect` in `session-side-panel.tsx` that
  redirects `activeTab === "apps"` → `"activity"` when the dock is
  enabled. **DO NOT touch this effect** — the internal tab value stays
  "activity" under the display-only rename.

### CLAUDE.md rules (recap)

- No semicolons / 120 char width / no `any` / Named exports only.
- ADR-006 lint covers the relevant files. No new `createResource`
  calls expected.
- File size: `session-side-panel.tsx` is ~660 lines; small additions
  are fine. `activity-grid.tsx` is ~232 lines; adding a button +
  prop is small.

### Cross-repo coordination: `librecode-i18n`

The i18n strings live in a separate repo at
`/home/tristan/Projects/librecode-i18n`. The current `package.json`
version there is **0.9.32**.

Current keys in `librecode-i18n/src/app/en.ts`:

```ts
"session.tab.session": "Session",
"session.tab.review": "Review",
"session.tab.context": "Context",
"session.tab.apps": "Apps",
"session.tab.activity": "Activity",  // ← change to "Timeline"
```

Only **en.ts** has `session.tab.activity` today. Other locales fall
back to the English value, so the rename impact is small.

The strategy: change the **value** from `"Activity"` to `"Timeline"`,
keep the **key** as `session.tab.activity`. This gives us the display
rename without changing call sites in the main repo.

### Pitfalls inherited from Phase 45 (still authoritative)

Reproduced from Sonnet's Phase 46 stub:

#### 1. `scripts/release.sh` first arg IS the version string

Not a flag. Calling `scripts/release.sh --dry-run` writes `"--dry-run"`
into every package.json. Always pass the actual version:
`scripts/release.sh 0.9.86`. If the working tree got polluted, use
`git stash` to recover before retrying.

#### 2. AppDockProvider is ALWAYS mounted

It mounts unconditionally in `session.tsx`. Only `<AppDock>` is
conditionally rendered. Therefore:

- `useContext(DockContext)` always returns a `DockContextValue` inside
  the session route — it will NOT be `undefined`.
- `useAppDockState()` is safe to call from any session-mounted
  component.
- You still MUST check `sync.data.config?.experimental?.app_dock`
  before routing actions to the dock. Context existing ≠ dock enabled.

#### 3. "Browse marketplace" is a `MarketplaceDialog` button

The Start menu's marketplace affordance is a modal dialog, not an
`<a href>`. v0.9.64 shipped it. Don't add a second link.

#### 4. `inDock`-style checks must AND the flag with the entries check

`const inDock = (app) => dockEnabled() && entries.some((e) => e.uri === app.uri)`.
For this phase, the same pattern applies to `isGraphInDock`:
`dockEnabled() && entries.some((e) => e.uri === BUILTIN_URI_ACTIVITY_GRAPH)`.

#### 5. Phase 45 `createEffect` redirects "apps" → "activity"

**Under the display-only rename in this phase, this effect stays
unchanged.** The internal tab value remains `"activity"`. The full
rename of the internal value is deferred to Phase 48.

---

## Files to modify

### `~/Projects/librecode-i18n/src/app/en.ts`

Change one line:

```ts
// Was:
"session.tab.activity": "Activity",
// Becomes:
"session.tab.activity": "Timeline",
```

That's the only string change. Don't add `session.tab.timeline` as a
new key — keep the existing key, change its value.

### `~/Projects/librecode-i18n/CHANGELOG.md`

Add a new entry:

```markdown
## [0.9.33] — 2026-05-25

### Changed

- **`session.tab.activity` value**: `"Activity"` → `"Timeline"`. The
  internal tab identifier is unchanged; only the user-facing label
  moves. Pairs with main-repo Phase 46.
```

### `~/Projects/librecode-i18n/package.json`

Bump `version` from `0.9.32` to `0.9.33`.

### `~/Projects/librecode-i18n/` — publish

```bash
cd ~/Projects/librecode-i18n
bun install
bun run typecheck  # or whatever the repo's convention is
git add -A
git commit -m "feat(en): rename session.tab.activity value to Timeline (0.9.33)"
git tag v0.9.33
git push origin main
git push origin v0.9.33
```

The GitHub Actions OIDC publish workflow picks up the tag and
publishes `@librecode/i18n@0.9.33` to npm.

**Wait for the publish to succeed before touching the main repo.**

### `packages/app/package.json` (main repo)

Bump `@librecode/i18n` from current (likely `^0.9.32`) to `^0.9.33`.
Run `bun install`.

### `packages/app/src/components/activity-grid.tsx`

Add the "View as graph" button.

#### Imports

```ts
import { useContext } from "solid-js"
import { DockContext } from "@/components/app-dock/use-dock-state"
import { useGlobalSync } from "@/context/global-sync"
import { BUILTIN_URI_ACTIVITY_GRAPH } from "@/components/mcp-app-panel"
```

(Verify the exact path for `BUILTIN_URI_ACTIVITY_GRAPH` — it's in
`mcp-app-panel/seed.ts`. The public re-export goes through
`mcp-app-panel/index.ts` or possibly `mcp-app-panel.tsx`. Check the
existing import pattern in the codebase.)

#### Inside `ActivityTab`

```tsx
const sync = useGlobalSync()
const dockEnabled = () => sync.data.config?.experimental?.app_dock === true
const dockCtx = useContext(DockContext)

const isGraphInDock = () =>
  dockEnabled() && !!dockCtx && dockCtx.state().entries.some((e) => e.uri === BUILTIN_URI_ACTIVITY_GRAPH)

const openGraphInDock = () => {
  if (!dockEnabled() || !dockCtx) return
  if (!isGraphInDock()) {
    dockCtx.add({
      server: "builtin",
      name: "Activity Graph",
      uri: BUILTIN_URI_ACTIVITY_GRAPH,
      description: "Live visualization of file edits and agent activity",
    })
  }
  if (dockCtx.state().visibility === "hidden") {
    dockCtx.toggle()
  }
}
```

(Confirm the canonical `server` value for built-in apps by reading how
the existing built-in MCP-apps registry shapes Activity Graph. The
value `"builtin"` is a placeholder — check `mcp/builtin-apps/index.ts`
or the equivalent for the actual server name.)

#### Render the button

Inside the JSX, add a header row above `<AgentStatusBar>`:

```tsx
<Show when={dockEnabled()}>
  <div class="flex items-center justify-end px-3 py-2 shrink-0 border-b border-border-weak-base">
    <button
      type="button"
      data-testid="timeline-view-as-graph"
      class="text-11-regular text-text-weak hover:text-text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={isGraphInDock()}
      onClick={openGraphInDock}
      title={isGraphInDock() ? "Activity Graph is already in the dock" : "Add Activity Graph to the dock"}
    >
      <Show when={isGraphInDock()} fallback={<span>View as graph →</span>}>
        <span>In dock</span>
      </Show>
    </button>
  </div>
</Show>
```

Keep the existing `<AgentStatusBar>`, `<FileGrid>`, `<ActivityLegend>`
unchanged below.

### `packages/app/src/components/activity-grid.test.tsx` (extend or create)

If a test file exists, add cases. If not, create one. Cover:

- Button HIDDEN when `dockEnabled()` is false.
- Button VISIBLE when `dockEnabled()` is true.
- Click calls `dockCtx.add()` with the Activity Graph URI.
- Button disabled + shows "In dock" when graph is already there.
- Click on a disabled button is a no-op.
- If dock is hidden when clicking, visibility toggles to "visible".

Use the same `createRoot` + mocked-context pattern Phases 43–45 used.

### `docs/adr/009-app-dock.md`

Append a "Phase 46 changelog" subsection:

```markdown
## Phase 46 — Activity duplication resolution (display-only rename)

The session tab strip's "Activity" label is now "Timeline". The
internal tab identifier and component name (`ActivityTab`) are
unchanged — display-only rename in the i18n layer. The full
identifier rename is deferred to Phase 48 alongside the legacy
pinned-apps removal.

The Timeline tab gains a "View as graph →" button (visible only when
the dock is enabled) that adds the Activity Graph MCP app to the dock.
Clicking when the graph is already docked shows "In dock" and is
disabled.

Net effect: users no longer see "Activity" in two places. The tab is
the chronological event log; the dock app is the live visualization.
The bridge between them is the View-as-graph button.
```

### `PLAN.md`

Add a Phase 46 entry under Phase 45. Update the header (`Last
updated`, version, test count).

### `docs/architecture.md` (optional)

If there's a section describing the session layout / tabs, add a
paragraph:

> **Timeline (tab) vs Activity Graph (dock app).** Both render
> `activity.updated` SSE events. Timeline is a chronological list of
> events (file edits, tool calls, errors) shown in the session tab
> strip. Activity Graph is a live visualization (heatmap) that lives
> in the App Dock when the user pins it. They're complementary views,
> not duplicates.

If no session-layout section exists, skip.

---

## Tests required

**Total: ~8 new tests.**

### Unit (activity-grid.test.tsx)

1. Button hidden when dock disabled.
2. Button visible when dock enabled.
3. Click calls `dockCtx.add()` with the right URI.
4. Disabled + "In dock" when graph already present.
5. No double-add when clicking a disabled button.
6. Visibility toggles to "visible" when adding from hidden state.

### BDD / E2E

7. Add to `packages/app/e2e/app-dock.spec.ts`:

```gherkin
Scenario: Activity tab shows "Timeline" label
  Given LibreCode is running
  When I open a session
  Then I should see a tab labeled "Timeline" in the session strip
  And I should NOT see a tab labeled "Activity"

Scenario: View as graph adds Activity Graph to the dock
  Given the dock is enabled and currently empty
  And I am viewing the Timeline tab
  When I click "View as graph"
  Then the dock should contain Activity Graph
  And the button should now say "In dock" and be disabled
```

---

## Step-by-step execution order

### Step 1 — Recon

- Read `activity-grid.tsx` (current `ActivityTab` implementation).
- Read the `BUILTIN_URI_ACTIVITY_GRAPH` definition + its re-export
  path.
- Read `mcp/builtin-apps/index.ts` (or equivalent) to confirm the
  canonical `server` value for built-in Activity Graph.
- Confirm `useContext(DockContext)` is safe here (per Phase 45
  pitfall #2 — yes, provider mounts unconditionally).
- Read `start-menu.tsx` to confirm `useGlobalSync` is the right
  config-access pattern.
- `bun run typecheck && bun run lint` — clean baseline.

### Step 2 — Cross-repo i18n update

- `cd ~/Projects/librecode-i18n`
- Edit `src/app/en.ts`: change the value for `session.tab.activity`.
- Update `CHANGELOG.md` with the 0.9.33 entry.
- Bump `package.json` version.
- Commit + tag `v0.9.33` + push.
- **Wait** for the npm-publish GH Action to succeed.
- Verify on npm: `npm view @librecode/i18n@0.9.33`.

### Step 3 — Bump dep in main repo

- `cd /home/tristan/Projects/librecode`
- Edit `packages/app/package.json`: `@librecode/i18n` → `^0.9.33`.
- `bun install`.
- `bun run typecheck` — clean.

### Step 4 — View as graph button

- Edit `packages/app/src/components/activity-grid.tsx`: add the
  imports + the dock-aware handlers + the JSX block.
- `bun run typecheck` — clean.
- `bun run lint` — clean.

### Step 5 — Tests

- Extend or create `packages/app/src/components/activity-grid.test.tsx`
  with the 6 unit tests.
- Mock `DockContext` and `useGlobalSync` per existing test patterns.
- `cd packages/app && bun run test:unit` — all green.

### Step 6 — Manual smoke test

With `experimental.app_dock = true`:

- Open a session. Tab strip shows "Timeline" (not "Activity").
- Click the Timeline tab. "View as graph →" button visible at top.
- Click it. Activity Graph appears in the dock. Button now reads
  "In dock" and is disabled.
- Reload. State persists.

With `experimental.app_dock = false`:

- Open a session. Tab strip shows "Timeline".
- Click the Timeline tab. NO "View as graph" button visible.
- Activity Graph still works via legacy pinning if applicable.

### Step 7 — BDD/E2E

- Extend `packages/app/e2e/app-dock.spec.ts` with the 2 new scenarios.
- `cd packages/app && bun run test:e2e:local` — all green.

### Step 8 — ADR + PLAN updates

- Append Phase 46 changelog to `docs/adr/009-app-dock.md`.
- Add Phase 46 entry to `PLAN.md`.
- Update PLAN.md header.
- (Optional) Update `docs/architecture.md`.
- `bunx prettier --check` — clean.

### Step 9 — Final verification

- `bun run typecheck` → clean.
- `bun run lint` → clean (biome + adr-006).
- `cd packages/app && bun run test:unit` → ~8 new tests, all green.
- `cd packages/librecode && bun run test:unit` → no regressions.
- BDD scenarios pass.

### Step 10 — Atomic commits (main repo)

1. `chore(deps): bump @librecode/i18n to 0.9.33 for Timeline label`
2. `feat(timeline): "View as graph" button adds Activity Graph to dock (Phase 46)`
3. `test(timeline): coverage for View-as-graph button + dock integration`
4. `test(app-dock): BDD scenarios for Timeline label + View-as-graph`
5. `docs(adr): ADR-009 Phase 46 activity duplication resolution`
6. `docs(plan): Phase 46 entry + architecture.md timeline note`

The librecode-i18n repo has its own commits — separate concern.

### Step 11 — Bump + push

- Bump main repo to v0.9.86.

  **CRITICAL:** call `scripts/release.sh 0.9.86`, not
  `scripts/release.sh --dry-run`. The first arg IS the version string.

- Commit: `chore: bump version to 0.9.86`.
- Tag `v0.9.86`. Push main + tag.
- Watch the release pipeline (~18 min).

---

## Verification checklist

- [ ] `librecode-i18n` v0.9.33 published to npm.
- [ ] Main repo's `@librecode/i18n` bumped to ^0.9.33.
- [ ] "Timeline" appears in the session tab strip.
- [ ] "View as graph" button works as specified (5 manual cases).
- [ ] `bun run typecheck` clean across all packages.
- [ ] `bun run lint` clean (biome + adr-006).
- [ ] `cd packages/app && bun run test:unit` — ~8 new tests, all green.
- [ ] `cd packages/librecode && bun run test:unit` — no regressions.
- [ ] BDD scenarios pass (2 new).
- [ ] ADR-009 Phase 46 changelog appended.
- [ ] PLAN.md Phase 46 entry + header refresh.
- [ ] v0.9.86 release pipeline green.

---

## Common pitfalls

### 1. The internal tab value stays "activity"

Don't rename the tab value. Don't update Phase 45's `createEffect`
redirect target. Don't migrate persisted activeTab states. The
display-only rename is the whole point — keep the surface narrow.

If you find yourself touching `createSessionTabs` in `helpers.ts`,
stop and re-check the spec. You're going out of scope.

### 2. Cross-repo dependency order matters

The i18n repo must publish 0.9.33 to npm BEFORE the main repo bumps
the dep. If you commit the bump in the main repo before the i18n
publish succeeds, CI will fail with "Cannot find module
@librecode/i18n@0.9.33".

If the i18n publish GitHub Action fails for any reason, fix it there
first.

### 3. `BUILTIN_URI_ACTIVITY_GRAPH` import path

The constant lives in `packages/app/src/components/mcp-app-panel/seed.ts`
(per the Phase 31 split). Use the public re-export path consistent
with how Phase 45 references built-in apps. Check `start-menu.tsx`'s
imports for the canonical pattern.

### 4. The "View as graph" button is hidden when dock disabled

If `dockEnabled() === false`, the button must not appear. Wrap in
`<Show when={dockEnabled()}>`. The flag-off path keeps the Timeline
tab exactly as it is today — no new UI, no new behavior, no surprise.

### 5. The dock might be hidden when the button is clicked

After `dockCtx.add()`, the dock might still be visually hidden if the
user toggled it off. Call `dockCtx.toggle()` if visibility is "hidden"
after the add. Verify by reading Phase 42's `addEntry` — it does NOT
flip visibility (only `planLegacyMigration` does). So an explicit
toggle is required.

### 6. Don't add a `session.tab.timeline` key

The strategy is to change the VALUE of the existing
`session.tab.activity` key, not add a new key. Adding a new key would
require all call sites to update, increasing scope. Keep the key,
change its value.

The i18n key technically lies about its content
(`session.tab.activity` returns "Timeline"). That's fine — the key is
internal; users never see it. Phase 48 can do the proper key rename
alongside other legacy cleanup.

### 7. Confirm the canonical Activity Graph app shape

The `dockCtx.add()` call needs the exact `{ server, name, uri,
description }` shape that the dock expects. Phase 44's migration
helper or Phase 28's built-in apps registry is the source of truth.
Don't invent a shape — read the existing one.

If the built-in app's server is something like `"librecode-builtin"`
or `"core"` rather than `"builtin"`, use the real value. A mismatch
will appear in the dock as a phantom entry that doesn't render.

---

## When you're done

Report back with:

- The 6 commit IDs in main repo + the 1 commit in librecode-i18n.
- The v0.9.86 release URL.
- The librecode-i18n v0.9.33 npm URL.
- Test count delta (e.g., "652 → ~660 app tests, +8").
- Confirmation that all 5 manual smoke test cases passed.
- Any deviations from this spec with rationale.
- Any new pitfalls discovered — fold them into Phase 47 stub or a
  fresh `docs/plans/phase-47-spec.md`.

Update PLAN.md's `Last updated` line. Don't delete this spec.
