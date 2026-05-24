# Phase 44 — Legacy Pinned-Apps Migration (Detailed Execution Spec)

> Written for an executor who hasn't been in the conversation that
> produced the roadmap. Self-contained brief: read top to bottom and
> ship. Phase 43 (multi-pane dock with reorder/collapse) is already
> merged at v0.9.83; this builds directly on it.

---

## Scope adjustment from the original roadmap

The original Phase 44 in `mcp-apps-overhaul-roadmap.md` was framed as
"Workspace-scoped dock state". On inspection of what shipped in
Phases 42–43, that framing turned out to be partially a no-op:

- **Dock state** is already workspace-scoped:
  `Persist.workspace(dir, DOCK_STATE_KEY)` in `use-dock-state.tsx`.
- **Legacy pinned-apps** is also workspace-scoped:
  `Persist.workspace(dir, "pinned-apps")` in `context/pinned-apps.tsx`
  (Phase 32, commit `4cf15d1`).

Both stores are already per-directory. Switching projects already swaps
both. The Control Panel UI is deferred to Phase 47 (App Lifecycle UX),
which is the natural home for it.

The actual user-facing gap is **migration**: a user who pinned apps
under the old tab-strip model in v0.9.81 doesn't see them in the dock
when they flip `experimental.app_dock = true` in v0.9.83. They have to
re-add each app via the "+ Add" popover. That's the high-value work
this phase ships.

So: **Phase 44 is now scoped to legacy pinned-apps → dock migration.**
Tight, focused, ~1 day. The remaining Phase 44 ambitions (Settings UI,
cross-workspace copy) move forward to Phase 47.

---

## Goal (one sentence)

The first time a user opens the App Dock in a workspace that has
pre-existing **tab-pinned MCP apps**, those apps are **automatically
seeded into the dock** in their pin order — one-shot, idempotent, with
a confirmation toast.

## What "done" looks like for THIS phase

A user upgraded from v0.9.83 to v0.9.84:

1. Their `librecode.jsonc` already has `"experimental": { "app_dock": true }`
   (or they enable it for the first time post-upgrade).
2. They have 3 apps already pinned via the legacy tab strip in this
   workspace: Session Stats, Activity Graph, Multica.
3. They open LibreCode and navigate to a session in this workspace.
4. The dock auto-opens (because there are now entries — Phase 42 logic
   already opens the dock when `entries.length > 0` and visibility was
   previously not explicitly hidden).
5. They see the 3 panes stacked in their pin order. Iframes load.
6. A toast appears: "**Restored 3 apps from your tab pins**" with a
   "Learn more" link to the dock docs.
7. They restart LibreCode. The dock still has the 3 apps. The toast
   does NOT reappear (idempotent).
8. They go to a DIFFERENT workspace where they had no pinned apps. The
   dock is empty. No toast.

Other workspaces with their own pinned apps migrate independently the
first time the user visits them.

The legacy `pinned-apps.tsx` storage is **not modified**. The dock and
the legacy tab-pin strip continue to coexist — Phase 48 removes the
legacy strip.

---

## Pre-flight: read these before touching code

### What Phases 42–43 shipped

- `packages/app/src/components/app-dock/` — full multi-pane dock,
  workspace-scoped via `Persist.workspace(dir, "app-dock-state")`.
- `packages/app/src/context/pinned-apps.tsx` — legacy tab-pin storage,
  workspace-scoped via `Persist.workspace(dir, "pinned-apps")`. Shape:
  `{ apps: McpAppResource[] }`.
- `experimental.app_dock` config flag gates dock visibility.

### CLAUDE.md rules (recap)

All the constraints from Phases 42–43 still apply. Notable for this phase:

- **Pure helpers in their own file, tests next to them.** Migration logic
  is a pure function: `(legacyApps, currentDockState) → newDockState | null`
  where `null` means "no migration needed."
- **No semicolons / 120 char width / no `any`.** Standard.
- **ADR-006 lint runs over `app-dock/**`.** Phase 42 added the glob;
it still applies. No new `createResource` calls in this phase, so
  nothing to annotate — but if one sneaks in, comment it.
- **Pre-commit hook**: prettier check on staged files. Run
  `bunx prettier --write <files>` if it flags.

### The idempotency contract

The migration MUST run at most once per workspace. We can't rely on
"if the dock has any entries, skip" because:

- The user might intentionally remove a migrated app, and we mustn't
  re-add it on next launch.
- The user might MANUALLY add apps before any migration runs (e.g.,
  they enable the flag, add Session Stats fresh, and only THEN do we
  notice the legacy pins). Re-migrating would dupe.

Solution: a boolean flag on `DockState` itself —
`migratedFromPinnedAt?: number` (timestamp). Once set, never migrate
again. Mutating the flag without other changes is safe.

---

## Files to create

### `packages/app/src/components/app-dock/migration.ts` (~70 lines)

Pure helper. No Solid, no DOM, no localStorage access.

```ts
import type { McpAppResource } from "@/components/mcp-app-panel/types"
import type { DockEntry, DockState } from "./types"

/**
 * Decide whether to migrate legacy pinned-apps into the dock for the
 * current workspace, and if so, return the new state.
 *
 * Returns `null` when no migration should happen (the migration flag
 * is already set, or there are no legacy apps to migrate). Callers
 * use the null vs non-null distinction to decide whether to surface
 * a toast.
 *
 * Idempotent: callers that see `null` should still call `markMigrated`
 * on the dock state so subsequent passes don't keep checking.
 *
 * Phase 44 — invoked once per workspace on AppDockProvider mount.
 */
export function planLegacyMigration(
  current: DockState,
  legacyApps: ReadonlyArray<McpAppResource>,
  now: number = Date.now(),
): DockState | null {
  // Already migrated — never run again, even if legacy apps changed.
  if (typeof current.migratedFromPinnedAt === "number") return null
  // Nothing to migrate.
  if (legacyApps.length === 0) return null
  // User already added apps to the dock manually — preserve their
  // intent. Mark migrated to short-circuit future runs, but don't
  // duplicate. Caller passes the "no toast" path here.
  if (current.entries.length > 0) {
    return { ...current, migratedFromPinnedAt: now }
  }

  // Seed the dock with the legacy pins in pin order. Use `now` for the
  // entries' addedAt so they sort correctly relative to subsequent
  // adds; preserves pin order via the array order.
  const entries: DockEntry[] = legacyApps.map((app) => ({
    uri: app.uri,
    app: { server: app.server, name: app.name, uri: app.uri, description: app.description },
    addedAt: now,
  }))
  return {
    ...current,
    entries,
    visibility: "visible", // Surface the dock so the user notices.
    migratedFromPinnedAt: now,
  }
}

/**
 * Mark the dock as migrated without seeding anything — used when the
 * user had no legacy pins, or had already manually populated the dock.
 * Avoids the planLegacyMigration check on every reload.
 */
export function markMigrated(current: DockState, now: number = Date.now()): DockState {
  if (typeof current.migratedFromPinnedAt === "number") return current
  return { ...current, migratedFromPinnedAt: now }
}

/**
 * Pure: how many entries WOULD be migrated. Used by the toast copy.
 * Returns 0 when no migration would happen.
 */
export function migrationCount(current: DockState, legacyApps: ReadonlyArray<McpAppResource>): number {
  if (typeof current.migratedFromPinnedAt === "number") return 0
  if (current.entries.length > 0) return 0
  return legacyApps.length
}
```

### `packages/app/src/components/app-dock/migration.test.ts` (~120 lines)

15+ tests:

- `planLegacyMigration` with empty legacy + empty dock → `null`.
- `planLegacyMigration` with already-migrated flag → `null` regardless
  of input.
- `planLegacyMigration` with legacy apps + empty dock + no flag →
  returns new state with N entries in pin order + visibility "visible"
  - `migratedFromPinnedAt` set.
- `planLegacyMigration` with legacy apps + EXISTING dock entries + no
  flag → returns state with flag set but entries unchanged (user's
  manual setup wins).
- Pin order is preserved across migration.
- `addedAt` is set to `now` for all migrated entries.
- `entries` mapping preserves all McpAppResource fields (server, name,
  uri, description).
- `description` undefined in source → undefined in result (not "").
- `markMigrated` on un-migrated state sets the flag.
- `markMigrated` on already-migrated state returns identity (no churn).
- `migrationCount` returns 0 for already-migrated.
- `migrationCount` returns 0 when dock has entries.
- `migrationCount` returns N when both conditions allow migration.
- `planLegacyMigration` doesn't mutate inputs.
- `planLegacyMigration` preserves `width`, `entries`, `visibility`
  fields not relevant to migration when no migration happens.

---

## Files to modify

### `packages/app/src/components/app-dock/types.ts`

Add the migration flag:

```ts
export interface DockState {
  visibility: DockVisibility
  width: number
  entries: DockEntry[]
  /**
   * Phase 44 — timestamp (ms since epoch) when the legacy pinned-apps
   * → dock migration ran for this workspace. Set once on first
   *  AppDockProvider mount; never cleared. Undefined = migration has
   *  not yet run.
   */
  migratedFromPinnedAt?: number
}
```

### `packages/app/src/components/app-dock/state.ts`

Update `migrateDockState` to read the new field:

```ts
// Inside migrateDockState, alongside the existing visibility/width/entries:
const migratedFromPinnedAt =
  typeof obj.migratedFromPinnedAt === "number" && obj.migratedFromPinnedAt > 0 ? obj.migratedFromPinnedAt : undefined

return { visibility, width, entries, migratedFromPinnedAt }
```

(One return path. Make sure no other DockState constructor in the file
drops the field.)

### `packages/app/src/components/app-dock/state.test.ts`

Add 3 tests:

- `migrateDockState` reads `migratedFromPinnedAt: 1700000000` from raw input.
- `migrateDockState` defaults `migratedFromPinnedAt` to `undefined` when missing.
- `migrateDockState` defaults `migratedFromPinnedAt` to `undefined` when value is 0 or negative (defensive — a 0 timestamp would mean "migrated at the epoch", which is nonsense).

### `packages/app/src/components/app-dock/use-dock-state.tsx`

The provider must read the legacy pinned-apps state on mount and invoke
`planLegacyMigration`. If it returns non-null with new entries, set the
store + fire a toast. If non-null without new entries (the "already had
manual setup" case), set the store quietly. If null and the dock is
un-migrated AND has no legacy apps, set the flag quietly.

The Solid context now needs to consume `usePinnedApps()` for the read.
Important: **the legacy context's `pinned` accessor returns the current
list reactively**. We need a one-shot read at provider-mount time, not
a reactive subscription. Use `untrack(() => pinnedApps.pinned())` once
inside `onMount` to grab the snapshot.

```tsx
// Add imports
import { onMount } from "solid-js"
import { usePinnedApps } from "@/context/pinned-apps"
import { showToast } from "@librecode/ui/toast"
import { planLegacyMigration, markMigrated } from "./migration"

// Inside AppDockProvider, AFTER persisted() call:
const pinnedApps = usePinnedApps()
onMount(() => {
  const snapshot = untrack(() => pinnedApps.pinned())
  const next = planLegacyMigration(store as DockState, snapshot)
  if (next) {
    void startTransition(() => setStore(next))
    if (snapshot.length > 0 && (store as DockState).entries.length === 0) {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: `Restored ${snapshot.length} app${snapshot.length === 1 ? "" : "s"} from your tab pins`,
        description: "Find them in the App Dock on the right.",
      })
    }
  } else if (typeof (store as DockState).migratedFromPinnedAt !== "number") {
    // No legacy pins, no existing entries — still mark migrated so we
    // don't re-check on every mount.
    void setStore(markMigrated(store as DockState))
  }
})
```

**Important caveat:** `usePinnedApps()` must be available wherever
`AppDockProvider` mounts. Check the existing provider stack in
`packages/app/src/pages/session.tsx`. If `PinnedAppsProvider` is
NESTED inside `AppDockProvider`, the hook call will throw. Either:

(a) Move `AppDockProvider` to be a CHILD of `PinnedAppsProvider`, OR
(b) Use `useContext(PinnedAppsContext)` directly with a null check
(gracefully skip migration if context is missing).

Verify by reading the current provider tree before touching this file.

### `packages/app/src/components/app-dock/use-dock-state.test.tsx` (new test file)

Component test for the provider's migration hook. Needs happy-dom.

5+ tests:

- New workspace (no legacy, no dock state) → `migratedFromPinnedAt` set,
  no toast.
- New workspace with legacy pins → migration happens, entries seeded,
  toast fires.
- Already-migrated workspace → no re-migration on remount.
- Workspace with both legacy pins AND manually-added dock entries →
  flag is set, entries unchanged, no toast (since user's manual work
  takes precedence).
- Toast text shows the correct app count (1 vs N pluralization).

Mock `usePinnedApps` and `showToast`. Use a test harness that mounts
`AppDockProvider` with controlled props.

### `docs/adr/009-app-dock.md`

Append a "Phase 44 changelog" subsection documenting the migration
contract:

```markdown
## Phase 44 — Legacy pinned-apps migration

The dock now reads the legacy `pinned-apps` context on first mount in
each workspace and seeds itself from those pins. Migration is keyed
on a per-workspace `migratedFromPinnedAt` timestamp in DockState — once
set, never re-runs. The legacy `pinned-apps` storage is untouched
(both systems coexist until Phase 48).

If the user has both legacy pins AND already-added dock entries, the
dock's manual entries win; the migration flag is set so subsequent
mounts skip the check.
```

### `PLAN.md`

Add the Phase 44 entry under Phase 43:

```markdown
### Phase 44: Legacy Pinned-Apps Migration ✅

Detail: `docs/plans/phase-44-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 44 changelog appended in-place)

[ ... ship summary ... ]
```

Update the header's `Last updated` line + test count + version.

---

## Tests required

**Total: ~23 new tests.**

- `migration.test.ts` — 15 tests on the pure planner.
- `state.test.ts` — 3 new tests for the field migration.
- `use-dock-state.test.tsx` — 5 component tests for the provider hook.

### BDD / E2E

One new scenario in `packages/app/e2e/app-dock.spec.ts`:

```gherkin
Scenario: legacy pinned apps migrate to the dock on first open
  Given LibreCode is running with experimental.app_dock = true
  And the workspace has 2 apps pinned via the legacy tab strip
  When I open a session for the first time after enabling the dock
  Then the dock should be visible
  And the dock should contain those 2 apps in pin order
  And a toast saying "Restored 2 apps from your tab pins" should appear

Scenario: migration runs at most once per workspace
  Given the dock has been migrated previously
  When I remove one of the migrated apps
  And I restart LibreCode
  Then the dock should NOT re-add the removed app
```

Seeding the legacy `pinned-apps` localStorage in the test setup is
straightforward — the BDD `Given.providerConfigured`-style helper
pattern at `packages/app/e2e/bdd/given.ts` does exactly this for other
state.

---

## Step-by-step execution order

### Step 1 — Recon

- Re-read `phase-43-spec.md` execution-order section.
- Read the current `app-dock/use-dock-state.tsx` and
  `context/pinned-apps.tsx` to confirm the provider hierarchy.
- Run `bun run typecheck && bun run lint` — confirm clean baseline.

### Step 2 — Pure migration helper

- Create `migration.ts`.
- Create `migration.test.ts` with all 15 cases.
- `cd packages/app && bun run test:unit` — all new tests green.

### Step 3 — DockState field

- Update `types.ts` to add `migratedFromPinnedAt?: number`.
- Update `state.ts`'s `migrateDockState` to read the field with the
  defensive checks.
- Update `state.test.ts` with the 3 new cases.
- Run tests — all green.

### Step 4 — Provider integration

- Determine the provider order in `pages/session.tsx`. If
  `PinnedAppsProvider` is OUTSIDE `AppDockProvider`, you're good. If
  not, fix the order (move `AppDockProvider` to be a child of
  `PinnedAppsProvider`).
- Update `use-dock-state.tsx` to add the `onMount` migration hook.
- `bun run typecheck` — clean.

### Step 5 — Component test for migration

- Create `use-dock-state.test.tsx` with the 5 cases.
- Mock `usePinnedApps` and `showToast`.
- `cd packages/app && bun run test:unit` — all green.

### Step 6 — Manual smoke test

- Local config: `experimental.app_dock = true` is already on
  (from your Phase 42/43 dogfood).
- In a workspace with NO pinned apps + NO dock entries:
  - Open dev. Verify NO toast, dock stays hidden, but a check shows
    `migratedFromPinnedAt` is set in localStorage.
- In a workspace with 2 legacy pinned apps + empty dock:
  - Manually add 2 entries to the legacy `pinned-apps` localStorage
    blob via DevTools (key starts with `librecode.workspace:...:pinned-apps`).
  - Reload. Verify: dock opens with 2 panes in pin order, toast
    appears.
  - Reload again. Verify: no re-migration, no duplicate toast.
- In a workspace where you've already added a dock entry manually:
  - Add a legacy pin to the localStorage manually.
  - Reload. Verify: dock entries unchanged (your manual entry wins),
    flag set, no toast.

### Step 7 — BDD/E2E

- Extend `packages/app/e2e/app-dock.spec.ts` with the 2 new
  scenarios.
- Add a `Given.workspaceHasLegacyPinnedApps(page, apps[])` helper to
  `e2e/bdd/given.ts` that seeds the legacy localStorage.
- `cd packages/app && bun run test:e2e:local` — green.

### Step 8 — ADR + PLAN updates

- Append the Phase 44 changelog section to `docs/adr/009-app-dock.md`.
- Add the Phase 44 entry to `PLAN.md`.
- Update PLAN.md header (`Last updated`, version, test count).
- `bunx prettier --check PLAN.md docs/adr/009-app-dock.md` — clean.

### Step 9 — Final verification

- `bun run typecheck` → clean.
- `bun run lint` → clean (biome + adr-006).
- `cd packages/app && bun run test:unit` → all green, ~23 new tests.
- `cd packages/librecode && bun run test:unit` → no regressions.

### Step 10 — Atomic commits (use these subjects)

1. `feat(app-dock): pure legacy-pinned-apps migration planner (Phase 44)`
2. `feat(app-dock): migratedFromPinnedAt flag in DockState`
3. `feat(app-dock): provider runs migration on first workspace mount`
4. `test(app-dock): provider migration scenarios via mocked legacy ctx`
5. `test(app-dock): BDD scenarios for legacy pin migration`
6. `docs(adr): ADR-009 Phase 44 migration changelog`
7. `docs(plan): Phase 44 entry in PLAN.md`

### Step 11 — Bump + push

- Bump to v0.9.84.
- Commit: `chore: bump version to 0.9.84`.
- Tag `v0.9.84`. Push.
- Watch the release pipeline.

---

## Verification checklist

- [ ] All new files exist; each ≤ 200 lines.
- [ ] `bun run typecheck` clean.
- [ ] `bun run lint` clean (biome + adr-006).
- [ ] `cd packages/app && bun run test:unit` — ~23 new tests, all green.
- [ ] `cd packages/librecode && bun run test:unit` — no regressions.
- [ ] BDD scenarios pass (2 new).
- [ ] Manual smoke test (Step 6) — all 3 cases pass.
- [ ] ADR-009 Phase 44 changelog appended.
- [ ] PLAN.md Phase 44 entry added + header refreshed.
- [ ] v0.9.84 release pipeline green.

---

## Common pitfalls

### 1. Provider order matters

If `AppDockProvider` mounts BEFORE `PinnedAppsProvider`, the
`usePinnedApps()` call throws. Verify the order in
`pages/session.tsx`. If order is wrong: fix the order first, in the
commit that adds the migration hook. Don't paper over it with a
try/catch.

### 2. `untrack` is mandatory in `onMount`

If you read `pinnedApps.pinned()` reactively inside `onMount`, every
change to legacy pins after mount triggers a re-run. We want a
one-shot read at mount-time. Wrap in `untrack(() => ...)`.

### 3. The "user already added apps" branch DOES set the flag

When `current.entries.length > 0`, the planner returns
`{ ...current, migratedFromPinnedAt: now }` — flag set, entries
unchanged. Don't return `null` here, or the migration will keep
running on every reload until the user manually clears the dock.

### 4. `migratedFromPinnedAt = 0` is defensive

A localStorage blob with `migratedFromPinnedAt: 0` could happen if a
serialization bug ever cleared the timestamp to its falsy default.
Treat 0 as "not migrated" to be safe. The `state.ts` migration logic
must check `> 0` not just `typeof === "number"`.

### 5. The toast import path

`@librecode/ui/toast` is the canonical import. Don't bring in a
different toast library or roll your own.

### 6. Don't modify `pinned-apps.tsx`

This phase is read-only against the legacy context. The legacy storage
and its writes continue to work. Phase 48 is the one that removes it.
If you find yourself editing `pinned-apps.tsx`, stop and re-check the
spec — you're going out of scope.

---

## When you're done

Report back with:

- The 8 commit IDs (7 feature + bump).
- The v0.9.84 release URL.
- Test count delta (e.g., "605 → 628 app tests, +23").
- Confirmation that all 3 manual smoke test cases passed.
- Any deviations from this spec with rationale.
- Any pitfalls hit that aren't in this doc — they go in the Phase 45
  spec's pitfall list.

Update PLAN.md's `Last updated` line. Don't delete this spec.
