# Phase 50b — Lazy iframe mount + iframe pool

> Self-contained execution spec for the next Sonnet worker.
> Phase 50b of the MCP-Apps overhaul (`docs/plans/mcp-apps-overhaul-roadmap.md`).
> Lands on top of Phase 50 (v0.9.92). Targets **v0.9.93**.
>
> Covers the two items explicitly deferred from Phase 50: **lazy
> iframe mount** (collapsed panes' iframes unmount entirely) and
> **iframe pool** (reuse recently-closed iframes within a 5-minute
> window). Both tangle with the v0.9.62/v0.9.63 state-relay
> protocol — most of the spec is about safely doing the unmount
> without breaking apps that don't persist state cleanly.
>
> **Structure**: Sub-A (state-relay awareness + lazy mount + per-app
> opt-out) is the **primary deliverable**. Sub-B (iframe pool with
> LRU + TTL) is a **stretch goal** with an explicit scope-cut
> point — if it gets hairy you ship Sub-A alone and Phase 50c
> picks up the pool later. That matches the Phase 49 spike
> pattern: don't grind past the timebox.

---

## 0. Why this phase exists

After Phase 50 the dock has full keyboard + a11y + telemetry. But
iframe lifecycle is still suboptimal:

1. **Every pane's iframe loads on dock mount**, whether or not the
   user expanded the pane. Five collapsed Multica iframes still cost
   the same memory + WebKit process slots as five expanded ones,
   because Phase 43 used `display:none` (kept alive) to avoid
   collapse-state loss.
2. **Re-pinning a recently-removed app reloads it cold.** A user who
   removes Stats and then re-adds it 30 seconds later pays the full
   cold-start tax — fetch the HTML, inject CSP, mount the iframe,
   await AppBridge handshake, replay session seed. ~300-500ms in
   dev, ~200ms warm.

The Phase 50 spec deferred these because the trade-off is genuine
state loss. An app that doesn't implement the v0.9.63 state-relay
protocol loses scroll position, modal state, form input, ephemeral
filters when its iframe unmounts. **Phase 50b makes that trade-off
manageable by detecting which apps are state-aware and surfacing a
per-app override.**

Three orthogonal mechanisms in this phase:

- **Lazy mount** turns collapse into a real unmount for unknown
  apps. Memory wins; ephemeral state loss is the cost.
- **Capability detection** marks an app as "keep alive" if any of
  three signals fire: built-in app, observed state-relay traffic, or
  user opt-in.
- **Iframe pool** (stretch) keeps recently-removed iframes parked
  outside the dock so a re-pin reuses them.

---

## 1. Done-state walkthrough

After Phase 50b ships at **v0.9.93**:

1. **Default user collapses an unknown MCP app pane** (e.g. a
   third-party Notes app). The first time they do this, a toast
   appears: "Notes may reset when collapsed. Use the ⋮ menu to
   override." The iframe unmounts; memory drops. Re-expanding
   mounts a fresh iframe — Notes shows its default state.
2. **Default user collapses a built-in or state-aware app**
   (Stats, Activity Graph, Multica, anything that has ever called
   `mcp-app-state:save`). The iframe stays alive via `display:none`,
   same as v0.9.92. No regression.
3. **User wants to keep their unknown Notes app loaded.** Opens
   the pane menu, toggles "Always keep loaded" on. Future
   collapses preserve the iframe. Config persists in
   `librecode.jsonc` under `mcp_apps[uri].alwaysLoaded`.
4. **Iframe pool win (Sub-B)**: user pins Stats, removes it, pins
   it again within 5 minutes. The remount is instant —
   `dock.pane.iframe_pool_hit` telemetry fires; no cold-start
   handshake. Outside the 5-minute window, fresh mount as before.
5. **Memory footprint**: 5 stacked dock panes with 3 collapsed
   (one built-in, one user-pinned, one unknown). The unknown one
   unloaded; the built-in and user-pinned still alive. Net memory
   drop measurable in `chrome://memory-internals` (or DevTools
   memory tab).
6. **Telemetry user** sees new events: `iframe_lazy_mount`,
   `iframe_lazy_unmount`, `iframe_pool_park`, `iframe_pool_hit`,
   `iframe_pool_evict`. All gated on
   `telemetry.phoenix.enabled` per Phase 50.

---

## 2. Scope

### Sub-A: Lazy mount + capability detection (PRIMARY)

This sub-section is the contract. Ship this, the phase succeeds
even if Sub-B is dropped.

**In scope:**

- New module: `packages/app/src/components/app-dock/keep-alive.ts`
  with the three-signal `shouldKeepIframeAlive(entry, observedRelay, config)`
  helper.
- Per-pane "ever observed state-relay traffic" tracking in
  `use-dock-state.tsx` (transient, in-memory only — re-detected on
  reload). The state-relay handler in
  `mcp-app-panel/state-relay.ts` calls a new callback when it
  receives a save message.
- New per-app config field `mcp_apps[uri].alwaysLoaded?: boolean`
  in `packages/librecode/src/config/schema.ts`. Optional, no
  default (treated as `false` when absent).
- Pane menu addition: "Always keep loaded" toggle item next to
  Reconnect / Remove. Persists to the new config field.
- `dock.tsx` pane body: replace `display: collapsed ? "none" : "flex"`
  with a conditional render `<Show when={keepAlive() || !collapsed}>`.
  Iframes for unknown collapsed apps unmount entirely.
- Toast: first time an unknown app is collapsed in a session, fire
  a one-shot informational toast with a link to the pane menu.
  Per-session storage (not persisted — fires once per LibreCode
  launch per app).
- Telemetry hooks: `dock.pane.iframe_lazy_mount`,
  `dock.pane.iframe_lazy_unmount`. Gated on
  `telemetry.phoenix.enabled`.
- 18+ new unit tests across `keep-alive.test.ts`,
  `use-dock-state.test.tsx` (relay-observation tracking), pane-menu
  toggle, schema validation.
- Preview-smoke section per the new template.
- ADR-009 changelog + PLAN.md + CHANGELOG.md.
- Version bump 0.9.92 → 0.9.93.

### Sub-B: Iframe pool (STRETCH)

Ship this only if Sub-A lands cleanly with budget remaining. If
Sub-A consumes the full execution window, skip Sub-B and report
"deferred to Phase 50c."

**In scope (when shipping):**

- New module: `packages/app/src/components/app-dock/iframe-pool.ts`
  with the pool primitive (Map keyed by `${server}:${uri}`,
  per-entry `{ iframe: HTMLIFrameElement, bridge, parkedAt }`).
- TTL: 5 minutes. A `setInterval` cleanup loop evicts entries
  older than 5min.
- LRU eviction: max 3 pooled iframes. Adding a 4th evicts the
  oldest.
- Off-screen host element: `<div id="librecode-iframe-pool" style="display:none; position:absolute; left:-9999px">`
  appended to `document.body`. Pooled iframes live here.
- Integration point: when a `DockPane` unmounts (entry removed,
  not just collapsed), park its iframe in the pool. When a new
  `DockPane` mounts and the pool has a hit for its URI, claim the
  parked iframe + bridge.
- Telemetry: `iframe_pool_park`, `iframe_pool_hit`,
  `iframe_pool_miss`, `iframe_pool_evict`.
- 10+ new unit tests across `iframe-pool.test.ts` (TTL eviction,
  LRU eviction, hit/miss accounting).
- Manual smoke step (in §8): exercise the pool by add/remove/add
  within and outside the 5min window.

### Out of scope (genuinely)

- Adding state-relay support to the existing built-in apps that
  don't have it. They're already on the "keep alive" allow-list,
  so no urgency.
- Surfacing a memory-usage UI to the user. Phoenix telemetry
  covers our visibility; consumer-facing is overkill.
- Cross-window pool (the parked iframe still serves the detached
  Tauri window from Phase 49). Detached windows have their own
  iframe instance; not shared.
- Configurable TTL / pool size. Hard-coded 5min / 3 entries until
  someone needs different values.

---

## 3. Constraints

### CLAUDE.md non-negotiables

- TS: no semicolons, 120-char width, named exports, explicit
  return types.
- No `any`; use `unknown` with narrowing.
- Complexity ≤ 12. File length ≤ 500.
- TDD: failing test first.
- Pre-commit prettier + pre-push root typecheck.

### ADR-006 (Suspense danger zone)

- `dock.tsx` is already audited (Phase 47-50 lint allow-list).
  The new `<Show when={keepAlive() || !collapsed}>` is a pure
  reactive read — no new `createResource`. Safe.
- The toast trigger uses `createEffect` to detect the first
  unknown-app collapse. If the effect inadvertently reads a
  resource, that's a regression — keep it side-effect-only.

### State-relay observation timing

The `createStateRelay` handler runs **outside** Solid's reactive
tree (it's a `window` addEventListener on `message`). When it
sees a save message, it needs to update Solid state via a setter
exposed by the dock context. **Don't** call the setter inside the
handler's hot path without batching — use `batch()` or do a
`queueMicrotask` to avoid blocking the iframe → host message
round-trip.

### Carry-forward from Phase 48 + 49 + 50

- **Zod v4 `.default()` makes optional required.** The new
  `mcp_apps[uri].alwaysLoaded?: boolean` is added as plain
  `z.boolean().optional()` — DO NOT add `.default(false)`.
  Consumers must tolerate `undefined`.
- **Specta bindings regenerate broken.** No new Tauri commands in
  this phase. If `bindings.ts` shows up in `git status`, STOP.
- **Root typecheck is the gate.** Always from repo root.

---

## 4. Files to create

### 4a. `packages/app/src/components/app-dock/keep-alive.ts` — NEW

```ts
import type { DockEntry } from "./types"

/**
 * Phase 50b — decision helper for whether a pane's iframe should
 * stay mounted when collapsed.
 *
 * Three signals trigger "keep alive":
 *
 *   1. **Built-in apps** (`server === "__builtin__"`): always alive.
 *      Built-ins ship inside the LibreCode bundle and are known to
 *      either implement state-relay (Stats, Activity Graph) or have
 *      cheap re-mount paths.
 *   2. **Observed state-relay traffic**: tracked per-session. If
 *      the iframe has ever sent `mcp-app-state:save`, we know it
 *      survives unmount/remount cycles cleanly. Persisted in
 *      transient in-memory map; resets on reload (re-detected).
 *   3. **User opt-in**: per-app config flag
 *      `mcp_apps[uri].alwaysLoaded === true`.
 *
 * Returns `true` if ANY signal is set. Otherwise the iframe is
 * subject to lazy mount (unmount on collapse).
 */
export function shouldKeepIframeAlive(
  entry: Pick<DockEntry, "uri" | "app">,
  observedRelay: ReadonlySet<string>,
  config: { alwaysLoadedByUri?: ReadonlyMap<string, boolean> },
): boolean {
  if (entry.app.server === "__builtin__") return true
  if (observedRelay.has(entry.uri)) return true
  if (config.alwaysLoadedByUri?.get(entry.uri) === true) return true
  return false
}

/**
 * Helper: read the per-app `alwaysLoaded` flag from the config
 * tree. Returns `undefined` if not set (caller treats as `false`).
 *
 * Config shape (added in Phase 50b):
 *   mcp_apps: {
 *     [uri: string]: { alwaysLoaded?: boolean }
 *   }
 */
export function readAlwaysLoaded(
  configMcpApps: Record<string, { alwaysLoaded?: boolean }> | undefined,
  uri: string,
): boolean | undefined {
  return configMcpApps?.[uri]?.alwaysLoaded
}
```

### 4b. `packages/app/src/components/app-dock/keep-alive.test.ts` — NEW

Test the helper. 8+ tests:

- Built-in app → true regardless of observed/config.
- Observed relay traffic → true even if config absent.
- Config `alwaysLoaded: true` → true.
- All three signals false → false.
- `readAlwaysLoaded` returns undefined when config tree absent.
- `readAlwaysLoaded` returns the boolean when set.

### 4c. `packages/app/src/components/app-dock/iframe-pool.ts` — NEW (Sub-B stretch)

```ts
/**
 * Phase 50b Sub-B — iframe pool.
 *
 * When a DockPane is removed (not collapsed — that's lazy mount's
 * job), its iframe + AppBridge are parked here for up to 5 minutes
 * so a subsequent re-pin reuses them without a cold-start
 * handshake.
 *
 * Implementation notes:
 * - Pooled iframes live in an off-screen host element appended to
 *   `document.body`. This keeps them outside Solid's reactive
 *   `<For>` boundaries.
 * - LRU eviction: max 3 entries.
 * - TTL: 5 minutes. A cleanup interval evicts stale entries.
 * - On park: move iframe DOM node from its dock pane to the host;
 *   pause any in-flight bridge work.
 * - On hit: move iframe back into the new dock pane's body.
 * - On miss: caller does fresh mount.
 *
 * **Crucial**: this module manipulates the DOM directly. Callers
 * MUST NOT recreate the iframe element themselves — the
 * `claim()` returns the existing element for the caller to insert.
 */

const POOL_TTL_MS = 5 * 60 * 1000
const POOL_MAX_SIZE = 3
const HOST_ID = "librecode-iframe-pool"

export interface PooledEntry {
  iframe: HTMLIFrameElement
  parkedAt: number
  // Bridge cleanup callback — invoked on eviction so SSE listeners detach.
  cleanup: () => void
}

export interface IframePool {
  park: (key: string, iframe: HTMLIFrameElement, cleanup: () => void) => void
  claim: (key: string) => HTMLIFrameElement | undefined
  has: (key: string) => boolean
  size: () => number
  dispose: () => void
}

/**
 * Create a fresh pool. Tests use this to avoid the
 * module-singleton sharing state across runs. Production code uses
 * the singleton exported below.
 */
export function createIframePool(now: () => number = Date.now): IframePool {
  const entries = new Map<string, PooledEntry>()
  let host: HTMLDivElement | undefined
  let intervalId: ReturnType<typeof setInterval> | undefined

  const ensureHost = (): HTMLDivElement => {
    if (host) return host
    const existing = document.getElementById(HOST_ID)
    if (existing instanceof HTMLDivElement) {
      host = existing
      return host
    }
    host = document.createElement("div")
    host.id = HOST_ID
    host.setAttribute("aria-hidden", "true")
    host.style.cssText = "display:none;position:absolute;left:-9999px;top:-9999px;"
    document.body.appendChild(host)
    return host
  }

  const startCleanup = (): void => {
    if (intervalId !== undefined) return
    intervalId = setInterval(() => {
      const cutoff = now() - POOL_TTL_MS
      for (const [key, entry] of entries) {
        if (entry.parkedAt < cutoff) {
          evict(key)
        }
      }
    }, 30_000)
  }

  const evict = (key: string): void => {
    const entry = entries.get(key)
    if (!entry) return
    try {
      entry.cleanup()
    } catch {
      // Cleanup throwing shouldn't block eviction.
    }
    if (entry.iframe.parentNode) {
      entry.iframe.parentNode.removeChild(entry.iframe)
    }
    entries.delete(key)
  }

  const enforceLru = (): void => {
    while (entries.size > POOL_MAX_SIZE) {
      let oldestKey: string | undefined
      let oldestTime = Infinity
      for (const [k, e] of entries) {
        if (e.parkedAt < oldestTime) {
          oldestTime = e.parkedAt
          oldestKey = k
        }
      }
      if (oldestKey) evict(oldestKey)
    }
  }

  return {
    park: (key, iframe, cleanup) => {
      // If already pooled, evict the old entry first.
      if (entries.has(key)) evict(key)
      ensureHost().appendChild(iframe)
      entries.set(key, { iframe, parkedAt: now(), cleanup })
      enforceLru()
      startCleanup()
    },
    claim: (key) => {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      // Caller is now responsible for the iframe + cleanup.
      return entry.iframe
    },
    has: (key) => entries.has(key),
    size: () => entries.size,
    dispose: () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId)
        intervalId = undefined
      }
      for (const key of [...entries.keys()]) evict(key)
      if (host?.parentNode) {
        host.parentNode.removeChild(host)
        host = undefined
      }
    },
  }
}

/** Module-singleton pool used by dock.tsx. */
let singleton: IframePool | undefined
export function getIframePool(): IframePool {
  if (!singleton) singleton = createIframePool()
  return singleton
}
```

### 4d. `packages/app/src/components/app-dock/iframe-pool.test.ts` — NEW (Sub-B)

10+ tests:

- `park` adds an entry; `has` returns true.
- `park` then `claim` returns the iframe and removes from pool.
- Park beyond `POOL_MAX_SIZE` evicts the oldest entry (LRU).
- Park-then-park same key replaces and disposes the original.
- Eviction calls the cleanup callback.
- TTL: with `now` advanced past 5 min, the cleanup interval
  evicts. (Use a fake `now`; advance time manually.)
- `claim` on a missing key returns undefined.
- `claim` removes the entry (subsequent `has` is false).
- `dispose` clears all entries + removes host.
- Module singleton: `getIframePool()` returns the same instance
  across calls.

---

## 5. Files to modify

### 5a. `packages/librecode/src/config/schema.ts` — add `mcp_apps` field

Find the existing top-level config object schema and add:

```ts
mcp_apps: z
  .record(
    z.string(),
    z.object({
      alwaysLoaded: z.boolean().optional().describe(
        "Phase 50b — keep this app's iframe mounted even when its dock pane is collapsed. " +
          "Default false (iframe unmounts on collapse for memory wins). Set true for apps " +
          "where you want to preserve ephemeral state (scroll position, modals, filters) " +
          "across collapse cycles.",
      ),
    }),
  )
  .optional()
  .describe("Per-app overrides keyed by ui:// URI."),
```

**Don't** add `.default({})` — keep `.optional()` to preserve the
`Config.mcp_apps?` access pattern. (Phase 48 lesson.)

Run `bun run build:schema` to regenerate `schema/config.json`.

### 5b. `packages/app/src/components/mcp-app-panel/state-relay.ts` — observation callback

Extend the factory signature with an optional `onSaveObserved`
callback that fires when a save message is received:

```ts
export function createStateRelay(options: {
  server: string
  uri: string
  fetchFn: FetchLike
  baseUrl: string
  contentWindow: Window | null
  onSaveObserved?: () => void
}): (e: { data?: unknown; source?: unknown }) => void {
  // ... existing impl, plus:
  return async (e) => {
    // ... existing routing
    if (data.type === "mcp-app-state:save") {
      options.onSaveObserved?.()
      // ... existing impl
    }
  }
}
```

### 5c. `packages/app/src/components/app-dock/use-dock-state.tsx` — relay observation set

Add a reactive set of URIs that have been observed emitting
state-relay traffic. Expose `markRelayObserved(uri)` from the
context. Reset on workspace switch (already happens because the
state itself is workspace-scoped — verify this).

Provide an accessor `observedRelay()` returning a `ReadonlySet<string>`
that `dock.tsx` reads when computing `keepAlive`.

The set lives in a Solid `createStore` or `createSignal<Set<string>>`
— pick what matches the existing code style. Mutation via `batch()`
to avoid intermediate renders.

### 5d. `packages/app/src/components/app-dock/dock.tsx` — lazy mount integration

Replace the existing `display:none` pane body with conditional
rendering:

```tsx
// Before (current main):
;<div class="flex-1 min-h-0 overflow-hidden" style={{ display: props.entry.collapsed ? "none" : "flex" }}>
  {/* iframe + status panel */}
</div>

// After:
{
  ;(() => {
    const keepAlive = createMemo(() =>
      shouldKeepIframeAlive({ uri: props.entry.uri, app: props.entry.app }, dock.observedRelay(), {
        alwaysLoadedByUri: alwaysLoadedMap(),
      }),
    )
    return (
      <div
        class="flex-1 min-h-0 overflow-hidden"
        style={{ display: props.entry.collapsed && keepAlive() ? "none" : "flex" }}
      >
        <Show when={keepAlive() || !props.entry.collapsed}>
          {/* iframe + status panel — only mounted when keepAlive OR expanded */}
        </Show>
      </div>
    )
  })()
}
```

`alwaysLoadedMap()` is a memo over `sync.data.config?.mcp_apps`
converted to `Map<uri, boolean>` for `shouldKeepIframeAlive`'s
signature. Compute once per config snapshot.

Also fire telemetry events `iframe_lazy_mount` and
`iframe_lazy_unmount` from `onMount` / `onCleanup` of the lazy-
mounted subtree. These are SEPARATE from the existing
`mounted`/`unmounted` events (which track pane mount, not iframe
mount).

### 5e. `packages/app/src/components/mcp-app-panel.tsx` — wire `onSaveObserved`

The `useEventForwarding` or whichever hook in this 928-line file
sets up `createStateRelay()` — find it and pass through
`onSaveObserved: () => dock.markRelayObserved(uri)`.

`dock` here is via `useAppDockState()` — confirm the panel is
mounted inside `<AppDockProvider>` (it is, via session.tsx).

### 5f. `packages/app/src/components/app-dock/pane-menu.tsx` — "Always keep loaded" toggle

Add a new menu item below "View error" / above "Remove from dock":

```tsx
<Show when={props.canAlwaysKeepLoaded}>
  <button
    type="button"
    data-testid={`pane-menu-always-loaded-${props.uri}`}
    role="menuitemcheckbox"
    aria-checked={props.alwaysLoaded}
    onClick={() => props.onToggleAlwaysLoaded()}
    class="block w-full text-left px-3 py-1.5 text-12-regular rounded-sm hover:bg-surface-raised-base-hover"
  >
    <span aria-hidden="true">{props.alwaysLoaded ? "✓ " : "  "}</span>Always keep loaded
  </button>
</Show>
```

`canAlwaysKeepLoaded` is `true` when the app is NOT a built-in
(built-ins are always kept alive regardless). Render the toggle
only for non-built-in entries.

The handler writes to config:

```ts
const onToggleAlwaysLoaded = async () => {
  const current = sync.data.config?.mcp_apps?.[uri]?.alwaysLoaded ?? false
  await sdk.client.config.update({
    /* shape depends on existing update endpoint */
    mcp_apps: {
      ...(sync.data.config?.mcp_apps ?? {}),
      [uri]: { alwaysLoaded: !current },
    },
  })
}
```

Adapt to the actual config-update API. Look at how Phase 35's
"telemetry.phoenix.enabled" toggle is wired in
`settings-telemetry.tsx` — mirror that pattern.

### 5g. Toast on first unknown-app collapse

In `dock.tsx`'s `onToggleCollapse` handler, after the
`emitDockEvent` call:

```ts
if (nowCollapsed && !keepAlive() && !sessionToastShown.has(props.entry.uri)) {
  sessionToastShown.add(props.entry.uri)
  showToast({
    kind: "info",
    message: `${props.entry.app.name} may reset when collapsed. Configure in the ⋮ menu.`,
    duration: 6000,
  })
}
```

`sessionToastShown` is a module-level `Set<string>` (or per-mount
signal); resets on dock unmount / reload.

### 5h. ADR-009, PLAN.md, CHANGELOG.md

ADR-009 row:

```markdown
| Phase 50b (v0.9.93) | Lazy iframe mount for unknown collapsed panes. Three-signal "keep alive" detection: built-in apps + observed state-relay traffic + per-app `alwaysLoaded` config. New "Always keep loaded" toggle in pane ⋮ menu. (Sub-B stretch: iframe pool with 5-min TTL + LRU-3 eviction for instant re-pin.) |
```

CHANGELOG v0.9.93:

```markdown
## [0.9.93] - 2026-05-XX

### Changed

- **Collapsed dock panes now unmount their iframes** for memory
  wins when the app doesn't implement the state-relay protocol.
  Built-in apps (Stats, Activity Graph) and any app that has
  emitted state-relay traffic stay mounted across collapse cycles
  — same as before. Third-party apps that lose state on collapse
  show a one-shot toast pointing to the new "Always keep loaded"
  toggle in the pane ⋮ menu.

### Added

- New per-app config field `mcp_apps[uri].alwaysLoaded` —
  override the lazy-mount default for a specific MCP app.
- Iframe pool: re-pinning a recently-removed app within 5 minutes
  reuses the existing iframe + bridge for instant restore (no
  cold-start handshake). [Sub-B; ship when shippable.]
```

---

## 6. Tests required

### 6a. `keep-alive.test.ts` — 8+ tests (§4b)

### 6b. `iframe-pool.test.ts` — 10+ tests (§4d) (Sub-B)

### 6c. `use-dock-state.test.tsx` — observation tracking

- `markRelayObserved(uri)` adds the URI to `observedRelay()`.
- Repeated marks are idempotent.
- `observedRelay()` returns the same identity if no marks happen
  (no spurious re-renders).
- The set resets on dock state reset (verify workspace-switch path).

### 6d. `dock.test.tsx` — lazy-mount integration

- With `keepAlive=true` and collapsed → iframe element exists in
  DOM but parent has `display:none`.
- With `keepAlive=false` and collapsed → iframe element does NOT
  exist in DOM (Show evaluates false).
- With `keepAlive=false` and expanded → iframe exists.
- Toggling `alwaysLoaded` via the menu changes the `keepAlive`
  result on next render.

### 6e. `pane-menu.test.tsx` — toggle

- Built-in app: the "Always keep loaded" item is NOT rendered.
- Non-built-in: item is rendered with correct `aria-checked`.
- Click fires the toggle handler.

### 6f. Config schema test

- `mcp_apps` accepts the shape `{ [uri]: { alwaysLoaded: boolean } }`.
- `mcp_apps` is optional; absent config parses cleanly.
- Invalid shape (e.g. `alwaysLoaded: "yes"`) fails validation.

### 6g. `state-relay.test.ts` (extend existing)

- Save message triggers `onSaveObserved` callback if provided.
- No callback: existing behavior unchanged.
- Load message does NOT trigger `onSaveObserved` (only save counts
  as "this app actively persists state").

---

## 7. Step-by-step execution order

### Step 1 — Baseline

```bash
cd /home/tristan/Projects/librecode
bun install
bun run typecheck   # ROOT — must be clean before starting
cd packages/app && bun test --timeout 30000 2>&1 | tail -3
cd ../librecode && bun test --timeout 30000 2>&1 | tail -3
```

Phase 50 baseline: ~777 app + ~1987 librecode tests.

### Step 2 — Pure helpers (TDD)

1. Create `keep-alive.ts` from §4a.
2. Create `keep-alive.test.ts` from §4b — failing → passing.
3. Run app tests; verify +8 from baseline.
4. **Commit**: `feat(app-dock): keep-alive decision helper (Phase 50b)`

### Step 3 — Config schema

1. Edit `packages/librecode/src/config/schema.ts` per §5a.
2. Add schema tests in `packages/librecode/test/config/schema.test.ts`
   per §6f.
3. Run `bun run build:schema` to regenerate `schema/config.json`.
4. Run librecode tests; verify +3-4 from baseline.
5. **Commit**: `feat(config): mcp_apps[uri].alwaysLoaded schema field (Phase 50b)`

### Step 4 — State-relay observation

1. Extend `state-relay.ts` per §5b.
2. Add the observation test cases per §6g to the existing test file.
3. Extend `use-dock-state.tsx` per §5c with `markRelayObserved` +
   `observedRelay()`.
4. Add tests per §6c.
5. Wire `onSaveObserved` in `mcp-app-panel.tsx` per §5e.
6. **Commit**: `feat(app-dock): observe state-relay traffic per app (Phase 50b)`

### Step 5 — Lazy mount in dock.tsx

1. Apply §5d changes (conditional render + alwaysLoadedMap memo +
   telemetry events).
2. Add the toast guard per §5g.
3. Add tests per §6d.
4. Verify the existing dock.test.tsx tests still pass (especially
   collapse/expand iframe-presence assertions — they need updating
   to reflect lazy mount).
5. **Commit**: `feat(app-dock): lazy iframe mount on collapse for unknown apps (Phase 50b)`

### Step 6 — Pane menu toggle

1. Apply §5f changes to `pane-menu.tsx`.
2. Pass `alwaysLoaded` + `canAlwaysKeepLoaded` props from
   `pane-header.tsx` (already a prop pipeline through DockPane).
3. Add tests per §6e.
4. **Commit**: `feat(app-dock): "Always keep loaded" toggle in pane menu (Phase 50b)`

### Step 7 — Sub-B: Iframe pool (STRETCH)

**Before starting**: estimate budget. If the previous steps
consumed most of the execution window, ship Sub-A and skip Sub-B.
Mark in trip report as "Sub-B deferred to Phase 50c."

If shipping:

1. Create `iframe-pool.ts` from §4c.
2. Create `iframe-pool.test.ts` from §4d.
3. Integrate into `dock.tsx`:
   - On `DockPane` cleanup (entry removed, not just collapse):
     `pool.park(key, iframe, cleanup)`.
   - On `DockPane` mount: check `pool.has(key)`; if hit,
     `pool.claim(key)` and reuse.
4. Emit telemetry events: `iframe_pool_park`, `_hit`, `_miss`,
   `_evict`.
5. Add a test verifying remount within TTL reuses; outside TTL
   does not.
6. **Commit**: `feat(app-dock): iframe pool with 5min TTL + LRU-3 eviction (Phase 50b)`

### Step 8 — Preview smoke (MANDATORY)

Run §8 below. All checks must pass.

### Step 9 — Docs

Update PLAN.md, ADR-009, CHANGELOG.md per §5h. Single commit:
`docs(adr,plan,changelog): Phase 50b lazy iframe + pool`.

### Step 10 — Bump + push

1. Bump 0.9.92 → 0.9.93 across packages + Cargo.toml; run
   `cargo check` to refresh Cargo.lock.
2. **Commit**: `chore: bump version to 0.9.93`
3. `git push origin main && git tag v0.9.93 && git push origin v0.9.93`
4. Watch CI in background; verify on completion.

---

## 8. Preview smoke (MANDATORY)

Per `docs/plans/preview-smoke-template.md`. Setup as standard:
start `librecode-cli` + `librecode-web`, click into the
`~/Projects/librecode` dev project, add Session Stats via
`dock-try-button` if not already present.

### Check 1 — Built-in always keep-alive

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    // Collapse Session Stats (built-in)
    document.querySelector('[data-testid="pane-collapse-ui://builtin/session-stats"]')?.click()
    // After collapse: iframe should still exist in the DOM (built-in keep-alive)
    return new Promise((resolve) => setTimeout(() => {
      const iframe = document.querySelector('[data-testid^="pane-header-ui://builtin/session-stats"]')?.parentElement?.querySelector('iframe')
      resolve({ iframeStillMounted: !!iframe })
    }, 100))
  })()
`,
})
```

Expected: `{ iframeStillMounted: true }` — built-ins stay alive.

### Check 2 — Expand back

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  document.querySelector('[data-testid="pane-collapse-ui://builtin/session-stats"]')?.click()
  return 'expanded'
`,
})
```

(No-op verification; just restores the test state.)

### Check 3 — `alwaysLoaded` config write

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (async () => {
    const res = await fetch('http://localhost:4096/config')
    const cfg = await res.json()
    return { mcpAppsField: typeof cfg.mcp_apps, value: cfg.mcp_apps ?? null }
  })()
`,
})
```

Expected: `mcpAppsField: "undefined"` initially (no override yet).
After toggling via menu, re-fetch and assert the new field.

### Check 4 — Toggle from pane menu

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    document.querySelector('[data-testid="pane-menu-ui://builtin/session-stats"]')?.click()
    return new Promise(resolve => setTimeout(() => {
      const item = document.querySelector('[data-testid^="pane-menu-always-loaded-"]')
      resolve({ menuItemExists: !!item, role: item?.getAttribute('role'), ariaChecked: item?.getAttribute('aria-checked') })
    }, 50))
  })()
`,
})
```

Built-in: `menuItemExists: false` (built-ins don't get the
toggle — they're always alive).

To exercise a non-builtin test, the smoke would need to add a
third-party app. Document as a manual step in the trip report
if no third-party MCP server is reachable.

### Check 5 — Lazy unmount on collapse (manual / synthetic)

Force a non-builtin entry into the dock state and verify the
iframe unmounts on collapse:

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    const key = Object.keys(localStorage).find(k => k.includes('app-dock-state'))
    const state = JSON.parse(localStorage.getItem(key))
    state.entries.push({
      uri: 'ui://fake/test',
      app: { server: 'fake', name: 'Fake App', uri: 'ui://fake/test' },
      addedAt: Date.now(),
      collapsed: true,  // pre-collapsed
    })
    localStorage.setItem(key, JSON.stringify(state))
    return { patched: state.entries.length }
  })()
`,
})
preview_eval({ serverId: WEB_ID, expression: `location.reload(); 'reload'` })
```

After reload:

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    const header = document.querySelector('[data-testid="pane-header-ui://fake/test"]')
    const body = header?.parentElement
    const iframe = body?.querySelector('iframe')
    return { headerExists: !!header, iframeMounted: !!iframe }
  })()
`,
})
```

Expected: `headerExists: true, iframeMounted: false` — the
unknown collapsed app's iframe is unmounted. Cleanup: remove the
fake entry from localStorage after the check.

### Check 6 — Iframe pool (Sub-B only)

Skip if Sub-B deferred. Otherwise:

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    const poolHost = document.getElementById('librecode-iframe-pool')
    return { poolHostExists: !!poolHost, poolHidden: getComputedStyle(poolHost ?? document.body).display === 'none' }
  })()
`,
})
```

After triggering an entry removal: assert `poolHost` has 1
child iframe; the parent pane no longer has it.

### Check 7 — Console clean

Standard. Expected: only known SSE noise; no new errors.

### Cleanup

Restore localStorage (remove the fake entry), stop both
preview servers.

---

## 9. Verification checklist

- [ ] Root `bun run typecheck` clean.
- [ ] `bun test --timeout 30000` from `packages/app`: ≥777 + new
      tests.
- [ ] `bun test --timeout 30000` from `packages/librecode`: ≥1987 + schema test.
- [ ] `bunx prettier --check .` clean.
- [ ] `bun run lint` clean (ADR-006 — no new createResource).
- [ ] Preview smoke §8 checks all pass.
- [ ] v0.9.93 release green with all assets.
- [ ] Manual eyes-on (desktop): collapse a third-party app, see
      toast; toggle "Always keep loaded"; verify state preservation
      across collapse on next cycle.

---

## 10. Pitfalls

### Pitfall 1 — `<Show>` re-evaluates on every state tick

`<Show when={keepAlive() || !collapsed}>` will re-evaluate when
EITHER `keepAlive()` or `collapsed` changes. Make sure `keepAlive`
is wrapped in a `createMemo` so it doesn't re-compute the entire
`shouldKeepIframeAlive` call on every render — it only changes
when the underlying signals do.

### Pitfall 2 — Observation tracking race

Sequence: user adds app → app mounts → app calls `save` → handler
calls `markRelayObserved` → state updates → re-render. If the
user collapses the pane DURING the save round-trip, the
`observedRelay` set update might land AFTER the lazy-mount
decision was made. Result: a state-aware app's iframe gets
unmounted prematurely on its very first collapse, losing the state
it was about to save.

Mitigation: in the `onToggleCollapse` handler, do NOT immediately
unmount. Wait one microtask + check `observedRelay` again before
committing the collapse. (Or: optimistically unmount and let the
v0.9.63 protocol's persistence cover it — only fragile state
inside the iframe is lost; persisted state still loads on next
mount.)

The spec defaults to optimistic unmount. If real-world testing
shows naive races, revisit.

### Pitfall 3 — iframe pool DOM ownership

Pooled iframes are owned by the pool host element. When `claim`
returns the iframe, the caller becomes responsible for inserting
it into the new dock pane's body. **Don't** clone the iframe; move
it. Cloning loses the AppBridge connection and breaks the entire
optimization.

Use `parentEl.appendChild(claimedIframe)` — `appendChild` moves
the node (DOM semantics).

### Pitfall 4 — AppBridge state during park

When parking, the iframe is hidden but JavaScript inside it
continues to run. If the app has an animation loop or polling
timer, it keeps burning CPU. The cleanup callback should signal
the app to enter "park mode" — but we have no protocol for that.
Pragmatic answer: accept that parked iframes burn some CPU for
up to 5 min; the win is avoiding cold-start. If this becomes a
problem, define a new AppBridge message
`mcp-app:park` / `mcp-app:resume` in a follow-up phase.

### Pitfall 5 — Pool key includes server + URI

Two apps can share the same `uri` (e.g. `ui://stats` from
different servers). The pool key must be `${server}:${uri}`,
not just `uri`. Don't get this wrong — pool hits across servers
would mount the wrong app.

### Pitfall 6 — Telemetry double-firing

Lazy mount creates a NEW iframe each time the pane uncollapses.
Don't ALSO emit the existing Phase 50 `mounted`/`unmounted`
events for these — those are for the DockPane wrapper, which
doesn't change. The new events are
`iframe_lazy_mount`/`iframe_lazy_unmount` for the inner
iframe lifecycle. Keep them distinct.

### Pitfall 7 — Toast shouldn't fire for built-ins

The toast says "may reset when collapsed." Built-ins don't ever
unmount, so showing the toast for them is a lie. Gate the toast
on `!keepAlive()` BEFORE the collapse takes effect — the order
matters.

### Pitfall 8 — Config update endpoint shape

The "Always keep loaded" toggle writes to config. The actual
config-write API depends on how Phase 35 / settings work — look
at `settings-telemetry.tsx` for the canonical mutation pattern.
Don't invent a new endpoint; use the existing one.

### Pitfall 9 — `mcp_apps` key collision with existing config

The config schema may already have an `mcp_apps` key for
something else (e.g. permission rules from Phase 31). Read the
existing schema FIRST before adding the new field. If there's a
collision, use a different name like `mcp_app_dock_overrides` or
nest under an existing parent.

### Pitfall 10 — Sub-B "claim from pool but mount fails"

If `claim` succeeds but the subsequent insertion into the dock
pane throws (e.g. parent element gone), the iframe is in
limbo — claimed but not mounted. Wrap the insertion in
try/catch; on failure, re-park or evict + log.

### Pitfall 11 — Iframe pool + detached windows (Phase 49) interaction

A detached window has its OWN iframe instance. The pool tracks
in-dock iframes only. When a pane is re-attached from detached
state, the dock-side iframe is fresh — no pool hit possible.
That's fine — document as expected behavior.

### Pitfall 12 — `display:none` + `<Show>` aren't exclusive

The current code does `display:none` on collapse. New code does
`<Show>`. If you accidentally do BOTH (`display:none` outer +
`<Show>` inner), the keep-alive case has the iframe present but
invisible — fine in isolation, but the lazy case has it absent
AND its parent has `display:none` — also fine. Just make sure
the styles are consistent so the layout doesn't flicker on
transitions.

---

## 11. Pre-drafted atomic commit subjects

1. `feat(app-dock): keep-alive decision helper (Phase 50b)`
2. `feat(config): mcp_apps[uri].alwaysLoaded schema field (Phase 50b)`
3. `feat(app-dock): observe state-relay traffic per app (Phase 50b)`
4. `feat(app-dock): lazy iframe mount on collapse for unknown apps (Phase 50b)`
5. `feat(app-dock): "Always keep loaded" toggle in pane menu (Phase 50b)`
6. `feat(app-dock): iframe pool with 5min TTL + LRU-3 eviction (Phase 50b)` _(skip if Sub-B deferred)_
7. `docs(adr,plan,changelog): Phase 50b lazy iframe + pool`
8. `chore: bump version to 0.9.93`

7 commits if Sub-B ships, 6 if deferred.

---

## 12. When you're done

Trip report with mandatory Smoke section:

```
| Aspect | Detail |
|---|---|
| Release | v0.9.93 status, asset count, CI duration |
| Sub-A (lazy mount) | shipped ✓ / partial / blocked (describe) |
| Sub-B (iframe pool) | shipped ✓ / deferred to Phase 50c (reason) |
| Commits | N atomic, list of subjects |
| Test delta | app: X → Y (+Z); librecode: A → B (+C) |
| Typecheck | repo root clean ✓ |
| Memory check | (optional) before/after measurement of 5-pane scenario |
| Deviations | (if any) |
| New pitfalls | (if any surfaced) |

Smoke results:
| Check | Result |
|---|---|
| Setup                                | ✅ |
| Built-in keep-alive on collapse      | ✅ |
| Lazy unmount on unknown collapse     | ✅ |
| `alwaysLoaded` config write          | ✅ |
| Pane menu toggle gating              | ✅ |
| Iframe pool host element (Sub-B)     | ✅ / N/A (deferred) |
| Console clean                        | ✅ |
```

---

## Appendix A — Recon checksums

```bash
cd /home/tristan/Projects/librecode
git rev-parse HEAD                                              # ≥ 8879776 (v0.9.92 bump head)
wc -l packages/app/src/components/app-dock/dock.tsx             # ~330 (Phase 50 telemetry+a11y additions)
wc -l packages/app/src/components/mcp-app-panel/state-relay.ts  # ~75
wc -l packages/app/src/components/app-dock/use-dock-state.tsx   # ~130
grep -c "mcp_apps" packages/librecode/src/config/schema.ts      # expect 0 or pre-existing other use
grep -n "createStateRelay" packages/app/src/components/mcp-app-panel.tsx  # find wire point
ls .claude/launch.json                                          # has librecode-cli + librecode-web
ls docs/plans/preview-smoke-template.md                         # exists
```

---

## 13. What ships next

Phase 50c (if needed) — iframe pool retrofit IF Sub-B deferred.

Phase 51 — public docs + announcement: user-facing guide, dev-facing
state-relay contract docs, migration narrative, ADR-009 ratification,
release-notes story. The overhaul wrap-up.
