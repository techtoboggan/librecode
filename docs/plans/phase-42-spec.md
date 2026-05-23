# Phase 42 — App Dock Prototype (Detailed Execution Spec)

> Written for an executor who hasn't been in the conversation that
> produced the roadmap. Self-contained brief: read this top to bottom and
> ship. References to the wider context are in
> `docs/plans/mcp-apps-overhaul-roadmap.md` if needed; don't read that
> first.

---

## Goal (one sentence)

Add a feature-flagged, right-side **App Dock** that can host **one MCP
app at a time** as a sibling to the existing session side panel —
**additive only, zero disruption to existing UX**.

## What "done" looks like for THIS phase

A user with the flag off sees zero UI change. A user with the flag on:

1. Opens a session.
2. Sees a thin `[ Open dock ]` toggle button in the top-right of the
   session view.
3. Clicks it. A 320px-wide pane slides in from the right (resizable
   between 280–600px). Contains an empty state: "**Add an app to your
   dock**" with a button "Try it: Add Session Stats".
4. Clicks the button. The dock now shows a single pane with the
   Session Stats built-in MCP app rendering live (same component as
   today's pinned-tab view, just in a different layout slot).
5. Closes LibreCode, reopens. Dock is still there with Session Stats
   loaded. Width is preserved.
6. Toggles `Ctrl+\` (Win/Linux) / `Cmd+\` (Mac). Dock hides. Toggles
   again. Dock reappears with the same app.

That's it. No multi-app, no reorder, no settings. Those are Phase 43+.

---

## Constraints — read these before touching code

### 1. AGENTS / CLAUDE.md rules

LibreCode's project rules live in `/CLAUDE.md`. The relevant ones for
this phase:

- **No semicolons. 120 char line width. Named exports only.** Prettier
  enforces this at the pre-commit hook.
- **Cyclomatic complexity ≤ 12.** Decompose anything that exceeds it.
- **Function length ≤ 60 lines.** Extract helpers liberally.
- **File length ≤ 1000 lines.** Stay well under for new code.
- **Nesting depth ≤ 4.** Use early returns + guard clauses.
- **TypeScript strict mode, no `any`.** Use `unknown` + narrowing.
- **No `export namespace`.** Use regular module exports.
- **Tests: `bun test`. Test file pattern: `*.test.ts`.** Colocate next
  to the file under test OR mirror in `packages/app/src/components/*/`.
- **Test runner respects `bunfig.toml` preload.** Must run via
  `bun run test:unit` from `packages/app`, not `bun test` directly
  (the latter doesn't preload happy-dom and breaks on Kobalte imports).
- **Pre-commit hook runs `prettier --check`.** Run
  `bunx prettier --write <files>` before committing.

### 2. ADR-006 (Suspense / `startTransition` pattern)

**MANDATORY.** Any new component in this phase that uses
`createResource` must:

1. Live in the danger-zone glob in `scripts/lint-adr-006.ts`.
2. Carry an inline `// adr-006: <reason>` comment on every
   `createResource` call.
3. Be keyed on a stable mount-time value (NOT on a signal an event
   handler writes).

The dock visibility toggle (`Ctrl+\`) is a classic case where ADR-006
flares — a signal flip triggers a downstream resource load → Suspense
fallback commits → blank pane. **Do not key any resource on the
visibility signal.** All resource loads must be keyed on mount-time
data (the docked app's `server` + `uri` + `sessionID`, which are stable
once the app is added).

The lint runs in pre-commit + the CI lint job; it will fail the commit
if you forget.

### 3. Existing pinning state must not be touched

`packages/app/src/context/pinned-apps.tsx` is the current source of
truth for pinned MCP apps. **Do not modify it.** Phase 44 (workspace
scoping) will refactor it; this phase ships ALONGSIDE it. The dock has
its own state context (`useAppDockState`) and its own persistence key.

A user with the flag on may have apps both pinned-as-tabs (old behavior)
AND in the dock (new behavior). That's fine for the prototype.

### 4. Feature flag default OFF

Add the flag to the existing `experimental` config block:

```ts
// packages/librecode/src/config/schema.ts, around line 700
experimental: z.object({
  // ... existing fields
  app_dock: z.boolean().optional().describe(
    "Enable the experimental App Dock for MCP apps. Phase 42 prototype."
  ),
}).optional(),
```

Default is unset (which is falsy). Users must explicitly opt in by
adding `"experimental": { "app_dock": true }` to their `librecode.jsonc`.

---

## Files to create

### `packages/app/src/components/app-dock/types.ts` (~30 lines)

Pure types. No imports from `@librecode/ui` or `@kobalte/core` so this
can be imported by tests without happy-dom preload.

```ts
import type { McpAppResource } from "@/components/mcp-app-panel/types"

/** A single entry in the dock. v0.9.x prototype — single-pane only. */
export interface DockEntry {
  /** Stable identifier — uses the app's MCP `ui://` URI. */
  uri: string
  /** The full MCP app resource, captured at add-time. */
  app: McpAppResource
  /** When the entry was added — used for diagnostics, not display. */
  addedAt: number
}

/** Dock visibility states. */
export type DockVisibility = "hidden" | "visible"

/** Persisted-to-disk shape of the dock's state. */
export interface DockState {
  visibility: DockVisibility
  /** Dock pane width in px. Clamped to [MIN_WIDTH, MAX_WIDTH] on load. */
  width: number
  /** v0.9.x prototype — single entry only. Array shape for Phase 43 extension. */
  entries: DockEntry[]
}

export const DOCK_MIN_WIDTH = 280
export const DOCK_MAX_WIDTH = 600
export const DOCK_DEFAULT_WIDTH = 320

/** localStorage key suffix (combines with workspace prefix). */
export const DOCK_STATE_KEY = "app-dock-state"
```

### `packages/app/src/components/app-dock/state.ts` (~150 lines, no JSX)

Pure helpers + the persisted state primitive. Testable without DOM.

```ts
import {
  type DockEntry,
  type DockState,
  type DockVisibility,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
} from "./types"

/** Clamp a width value to the allowed range. */
export function clampWidth(value: number): number {
  /* ... */
}

/** Default state for a workspace that's never used the dock. */
export function defaultDockState(): DockState {
  /* ... */
}

/** Migrate raw localStorage values that may be malformed / from a future schema. */
export function migrateDockState(raw: unknown): DockState {
  /* ... */
}

/** Add an entry. No-op if URI already present. Returns new state. */
export function addEntry(state: DockState, entry: Omit<DockEntry, "addedAt">): DockState {
  /* ... */
}

/** Remove by URI. No-op if not present. Returns new state. */
export function removeEntry(state: DockState, uri: string): DockState {
  /* ... */
}

/** Toggle visibility. Returns new state. */
export function toggleVisibility(state: DockState): DockState {
  /* ... */
}

/** Set width — clamps to allowed range. Returns new state. */
export function setWidth(state: DockState, width: number): DockState {
  /* ... */
}
```

All functions pure. No `createSignal`, no `createStore`, no
`startTransition`. Just (state, args) → new state. The component wraps
these in a Solid store.

### `packages/app/src/components/app-dock/state.test.ts` (~120 lines)

Unit tests for every helper. Cases:

- `clampWidth`: under min → MIN. Over max → MAX. In range → identity.
  Negative → MIN. `NaN` → DEFAULT.
- `defaultDockState`: visibility hidden, default width, no entries.
- `migrateDockState`: `undefined`, `null`, `{}`, malformed entries
  array, missing fields, invalid types. All return a valid state with
  sensible defaults.
- `addEntry`: appends. Duplicate URI is a no-op. Order preserved.
- `removeEntry`: drops by URI. Missing URI is a no-op.
- `toggleVisibility`: hidden → visible → hidden.
- `setWidth`: clamps. Passes through valid values.

Target: 15+ tests, 100% coverage of `state.ts`.

### `packages/app/src/components/app-dock/use-dock-state.ts` (~80 lines)

The Solid context + provider. Wraps the persisted store.

```ts
import { createContext, useContext, type ParentComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import { DOCK_STATE_KEY, type DockState } from "./types"
import { addEntry, defaultDockState, migrateDockState, removeEntry, setWidth, toggleVisibility } from "./state"
import { startTransition, untrack } from "solid-js"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

interface DockContextValue {
  state: () => DockState
  toggle: () => void
  add: (app: McpAppResource) => void
  remove: (uri: string) => void
  resize: (width: number) => void
}

const DockContext = createContext<DockContextValue>()

export const AppDockProvider: ParentComponent = (props) => {
  // adr-006: keyed on sdk.directory which is mount-time stable. The
  // persisted store fires NO createResource — it's a synchronous
  // localStorage hydration. Visibility/width changes mutate the store
  // but don't trigger any resource loads.
  const sdk = useSDK()
  const dir = untrack(() => sdk.directory)
  const target = Persist.workspace(dir, DOCK_STATE_KEY)
  const [store, setStore] = persisted(
    { ...target, migrate: migrateDockState },
    createStore<DockState>(defaultDockState()),
  )

  const state = () => store
  const toggle = () => startTransition(() => setStore(toggleVisibility(store)))
  const add = (app: McpAppResource) =>
    startTransition(() => setStore(addEntry(store, { uri: app.uri, app })))
  const remove = (uri: string) => startTransition(() => setStore(removeEntry(store, uri)))
  const resize = (width: number) => setStore(setWidth(store, width))

  return <DockContext.Provider value={{ state, toggle, add, remove, resize }}>{props.children}</DockContext.Provider>
}

export function useAppDockState(): DockContextValue {
  const ctx = useContext(DockContext)
  if (!ctx) throw new Error("useAppDockState must be used inside <AppDockProvider>")
  return ctx
}
```

### `packages/app/src/components/app-dock/dock.tsx` (~150 lines)

The actual side pane. Renders:

- A `<div>` anchored right with `width: state().width + "px"`.
- Hidden when `state().visibility === "hidden"` (return `null`).
- A header with the app name + a "×" remove button.
- A `<McpAppPanel>` for the docked app (if any), or an empty state.
- A left-edge resize handle (dragging adjusts `resize(width)`).

```tsx
import { Show, createSignal, onCleanup } from "solid-js"
import { McpAppPanel } from "@/components/mcp-app-panel"
import type { McpAppResource } from "@/components/mcp-app-panel/types"
import { useAppDockState } from "./use-dock-state"
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "./types"

interface AppDockProps {
  sessionID?: string
  /** Called when the empty-state "Try it" button is clicked. The parent supplies a
   *  built-in app reference (typically Session Stats) so the dock doesn't need to
   *  reach into the built-in-apps registry directly. */
  exampleApp?: McpAppResource
}

export function AppDock(props: AppDockProps) {
  const dock = useAppDockState()
  // ... resize handle drag logic ...
  // ... empty state ...
  // ... single-pane render ...
}
```

Key requirements:

- The single-pane `<McpAppPanel>` mounts once when an entry is added.
  It should NOT re-mount when the dock toggles visibility (use
  CSS `display: none` rather than conditional render, OR use the
  same `forceMount + opacity:0` pattern from `session-side-panel.tsx`).
  This is the iframe-preservation requirement.
- Resize handle: `onPointerDown` captures the pointer, `onPointerMove`
  computes `viewport.innerWidth - event.clientX`, clamps, calls
  `dock.resize()`. `onPointerUp` releases. Standard pattern.
- Empty state: when `entries.length === 0`, show "Add an app to your
  dock" + a "Try it: Add Session Stats" button that calls
  `dock.add(props.exampleApp)`.

### `packages/app/src/components/app-dock/toggle-button.tsx` (~40 lines)

The "[ Open dock ]" button that lives in the session view header.

```tsx
import { useAppDockState } from "./use-dock-state"
import { IconButton } from "@librecode/ui/icon-button"

export function DockToggleButton() {
  const dock = useAppDockState()
  return (
    <IconButton
      icon="layout-sidebar-right"
      onClick={dock.toggle}
      aria-label={dock.state().visibility === "visible" ? "Hide app dock" : "Show app dock"}
      title="Toggle app dock (Ctrl+\\)"
    />
  )
}
```

Use whichever icon name exists in `packages/ui/src/components/app-icons/`
that suggests a right-side panel. If none exist, use "dot-grid"
temporarily.

### `packages/app/src/components/app-dock/index.ts` (~10 lines)

Barrel export:

```ts
export { AppDock } from "./dock"
export { AppDockProvider, useAppDockState } from "./use-dock-state"
export { DockToggleButton } from "./toggle-button"
export type { DockEntry, DockState, DockVisibility } from "./types"
```

### `packages/app/src/components/app-dock/keyboard.ts` (~50 lines)

The `Ctrl+\` shortcut.

```ts
import { onCleanup, onMount } from "solid-js"
import { useAppDockState } from "./use-dock-state"

/**
 * Wire the global Ctrl+\ (Cmd+\ on Mac) shortcut to toggle the dock.
 * Mounted at the AppDockProvider boundary so it's active whenever the
 * dock context exists. Pure side-effect; no return.
 */
export function useDockToggleShortcut() {
  const dock = useAppDockState()
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey
      if (!meta) return
      if (e.key !== "\\") return
      e.preventDefault()
      dock.toggle()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })
}
```

### `packages/app/src/components/app-dock/keyboard.test.ts` (~40 lines)

Unit test for the shortcut wiring. Use happy-dom event dispatching:

- Dispatch `Ctrl+\` → `toggle` called once.
- Dispatch `Ctrl+\` again → `toggle` called twice.
- Dispatch `Ctrl+K` → not called.
- Dispatch `Alt+\` → not called.

Mock the `useAppDockState` hook to inject a spy.

---

## Files to modify

### `packages/librecode/src/config/schema.ts`

Add `app_dock: z.boolean().optional()` to the `experimental` block
(see "Constraints §4" above for the exact placement). One line plus
the `.describe()`.

### `packages/app/src/pages/session.tsx`

Mount the dock alongside the existing session view. Currently:

```tsx
// roughly...
<SessionSidePanel ... />
<MainSessionArea ... />
```

Becomes:

```tsx
<AppDockProvider>
  <DockKeyboardWiring />
  <div class="flex h-full">
    <MainSessionArea ... />
    <Show when={cfg()?.experimental?.app_dock}>
      <AppDock sessionID={params.id} exampleApp={BUILTIN_SESSION_STATS} />
    </Show>
  </div>
  <SessionSidePanel ... />
</AppDockProvider>
```

Where `DockKeyboardWiring` is a thin wrapper that calls
`useDockToggleShortcut()` inside the provider. `BUILTIN_SESSION_STATS`
is imported from the existing built-in apps registry — it's the
McpAppResource shape for the built-in Session Stats app.

**Wrap the dock toggle in `<Show>` keyed on the config flag.** When the
flag is off, the dock and toggle button are not in the tree at all —
zero DOM cost.

Also add `<DockToggleButton>` in the session view's header area (next
to whatever buttons live there today). Search for existing IconButton
calls in `session.tsx` or `session-header.tsx` to find the right spot.

### `packages/app/src/app.tsx` OR a parent that owns config

Make sure `AppDockProvider` wraps the session route. Check the existing
provider stack in `app.tsx` — if `useSDK` is available where Session
mounts, `AppDockProvider` can sit there.

### `scripts/lint-adr-006.ts`

Add the new directory to the danger zone:

```ts
const DANGER_ZONE_GLOBS: ReadonlyArray<string> = [
  "packages/app/src/pages/session/**/*.tsx",
  "packages/app/src/components/start-menu.tsx",
  "packages/app/src/components/mcp-app-panel.tsx",
  "packages/app/src/components/mcp-app-panel/**/*.{ts,tsx}",
  "packages/app/src/context/pinned-apps.tsx",
  "packages/app/src/components/app-dock/**/*.{ts,tsx}", // ← add
]
```

---

## Tests required

**Total: minimum 25 new tests.** Distribution:

### Unit (Bun, `packages/app/src/components/app-dock/`)

1. `state.test.ts` — 15+ tests on the pure helpers (see breakdown above).
2. `keyboard.test.ts` — 4+ tests on shortcut wiring.

Run with: `cd packages/app && bun run test:unit`.

### Solid component (Bun + happy-dom)

3. `dock.test.tsx` — 6+ tests:
   - Renders nothing when visibility hidden.
   - Renders empty state when no entries.
   - Renders pane with `McpAppPanel` when an entry is present.
   - Resize handle changes width via pointer events.
   - Width clamps below MIN and above MAX.
   - Hides without unmounting iframe when toggled (use a marker
     attribute on the iframe to verify it persists).

Mock `McpAppPanel` to a simple `<div data-testid="mcp-app">`. The full
panel's behavior is tested in its own file.

### BDD / E2E (Playwright, `packages/app/e2e/`)

4. `app-dock.feature` or extension to an existing `.feature` file
   (Gherkin format if available; otherwise a TypeScript Playwright
   test that follows the BDD helpers in `packages/app/e2e/bdd/`).

Scenarios:

```gherkin
Feature: App Dock prototype

  Background:
    Given LibreCode is running with experimental.app_dock = true
    And a session is open

  @smoke
  Scenario: dock starts hidden
    Then the app dock should not be visible

  @smoke
  Scenario: toggle button opens the dock
    When I click "Toggle app dock"
    Then the app dock should be visible
    And the empty state "Add an app to your dock" should be shown

  Scenario: keyboard shortcut toggles the dock
    When I press "Ctrl+\\"
    Then the app dock should be visible
    When I press "Ctrl+\\"
    Then the app dock should not be visible

  Scenario: example app adds Session Stats
    When I open the app dock
    And I click "Try it: Add Session Stats"
    Then the app dock should contain "Session Stats"

  Scenario: dock state persists across reload
    When I open the app dock
    And I add the example app
    And I reload the page
    Then the app dock should still be visible
    And it should still contain "Session Stats"
```

Add Playwright BDD helpers as needed in
`packages/app/e2e/bdd/{given,when,then}.ts` — match the existing
pattern.

### Python pytest-bdd (`tests/features/`)

If the user wants cross-language coverage (the project already has
pytest-bdd scaffolding), mirror the smoke scenario:

`tests/features/app-dock.feature` (~30 lines, copy the Gherkin from
above) + steps in `tests/steps/app_dock_steps.py`. Skip if
`tests/features/` is the lower-priority test layer.

### Lint enforcement

5. The ADR-006 lint script (`scripts/lint-adr-006.ts`) must pass with
   the new `app-dock/` glob added. If any `createResource` lacks an
   `adr-006:` justification, fix it in the prototype.

---

## Specs / docs to update

### 1. `docs/adr/009-app-dock.md` (NEW, ~60 lines)

Capture the architectural decision. ADR-009 (next number after 008).
Use the existing ADR format from `docs/adr/`:

```markdown
# ADR-009: App Dock as first-class layout for MCP apps

Date: 2026-05-22
Status: Prototype (Phase 42)

## Context

Through Phases 15–32 we shipped MCP-Apps support as a sequence of
patches against the session side panel's tab strip. The result mixed
7 categories of tabs into one horizontal strip (Review / Apps /
Activity / pinned MCP apps / port previews / Context / file tabs) with
different lifecycles, owners, and interaction models — see
`docs/plans/mcp-apps-ux-redesign.md` for the friction inventory.

## Decision

Pinned MCP apps move to a dedicated right-side App Dock. The session
tab strip keeps only session-scoped content (Review, Timeline, Context,
file tabs, port previews). The dock is workspace-scoped, multi-pane,
and can be detached as a Tauri window (Phase 49).

This ADR captures Phase 42 (prototype): single-pane, feature-flagged,
additive. Subsequent phases (43–51) flesh out the model. This ADR is
the contract; phase docs are the execution plans.

## Consequences

[ ... what changes for users, contributors, app authors ... ]

## Alternatives considered

[ ... brief recap of Options B and C from the redesign doc ... ]
```

### 2. `CLAUDE.md`

Add a short entry under "Architecture Constraints":

```markdown
### App Dock (ADR-009)

MCP apps live in the right-side App Dock (`packages/app/src/components/app-dock/`).
The session tab strip is session-scoped only — do not add MCP apps as
tabs there. The dock is feature-flagged via
`experimental.app_dock` while Phases 42–51 land.
```

### 3. `PLAN.md`

Add a new section after Phase 41 (marketplace plan):

```markdown
### Phase 42: App Dock Prototype ✅ (in progress)

Detail: `docs/plans/phase-42-spec.md`
Roadmap context: `docs/plans/mcp-apps-overhaul-roadmap.md`
ADR: `docs/adr/009-app-dock.md`

[ ... ship summary once the phase commits land ... ]
```

### 4. `docs/architecture.md`

If this file describes the session view layout, add a paragraph about
the dock as a future layout slot (not yet primary).

---

## Step-by-step execution order

Don't deviate. Each step ends with a known-good state.

### Step 1 — Read the constraints

- Re-read this doc, `mcp-apps-overhaul-roadmap.md`, `CLAUDE.md`,
  `docs/adr/006-suspense-starttransition.md`.
- Run `bun install` to ensure the workspace is current.
- Run `bun run typecheck` and `bun run lint` to confirm a clean
  baseline before any edits. Note the current warning count.

### Step 2 — Pure types + state helpers

- Create `packages/app/src/components/app-dock/types.ts`.
- Create `packages/app/src/components/app-dock/state.ts`.
- Create `packages/app/src/components/app-dock/state.test.ts`.
- Run `cd packages/app && bun run test:unit` — expect all new tests
  green.

### Step 3 — Solid context + persistence

- Create `packages/app/src/components/app-dock/use-dock-state.ts`.
- Run `bun run typecheck` — expect clean.

### Step 4 — Component shell

- Create `packages/app/src/components/app-dock/dock.tsx`.
- Create `packages/app/src/components/app-dock/toggle-button.tsx`.
- Create `packages/app/src/components/app-dock/index.ts` (barrel).
- Run `bun run typecheck`.

### Step 5 — Tests for the component

- Create `packages/app/src/components/app-dock/dock.test.tsx`.
- Run `cd packages/app && bun run test:unit` — expect all green.

### Step 6 — Keyboard wiring

- Create `packages/app/src/components/app-dock/keyboard.ts`.
- Create `packages/app/src/components/app-dock/keyboard.test.ts`.
- Run tests.

### Step 7 — Config flag

- Add `app_dock` to `packages/librecode/src/config/schema.ts`.
- Run `bun run typecheck` (the schema changes propagate to SDK types,
  but since this is optional it shouldn't break consumers).
- If the SDK regen is gated, run
  `cd packages/sdk/js && bun run build` — note any drift to fix.

### Step 8 — Mount in session view

- Find the right insertion point in `packages/app/src/pages/session.tsx`
  (or wherever the session route mounts). Add `AppDockProvider`,
  the conditional `<AppDock>`, and the `<DockToggleButton>` in the
  session header.
- Run `bun run typecheck` and `bun run lint`.

### Step 9 — ADR-006 lint update

- Edit `scripts/lint-adr-006.ts` to add the `app-dock/**` glob.
- Run `bun run scripts/lint-adr-006.ts` — expect "✓ N files clean".
- If any unjustified `createResource` call appears, add the
  `adr-006:` comment.

### Step 10 — Manual smoke test

- Add `"experimental": { "app_dock": true }` to your local
  `~/.config/librecode/librecode.jsonc`.
- Run `bun run dev` (or `bun run dev:desktop` for Tauri).
- Open a session. Verify:
  - The dock toggle button appears in the session header.
  - Clicking it opens the dock (320px right pane).
  - Empty state shows. "Try it: Add Session Stats" button works.
  - Session Stats renders in the pane.
  - `Ctrl+\` toggles visibility.
  - Drag the left edge to resize. Width persists across reload.
  - Refresh page — dock state survives.
  - Flip the flag off — dock disappears entirely.

### Step 11 — BDD/E2E

- Create `packages/app/e2e/app-dock.spec.ts` (or `.feature` if Gherkin
  is in use) with the scenarios above.
- Add any new BDD helpers to `e2e/bdd/{given,when,then}.ts`.
- Run `cd packages/app && bun run test:e2e:local` — verify scenarios
  pass.

### Step 12 — ADR + docs

- Write `docs/adr/009-app-dock.md`.
- Update `CLAUDE.md` with the dock entry.
- Update `PLAN.md` with the Phase 42 entry.
- (Skip `docs/architecture.md` if no layout section exists.)

### Step 13 — Final verification

- `bun run typecheck` → clean.
- `bun run lint` → clean (incl. adr-006 check).
- `cd packages/app && bun run test:unit` → all green.
- `cd packages/librecode && bun run test:unit` → all green
  (no regressions).
- `bunx prettier --check .` → clean.

### Step 14 — Commit

Use atomic commits in this order (each prettier-clean, each with a
co-author trailer):

1. `feat(app-dock): pure state helpers + types (Phase 42)`
2. `feat(app-dock): persistence context + Solid provider`
3. `feat(app-dock): dock component + toggle button`
4. `feat(app-dock): keyboard shortcut wiring`
5. `feat(config): add experimental.app_dock flag`
6. `feat(session): mount App Dock when experimental.app_dock = true`
7. `chore(lint): add app-dock to ADR-006 danger zone`
8. `test(app-dock): BDD scenarios for the prototype`
9. `docs(adr): ADR-009 App Dock as first-class layout`
10. `docs(plan): Phase 42 entry in PLAN.md`

Each commit's body explains the WHY (not the what — the diff shows
that). Include test counts in the message ("+15 unit tests"). Match
the style of recent commits in this repo.

### Step 15 — Bump + push

- Bump version to v0.9.82 across all package.jsons + Cargo.toml.
- Commit: `chore: bump version to 0.9.82`.
- Tag `v0.9.82`. Push main + tag.
- Watch the release pipeline. Expect ~18 minutes for a clean run.

---

## Verification checklist

Tick each before declaring Phase 42 done:

- [ ] All new files exist under `packages/app/src/components/app-dock/`.
- [ ] Each new file is ≤ 200 lines (well under the 1000-line limit).
- [ ] `bun run typecheck` clean across all 8 packages.
- [ ] `bun run lint` clean (biome + adr-006).
- [ ] `cd packages/app && bun run test:unit` — all green, ≥25 new tests.
- [ ] `cd packages/librecode && bun run test:unit` — no regressions
      (still 1991 pass).
- [ ] BDD/E2E scenarios pass.
- [ ] Manual smoke test passes (Step 10 above).
- [ ] ADR-009 written, committed.
- [ ] `CLAUDE.md` updated.
- [ ] `PLAN.md` updated.
- [ ] Pre-commit hook fires clean on every commit.
- [ ] v0.9.82 release pipeline green.

---

## Common pitfalls — read these BEFORE writing code

### 1. Don't put `createResource` keyed on visibility

The Phase 32 incidents (v0.9.54, .58, .70, .71) all came from
`createResource` source functions reading signals that event handlers
wrote. The dock visibility is exactly that shape — Ctrl+\ flips a
signal, downstream things may try to load. **Don't make the dock's
visibility a `createResource` source key.** Use plain `<Show>` and
`createSignal`.

### 2. The `McpAppPanel` must survive visibility toggles

If you re-render `<McpAppPanel>` on every toggle, the iframe rebuilds,
the AppBridge tears down, and Session Stats loses its accumulated state.
Two options:

- **Conditional `display:none`**: the panel stays in the DOM, just
  hidden with CSS. Iframe persists.
- **`forceMount` + `opacity:0`**: same pattern as the legacy
  pinned-tab rendering (see `session-side-panel.tsx` line 445–488).

Pick the first — it's simpler. The iframe persists; visibility is a
CSS class.

### 3. happy-dom + Kobalte

Tests that import anything transitively touching `@kobalte/core` will
crash with "Client-only API called on the server side" if happy-dom
isn't preloaded. Solution:

- Keep `state.ts` and `types.ts` import-clean (no Solid, no Kobalte).
  Their tests run anywhere.
- The component test (`dock.test.tsx`) needs happy-dom — run via
  `bun run test:unit` from `packages/app`, NOT `bun test` directly.

This is the same trap that caused v0.9.78's release to fail (commit
`707e17d` extracted helpers for the same reason — see
`local-server-wizard/helpers.ts` for the precedent).

### 4. Don't refactor existing pinned-apps

`packages/app/src/context/pinned-apps.tsx` stays as-is. Phase 44 will
refactor it. Phase 42 ships ALONGSIDE — both systems coexist.

### 5. Don't try to fix multiple Suspense-flash bugs at once

If you see an existing Suspense flash unrelated to the dock, **don't
fix it in this phase**. Open a separate task. Phase 42 is additive
only.

### 6. The "+ Add to dock" button in Phase 43

Phase 42's empty state has a HARD-CODED "Try it: Add Session Stats"
button. Don't try to make this a generic app picker yet — that's
Phase 43 (multi-pane with the Start menu integration). Keep this
phase's prototype tightly scoped.

---

## When you're done

Write a brief summary message that includes:

- The commit IDs (10 atomic commits).
- The v0.9.82 release URL once the pipeline succeeds.
- A screenshot or screen recording of the dock in action (if the user
  can capture one).
- Test count delta (e.g., "1991 → 2016, +25 new").
- Any deviations from this spec (with rationale).
- Any questions or open issues to address before Phase 43.

Then update this doc's "Verification checklist" with the ticks for
record-keeping. Don't delete the spec — Phase 43 will reference it.
