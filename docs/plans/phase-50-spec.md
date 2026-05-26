# Phase 50 — Keyboard + a11y + Phoenix telemetry polish

> Self-contained execution spec for the next Sonnet worker.
> Phase 50 of the MCP-Apps overhaul (`docs/plans/mcp-apps-overhaul-roadmap.md`).
> Lands on top of Phase 49 + the v0.9.91 dock-visibility hotfix.
> Targets **v0.9.92**.
>
> First phase using the new **preview-smoke template**
> (`docs/plans/preview-smoke-template.md`) as a mandatory verification
> step. Read that doc once before starting.

---

## 0. Why this phase exists

Phases 42–49 built the App Dock end-to-end: prototype, multi-pane,
workspace-scoped state, discovery consolidation, activity model split,
lifecycle UX, legacy cleanup, detachable windows. The dock works.

What it doesn't do yet:

1. **Keyboard navigation beyond the toggle.** `Ctrl+\` toggles
   visibility, but there's no way to focus a specific pane, no
   detach shortcut, no quick way to navigate between panes. Power
   users are stuck reaching for the mouse.
2. **Accessibility landmarks and announcements.** The dock is a
   custom side panel. Screen readers don't know it's a landmark,
   don't announce when panes collapse/expand, and the resize
   handles aren't keyboard-operable.
3. **Performance telemetry.** When the dock has 5+ panes and one is
   slow to mount, we have no observability. Phoenix Arize is wired
   in for LLM telemetry (Phase 35); extending it to dock-pane
   lifecycle gives us latency + remount-count metrics without
   shipping a new vendor.

Phase 50 covers those three. The roadmap also lists **lazy iframe
mount** and **iframe pool** for Phase 50; both are deferred to a
Phase 50b because they tangle with the v0.9.62 state-relay protocol
in non-trivial ways (an app that doesn't implement state-relay would
lose ephemeral state on every collapse — that's a UX regression we
need to mitigate carefully, not slip into a polish phase).

---

## 1. Done-state walkthrough

After Phase 50 ships at **v0.9.92**:

1. **Keyboard power user.** Opens LibreCode. Hits `Ctrl+Shift+1` —
   focus jumps to the first dock pane's header (visible focus ring).
   `Ctrl+Shift+2` jumps to the second. `Ctrl+Shift+0` returns focus
   to the main session view. `Ctrl+Shift+D` while a pane is focused
   triggers the same detach action as the ⤢ button (no-op on web).
2. **Screen reader user** opens LibreCode with VoiceOver/Orca/NVDA
   active. The dock announces as "App dock, complementary landmark."
   Each pane has a `role="region"` with the app name as its
   `aria-label`. Collapsing a pane fires a polite live-region
   announcement: "Session Stats collapsed." Resize handles are
   focusable, announce their min/max/current values, and respond
   to arrow keys (Left/Right adjust width by 16px steps).
3. **Telemetry-opted-in user** (`telemetry.phoenix.enabled = true`
   in config) sees `dock.pane.mounted`, `dock.pane.unmounted`,
   `dock.pane.iframe_ready`, `dock.pane.collapsed`,
   `dock.pane.detached` events fire in the Phoenix project. Each
   carries `paneURI`, `appName`, `ms_since_dock_open`, and
   `session_id` attributes.
4. **Telemetry-opted-out** user (default): no Phoenix calls,
   identical to v0.9.91 behavior.

---

## 2. Scope

### In scope

- Extend `keyboard.ts`: add `Ctrl+Shift+1..9` (focus Nth pane),
  `Ctrl+Shift+0` (focus session view), `Ctrl+Shift+D` (detach
  active pane). Preserve existing `Ctrl+\` toggle.
- A11y audit + fixes:
  - `<aside>` landmark with `role="complementary"` and
    `aria-label="App dock"` on the dock root.
  - Each pane wrapped in `role="region"` with the app name as
    `aria-label`.
  - Polite live region (`aria-live="polite"` `aria-atomic="true"`)
    for collapse/expand/detach/reattach announcements.
  - Resize handles get `role="separator"`,
    `aria-orientation="vertical"`/`"horizontal"`,
    `aria-valuemin`/`max`/`now`, `tabindex="0"`, arrow-key
    handlers for ±16px adjustments.
  - Status dots get `role="status"` (already done in Phase 47, but
    audit for completeness).
- Phoenix telemetry hooks for the dock:
  - `dock.pane.mounted` — fires once per entry on mount.
  - `dock.pane.unmounted` — fires on entry removal.
  - `dock.pane.iframe_ready` — fires when the AppBridge reports ready.
  - `dock.pane.collapsed` / `dock.pane.expanded` — on toggle.
  - `dock.pane.detached` / `dock.pane.reattached` — on lifecycle.
- All events gated behind `sync.data.config?.telemetry?.phoenix?.enabled`.
- 20+ new unit tests across keyboard handler, a11y attribute
  rendering, telemetry-gate fall-through.
- Preview-smoke section per the new template
  (`docs/plans/preview-smoke-template.md`).
- ADR-009 changelog + PLAN.md + CHANGELOG.md.
- Version bump 0.9.91 → 0.9.92.

### Out of scope (explicit defers)

- **Lazy iframe mount** (collapsed → `<Show when={!collapsed()}>`).
  Defer to **Phase 50b** because state preservation requires
  state-relay coordination and an opt-out for naïve apps.
- **Iframe pool / 5-min reuse window**. Same reasoning — entangled
  with lazy mount, both want their own dedicated phase.
- **Visible keyboard-shortcut cheatsheet UI**. Phase 51 polish.
- **Marketplace / install / update flows**. Phase 41 separately.

---

## 3. Constraints

### CLAUDE.md non-negotiables

- No semicolons (TS), 120 char width, named exports, explicit
  return types on exported functions.
- TypeScript strict — no `any`.
- Complexity ≤ 12 per function, file length ≤ 500 (no current dock
  file is close to the limit; keep it that way).
- TDD — failing test first.
- Pre-commit hook runs prettier; pre-push runs root typecheck.

### ADR-006 (Suspense danger zone)

`pages/detached/**` is in the danger-zone glob (added in Phase 49).
No new `createResource` calls expected in Phase 50. The
keyboard/a11y/telemetry surface is all imperative effects;
shouldn't introduce reactive resource fetches.

### Carry-forward from Phase 48 + 49

- **Zod v4 `.default({})` does NOT trigger inner defaults.** Phase
  50's only Zod touch is `telemetry.phoenix.enabled` (already
  defined in v0.9.77 / Phase 35). Don't add new optional fields
  with `.default()` without checking the resulting output type.
- **Specta bindings regenerate broken.** Phase 50 adds no new
  Tauri commands; bindings should not need touching. If you find
  yourself running `cargo test` and `packages/desktop/src/bindings.ts`
  shows up in `git status`, STOP — the LIBRECODE_REGEN_BINDINGS gate
  in `lib.rs` should prevent this. If it doesn't, that's a regression
  to investigate separately.
- **Root-level typecheck is the gate.** Always run `bun run typecheck`
  from the repo root, never just from `packages/app/`. Phase 49's
  v0.9.89→v0.9.90 fix-forward existed because Sonnet only ran the
  package-scoped typecheck.

---

## 4. Files to create

### 4a. `packages/app/src/components/app-dock/telemetry.ts` — NEW

```ts
import { trace, type Span } from "@opentelemetry/api"

/**
 * Dock-pane lifecycle telemetry — Phase 50.
 *
 * Emits OTel spans (consumed by the Phoenix Arize exporter wired in
 * Phase 35). All exports check the runtime-configured enabled flag
 * before emitting; callers don't need to guard.
 *
 * Event names use the `librecode.dock.pane.*` convention to match
 * the existing `librecode.*` namespace used by LLM spans.
 */

export type DockTelemetryEvent =
  | "mounted"
  | "unmounted"
  | "iframe_ready"
  | "collapsed"
  | "expanded"
  | "detached"
  | "reattached"

export interface DockTelemetryPayload {
  paneURI: string
  appName: string
  msSinceDockOpen?: number
  sessionID?: string
}

/**
 * Lazily-resolved tracer — only created when the first event fires.
 * Safe to call even when telemetry is disabled (the no-op tracer
 * returns a no-op span).
 */
function tracer() {
  return trace.getTracer("librecode.app-dock", "1.0.0")
}

/**
 * Emit a single dock-pane lifecycle event. No-ops if `enabled` is false.
 *
 * The `enabled` flag is read from `sync.data.config?.telemetry?.phoenix?.enabled`
 * at the call site — the telemetry layer itself doesn't reach into the
 * config tree to keep this module dependency-free.
 */
export function emitDockEvent(enabled: boolean, event: DockTelemetryEvent, payload: DockTelemetryPayload): void {
  if (!enabled) return
  const span = tracer().startSpan(`librecode.dock.pane.${event}`)
  span.setAttribute("pane.uri", payload.paneURI)
  span.setAttribute("pane.app_name", payload.appName)
  if (payload.msSinceDockOpen !== undefined) {
    span.setAttribute("pane.ms_since_dock_open", payload.msSinceDockOpen)
  }
  if (payload.sessionID) {
    span.setAttribute("session.id", payload.sessionID)
  }
  span.end()
}
```

### 4b. `packages/app/src/components/app-dock/a11y-live.ts` — NEW

```ts
import { createSignal, type Accessor } from "solid-js"

/**
 * Polite live-region announcer for dock lifecycle events.
 *
 * Returns a writable accessor + a signal of the current message.
 * The dock root renders a single hidden `<div aria-live="polite"
 * aria-atomic="true">` reading from this signal. Each new message
 * replaces the previous one; screen readers announce only the
 * latest.
 *
 * Phase 50.
 */
export function createLiveAnnouncer(): {
  announce: (msg: string) => void
  message: Accessor<string>
} {
  const [message, setMessage] = createSignal("")
  let timeout: ReturnType<typeof setTimeout> | undefined

  return {
    announce: (msg: string) => {
      // Brief clear-then-set cycle so the same message announced
      // twice in a row still fires (screen readers ignore unchanged
      // live-region content).
      setMessage("")
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => setMessage(msg), 16)
    },
    message,
  }
}
```

### 4c. Test files

- `packages/app/src/components/app-dock/telemetry.test.ts` — unit
  test the `emitDockEvent` gate, attribute setting (use a fake
  tracer factory).
- `packages/app/src/components/app-dock/a11y-live.test.ts` — unit
  test the announcer (set message, verify accessor, verify same-
  message re-trigger via the clear-then-set cycle, use fake timers).
- Extend `packages/app/src/components/app-dock/keyboard.test.ts`
  with Ctrl+Shift+1..9 / Ctrl+Shift+0 / Ctrl+Shift+D cases.

---

## 5. Files to modify

### 5a. `packages/app/src/components/app-dock/keyboard.ts` — EXTEND

Add new handler factories alongside `makeDockKeyHandler`:

```ts
/**
 * Phase 50 — handler for Ctrl+Shift+1..9 (focus Nth pane) and
 * Ctrl+Shift+0 (return focus to session main).
 */
export function makePaneFocusKeyHandler(
  focusPane: (idx: number) => void,
  focusMain: () => void,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
    const modifier = isMac ? e.metaKey : e.ctrlKey
    if (!modifier || !e.shiftKey) return
    if (e.key === "0") {
      e.preventDefault()
      focusMain()
      return
    }
    if (e.key >= "1" && e.key <= "9") {
      e.preventDefault()
      focusPane(parseInt(e.key, 10) - 1)
    }
  }
}

/**
 * Phase 50 — handler for Ctrl+Shift+D (detach the currently focused pane).
 * `getActiveURI` returns the URI of the pane whose header is focused,
 * or undefined if no pane is focused.
 */
export function makeDetachKeyHandler(
  getActiveURI: () => string | undefined,
  detach: (uri: string) => void,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
    const modifier = isMac ? e.metaKey : e.ctrlKey
    if (!modifier || !e.shiftKey) return
    if (e.key !== "D" && e.key !== "d") return
    const uri = getActiveURI()
    if (!uri) return
    e.preventDefault()
    detach(uri)
  }
}
```

Extend `useDockToggleShortcut` to a more general
`useDockKeyboardShortcuts` that wires all three handlers. Or
add a sibling `useDockPaneKeyboardShortcuts` — match the existing
file's style.

### 5b. `packages/app/src/components/app-dock/dock.tsx` — MODIFY

1. Wrap the dock root in `<aside role="complementary" aria-label="App dock">`.
   (It may already be an `<aside>` — verify and add the role + label.)
2. Wrap each pane body in `<section role="region" aria-label={appName}>`.
3. Add a hidden live region:
   ```jsx
   <div aria-live="polite" aria-atomic="true" class="sr-only">
     {announcer.message()}
   </div>
   ```
4. Wire the announcer to fire on collapse, expand, detach, reattach.
5. Wire telemetry emission at the same lifecycle points. Pass
   `enabled = sync.data.config?.telemetry?.phoenix?.enabled === true`.
6. On `<DockPane>` mount, fire `emitDockEvent(enabled, "mounted", ...)`
   and capture `dockOpenTime = Date.now()` per pane. On unmount, fire
   `"unmounted"`. Use `onMount` / `onCleanup`.

### 5c. `packages/app/src/components/app-dock/pane-header.tsx` — MODIFY

Add `tabindex="0"` to the pane header div (so keyboard focus works).
Verify the header itself is in the focus order; if it's a `<div>`,
the `tabindex` makes it focusable. Update CSS to show a visible
focus ring on `:focus-visible`.

Add `data-pane-index={N}` attribute (passed in from `DockPane`)
so the keyboard handler can `querySelector` to focus the right
pane.

### 5d. `packages/app/src/components/app-dock/dock.tsx` — resize handle a11y

The existing `<PaneDivider>` and the dock-width resize handle need:

```jsx
<div
  role="separator"
  aria-orientation="vertical"
  aria-valuemin={DOCK_MIN_WIDTH}
  aria-valuemax={DOCK_MAX_WIDTH}
  aria-valuenow={dock.state().width}
  tabindex="0"
  onKeyDown={(e) => {
    if (e.key === "ArrowLeft") dock.resize(dock.state().width + 16)
    if (e.key === "ArrowRight") dock.resize(dock.state().width - 16)
  }}
  // ... existing pointer handlers
/>
```

Pane dividers (between vertically-stacked panes) get
`aria-orientation="horizontal"` and arrow-up/down for adjusting
pane heights. Reference: `packages/app/src/components/app-dock/divider.tsx`.

### 5e. `packages/app/src/components/app-dock/use-dock-state.tsx` — EXTEND

Pass announcer + telemetry-enabled flag through. When `collapse(uri)`,
`detach(uri)`, etc. are called, fire both the announcer message AND
the telemetry event. Centralize this so `dock.tsx` doesn't have to
wire each one.

### 5f. Telemetry config plumbing

Check that `sync.data.config?.telemetry?.phoenix?.enabled` is read
correctly. If the config schema's `telemetry.phoenix.enabled` is
named differently, adjust. (Phase 35 established this path.)

### 5g. ADR-009, PLAN.md, CHANGELOG.md

Standard updates. ADR-009 row:

```markdown
| Phase 50 (v0.9.92) | Keyboard navigation (Ctrl+Shift+1..9 / 0 / D), a11y landmarks + live region for collapse/detach announcements + resize-handle keyboard support, Phoenix telemetry hooks for dock-pane lifecycle (gated on telemetry.phoenix.enabled). Defers lazy iframe mount + iframe pool to Phase 50b. |
```

CHANGELOG entry highlights the keyboard shortcuts and the a11y
improvements as user-visible. Telemetry is opt-in invisible.

---

## 6. Tests required

### 6a. `keyboard.test.ts` — extend

- `makePaneFocusKeyHandler` fires `focusPane(0)` on `Ctrl+Shift+1`.
- Same handler fires `focusPane(8)` on `Ctrl+Shift+9`.
- Same handler fires `focusMain()` on `Ctrl+Shift+0`.
- Same handler is a no-op on `Ctrl+1` (no Shift).
- Same handler is a no-op on `Shift+1` (no Ctrl).
- `makeDetachKeyHandler` no-ops when `getActiveURI` returns undefined.
- `makeDetachKeyHandler` calls `detach(uri)` when active.
- Mac variant: `metaKey` substitutes for `ctrlKey`. Use a fake
  `navigator.platform` ("MacIntel") in the test setup.

(8+ new tests.)

### 6b. `a11y-live.test.ts` — new

- `announce("foo")` updates `message()` to `"foo"`.
- Calling `announce` again with the same string still triggers a
  change (clear-then-set cycle).
- Uses fake timers — the 16ms delay must be advanced for the
  set to land.

(3+ new tests.)

### 6c. `telemetry.test.ts` — new

- `emitDockEvent(false, ...)` no-ops (no tracer call).
- `emitDockEvent(true, "mounted", payload)` calls the tracer's
  `startSpan` with the expected name.
- Attributes are set with the correct keys + values.
- Optional payload fields are omitted when undefined (no
  `pane.ms_since_dock_open` attribute set when payload omits it).

Mock the OTel tracer with a fake `startSpan` that captures calls.

(4+ new tests.)

### 6d. `dock.test.tsx` — extend

Add tests asserting:

- The dock root has `role="complementary"` and `aria-label="App dock"`.
- Pane bodies have `role="region"` and `aria-label={app.name}`.
- Resize handles have `role="separator"`, `aria-orientation`,
  `aria-valuemin/max/now`, `tabindex="0"`.
- Live region exists and is `aria-live="polite"`.

(5+ new tests.)

---

## 7. Step-by-step execution order

### Step 1 — Baseline

```bash
cd /home/tristan/Projects/librecode
bun install
bun run typecheck    # MUST be from repo root, not packages/app/
cd packages/app && bun test --timeout 30000 2>&1 | tail -3
cd ../librecode && bun test --timeout 30000 2>&1 | tail -3
```

Record counts. After v0.9.91: ~749 app + ~1987 librecode.

### Step 2 — Pure helpers (telemetry + a11y-live)

1. Create `telemetry.ts` from §4a.
2. Write `telemetry.test.ts` (failing-then-passing TDD).
3. Create `a11y-live.ts` from §4b.
4. Write `a11y-live.test.ts`.
5. Run app tests: ≥+7 from baseline.
6. **Commit**: `feat(app-dock): telemetry + a11y-live pure helpers (Phase 50)`

### Step 3 — Keyboard handlers

1. Extend `keyboard.ts` per §5a.
2. Extend `keyboard.test.ts` per §6a.
3. Wire `useDockPaneKeyboardShortcuts` (or the renamed combined
   hook) into the same call site as `useDockToggleShortcut` —
   probably in `session.tsx` near the existing usage.
4. Run app tests: ≥+8 from previous step.
5. **Commit**: `feat(app-dock): Ctrl+Shift+1..9/0/D keyboard shortcuts (Phase 50)`

### Step 4 — A11y + telemetry wiring in dock.tsx

1. Apply §5b changes (landmarks, regions, live region).
2. Apply §5d changes (resize handle a11y).
3. Apply §5e changes (use-dock-state announcer/telemetry threading).
4. Extend `dock.test.tsx` per §6d.
5. Run all app tests: ≥+5.
6. **Commit**: `feat(app-dock): a11y landmarks + live region + resize-handle keyboard (Phase 50)`

### Step 5 — Telemetry config plumbing

1. Verify the `telemetry.phoenix.enabled` config path matches
   what Phase 35 established.
2. Wire the boolean into the dock components.
3. Test with a config snapshot that has telemetry enabled — verify
   the telemetry path fires. Test with disabled — verify it
   no-ops.
4. **Commit**: `feat(app-dock): Phoenix telemetry for pane lifecycle (Phase 50)`

### Step 6 — Preview smoke (NEW — see §8 below)

Run the smoke checks from §8. All must pass before bumping. If
ANY check fails, STOP, investigate, fix, re-run smoke.

### Step 7 — Docs

Update PLAN.md, ADR-009, CHANGELOG.md per §5g. Single commit:
`docs(adr,plan,changelog): Phase 50 keyboard/a11y/telemetry`.

### Step 8 — Bump + push

1. Bump 0.9.91 → 0.9.92 across all packages + Cargo.toml +
   Cargo.lock (run `cargo check` after Cargo.toml edit).
2. **Commit**: `chore: bump version to 0.9.92`
3. `git push origin main && git tag v0.9.92 && git push origin v0.9.92`
4. Watch `gh run watch <run-id> --exit-status` (run in background;
   wait for completion notification).
5. Verify with `gh release view v0.9.92 --json name,publishedAt,assets`.

---

## 8. Preview smoke (MANDATORY)

Follow `docs/plans/preview-smoke-template.md` for the setup. Then
run these phase-specific checks.

### Setup

1. `preview_start({ name: "librecode-cli" })` — capture CLI_ID.
2. `preview_start({ name: "librecode-web" })` — capture WEB_ID.
3. Confirm CLI logs: "librecode server listening on http://127.0.0.1:4096".
4. Click into the dev project (template §3).
5. Click `[data-testid="dock-try-button"]` to add Session Stats
   to the dock so we have a pane to inspect.

### Check 1 — Landmark + region a11y

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    const dock = document.querySelector('[data-testid="app-dock"]')
    const aside = dock?.closest('aside') ?? dock
    const region = document.querySelector('[role="region"][aria-label="Session Stats"]')
    const live = document.querySelector('[aria-live="polite"]')
    return {
      asideTag: aside?.tagName,
      asideRole: aside?.getAttribute('role'),
      asideLabel: aside?.getAttribute('aria-label'),
      regionFound: !!region,
      liveRegionFound: !!live,
      liveRegionAtomic: live?.getAttribute('aria-atomic'),
    }
  })()
`,
})
```

Expected:

```json
{
  "asideTag": "ASIDE",
  "asideRole": "complementary",
  "asideLabel": "App dock",
  "regionFound": true,
  "liveRegionFound": true,
  "liveRegionAtomic": "true"
}
```

### Check 2 — Resize handle a11y

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    const handle = document.querySelector('[data-testid="dock-resize-handle"]')
    return {
      role: handle?.getAttribute('role'),
      orientation: handle?.getAttribute('aria-orientation'),
      min: handle?.getAttribute('aria-valuemin'),
      max: handle?.getAttribute('aria-valuemax'),
      now: handle?.getAttribute('aria-valuenow'),
      tabindex: handle?.getAttribute('tabindex'),
    }
  })()
`,
})
```

Expected:

```json
{
  "role": "separator",
  "orientation": "vertical",
  "min": "<DOCK_MIN_WIDTH as string>",
  "max": "<DOCK_MAX_WIDTH as string>",
  "now": "320",
  "tabindex": "0"
}
```

### Check 3 — Keyboard arrow-key resize

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    const handle = document.querySelector('[data-testid="dock-resize-handle"]')
    handle?.focus()
    const before = parseInt(handle?.getAttribute('aria-valuenow') ?? '0', 10)
    handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    const after = parseInt(handle?.getAttribute('aria-valuenow') ?? '0', 10)
    return { before, after, delta: after - before }
  })()
`,
})
```

Expected: `delta: 16` (left arrow increases dock width by 16 because
the dock is right-anchored — verify the direction matches the spec
in dock.tsx).

### Check 4 — Collapse announcement

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    // Trigger the collapse button
    document.querySelector('[data-testid="pane-collapse-ui://builtin/session-stats"]')?.click()
    // Read the live region content after a tick
    return new Promise((resolve) => setTimeout(() => {
      const live = document.querySelector('[aria-live="polite"]')
      resolve({ message: live?.textContent?.trim() })
    }, 50))
  })()
`,
})
```

Expected: `{ message: "Session Stats collapsed" }` (or similar).

### Check 5 — Keyboard focus pane

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    // Press Ctrl+Shift+1 globally
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, shiftKey: true, bubbles: true }))
    const focused = document.activeElement
    return {
      tag: focused?.tagName,
      testid: focused?.getAttribute('data-testid'),
      isFirstPaneHeader: focused?.getAttribute('data-testid')?.startsWith('pane-header-'),
    }
  })()
`,
})
```

Expected: `isFirstPaneHeader: true`.

### Check 6 — Telemetry gate (disabled path)

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    // Find any spans recorded by the noop tracer
    // (We assume default config has telemetry.phoenix.enabled = false.)
    // Easiest assertion: window.__librecode_dock_telemetry_calls is undefined
    // if you wire a dev-only window-attached counter for the smoke.
    // Alternative: just inspect the config and confirm disabled state.
    return {
      // Replace with your actual config-inspection path or telemetry-call counter
      telemetryConfigured: window.__librecode_dock_telemetry_calls,
      note: "Manual: confirm Phoenix dashboard shows no dock.pane.* events for this session.",
    }
  })()
`,
})
```

This check is partial — the disabled path is easy to verify; the
enabled path requires standing up a Phoenix endpoint or using the
existing `telemetry.phoenix.enabled` integration test surface.
Don't block the smoke on enabled-path validation; document the
manual verification step in the trip report.

### Check 7 — Console clean

```ts
preview_console_logs({ serverId: WEB_ID, level: "error", lines: 30 })
```

Expected: only `[global-sdk] event stream error` lines (pre-existing
dev-mode SSE noise). No new error categories attributable to Phase 50.

### Cleanup

```ts
// Reset the patched state, if any
preview_stop({ serverId: WEB_ID })
preview_stop({ serverId: CLI_ID })
```

### Smoke verdict

ALL 7 checks must return expected results to declare smoke passed.
A failure halts the phase. Document any deviations in the trip
report's Smoke section.

---

## 9. Verification checklist

- [ ] `bun run typecheck` from REPO ROOT clean.
- [ ] `bun test --timeout 30000` from `packages/app` passes
      (≥749 + new tests).
- [ ] `bun test --timeout 30000` from `packages/librecode` passes
      (no change expected — Phase 50 doesn't touch librecode).
- [ ] `bunx prettier --check .` clean.
- [ ] `bun run lint` clean (ADR-006 checker — no new
      `createResource` calls without annotation).
- [ ] Preview smoke §8: all 7 checks return expected.
- [ ] v0.9.92 GitHub release green with all 14+ assets.
- [ ] Manual eyes-on (desktop): tab through panes with
      Ctrl+Shift+1..9; verify focus ring visible; verify
      announcements with a screen reader if available.

---

## 10. Pitfalls

### Pitfall 1 — Live region clear-then-set race

If you call `announce("X")` and then `announce("Y")` within ~16ms,
the first message may never get read by the screen reader (it
clears before the SR picks it up). The `setTimeout(..., 16)` in
`a11y-live.ts` deliberately spaces messages out. Don't tighten
the timing.

### Pitfall 2 — `tabindex="0"` cascades

Adding `tabindex="0"` to too many elements creates a sluggish
tab order. ONLY add it to pane headers and resize handles, not to
every dock element.

### Pitfall 3 — Keyboard shortcut conflicts

`Ctrl+Shift+1` is used by browsers for tab navigation in some
configurations. The `e.preventDefault()` in the handler should
intercept it, but verify in the smoke. If the browser shortcut
still fires, switch to `Ctrl+Alt+1..9` or document the
limitation.

### Pitfall 4 — `ctrlKey` vs `metaKey` on Mac

The Mac detection uses `navigator.platform.startsWith("Mac")` —
which is being deprecated in browsers in favor of
`navigator.userAgentData.platform`. The existing code uses the
older API for consistency; don't update in this phase, but note
it as tech debt.

### Pitfall 5 — Telemetry disabled path: NEVER import OTel eagerly

Phase 35's design lazy-loads the OTel SDK only when telemetry is
enabled. Importing `@opentelemetry/api` at module top-level is
cheap (it's just type stubs that no-op when no provider is
registered) — but importing `@opentelemetry/sdk-trace-node` or
the Phoenix exporter is expensive. The `tracer()` factory in
§4a only uses `@opentelemetry/api` — safe to eager-import.

### Pitfall 6 — Resize handle keydown direction

The dock is right-anchored. ArrowLeft INCREASES width (handle
moves left); ArrowRight DECREASES width. Test this matches
intuition for users. If it feels backwards, swap and document.

### Pitfall 7 — Pane height arrow keys

Vertically stacked panes have horizontal divider handles between
them. ArrowUp on a horizontal divider should adjust the upper
pane's height, ArrowDown the lower. Get this right.

### Pitfall 8 — Focus ring CSS

`:focus-visible` needs Tailwind utility classes (`focus-visible:ring-2
focus-visible:ring-accent-strong`). Apply uniformly to panes and
handles. Don't apply to ALL elements — that's a regression in
the overall design.

### Pitfall 9 — Smoke template assumes the dev project

The smoke clicks into `~/Projects/librecode` because that's the
cwd of the CLI dev server. If running the smoke from a different
project, adjust the click selector. The template doc covers this.

### Pitfall 10 — Don't widen telemetry scope

Phase 50 telemetry is dock-only. Don't slip in agent-loop or
LLM-call telemetry "while you're there." Those are separate
phases.

---

## 11. Pre-drafted atomic commit subjects

1. `feat(app-dock): telemetry + a11y-live pure helpers (Phase 50)`
2. `feat(app-dock): Ctrl+Shift+1..9/0/D keyboard shortcuts (Phase 50)`
3. `feat(app-dock): a11y landmarks + live region + resize-handle keyboard (Phase 50)`
4. `feat(app-dock): Phoenix telemetry for pane lifecycle (Phase 50)`
5. `docs(adr,plan,changelog): Phase 50 keyboard/a11y/telemetry`
6. `chore: bump version to 0.9.92`

6 commits, one per logical unit. Smoke isn't a commit — it's a
verification gate before commit 6.

---

## 12. When you're done

Trip report format, mandatory Smoke section per the template:

```
| Aspect | Detail |
|---|---|
| Release | v0.9.92 status, asset count, CI duration |
| Commits | N atomic, list of subjects |
| Test delta | app: X → Y (+Z); librecode: no change |
| Typecheck | repo root clean ✓ |
| Manual eyes-on (Tauri) | (if performed, summary; if skipped, note web smoke covered) |
| Deviations | (if any) |
| New pitfalls | (if any surfaced — document for Phase 51) |

Smoke results:
| Check | Result |
|---|---|
| Setup (servers + project entered)     | ✅ |
| Landmark + region a11y                | ✅ |
| Resize handle a11y                    | ✅ |
| Keyboard arrow-key resize             | ✅ |
| Collapse announcement                 | ✅ |
| Keyboard focus pane                   | ✅ |
| Telemetry gate disabled-path          | ✅ (manual enabled-path verification deferred) |
| Console clean of new errors           | ✅ |
```

---

## Appendix A — Recon checksums

Run before starting:

```bash
git rev-parse HEAD                                    # ≥ a599af5 (v0.9.91 bump head)
wc -l packages/app/src/components/app-dock/keyboard.ts        # ~38
wc -l packages/app/src/components/app-dock/dock.tsx           # ~291
wc -l packages/app/src/components/app-dock/use-dock-state.tsx # ~121
grep -c "telemetry.phoenix" packages/librecode/src/config/schema.ts  # ≥1
ls .claude/launch.json                                # exists with librecode-cli + librecode-web entries
ls docs/plans/preview-smoke-template.md               # exists
```

If any baseline differs significantly, re-verify the recon notes
in this spec before executing.

---

## 13. What ships next

Phase 50b — **Lazy iframe mount + iframe pool**. The deferred
items from this phase's roadmap scope. Will tackle the state-relay
coordination needed to make collapse-without-state-loss work for
both opted-in and opted-out apps.

Then Phase 51 — **Public docs + announcement**: user-facing docs
for the dock, dev-facing docs for the AppBridge state-relay
contract, migration guide for users upgrading through the
overhaul, ADR-009 ratification, release narrative.
