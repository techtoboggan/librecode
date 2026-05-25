# Phase 47 — App Lifecycle UX (Detailed Execution Spec)

> Self-contained brief for an executor. Phase 46 (Timeline rename +
> View-as-graph) is merged at v0.9.86. This phase makes each dock
> pane self-explanatory: connection status visible at a glance, with a
> per-pane menu for reconnect / inspect-error / remove.

---

## Scope adjustment from the roadmap

The original roadmap framed Phase 47 around **four items**:

1. Status badge per pane.
2. Settings menu (⋮ button) with Reconnect / Disconnect / Open in
   settings / Update available / View logs / Remove.
3. "Update available" notifications.
4. Per-app settings route in the existing Settings dialog.

Items 3 and 4 partially depend on **Phase 41** (Plugin Marketplace) and
**a Settings → MCP tab** that doesn't exist yet. Building them in
Phase 47 would require either gating them behind a marketplace-shipped
flag or stubbing them out. Either path adds risk for low immediate
value.

**This spec ships items 1 + 2 with the actionable subset of the menu.**
Specifically:

- ✅ Status badge — connected / failed / needs_auth / disabled, with
  tooltip + error text.
- ✅ Pane menu (⋮ popover) with three actions:
  - **Reconnect** (visible only when status is `failed` or `needs_auth`)
  - **View error** (visible only when status is `failed`; shows the
    error in an inline panel that replaces the iframe content
    temporarily — same `display:none` toggle as collapse)
  - **Remove from dock** (always visible)
- ⏸ "Update available" notifications — deferred until Phase 41
  marketplace ships, then comes back as Phase 47b.
- ⏸ "Open in settings" deep-link — deferred until Phase 47b or
  Phase 41 (whichever introduces an MCP-per-server settings tab).
- ⏸ "View logs" — deferred; the log surface doesn't exist yet.

Result: Phase 47 ships the **functional core** (status + reconnect +
error visibility + remove) in 1-2 days. The full lifecycle menu fills
out incrementally as the surrounding pieces land.

---

## Goal (one sentence)

Every dock pane shows a **colored status dot** + a **⋮ menu button**;
the menu surfaces **Reconnect** when applicable, **View error** for
failed connections, and **Remove from dock** always.

## What "done" looks like

A user (dock-enabled):

1. Opens the dock. Three panes: Session Stats, Multica, an MCP-server
   app named "fake-server" that is currently disconnected.
2. **Session Stats** pane header shows a green dot. Hovering it tooltips
   "Connected".
3. **Multica** pane header shows a green dot (its MCP server is
   running).
4. **fake-server** pane header shows a red dot. Hovering it tooltips
   "Failed: ECONNREFUSED".
5. Clicks the **⋮** button on fake-server's pane. A popover appears
   with: **Reconnect** · **View error** · **Remove from dock**.
6. Clicks **View error**. The iframe content hides; an inline error
   panel shows the full error message ("Failed to connect: ECONNREFUSED
   at http://localhost:8080") + a "Close" button. Clicking Close
   restores the iframe.
7. Clicks **Reconnect**. The status dot shows "connecting" (yellow,
   pulsing). After a moment it returns to green or red.
8. Clicks **Remove from dock**. The fake-server pane disappears.
9. On Session Stats and Multica, the **⋮** menu only has **Remove from
   dock** (Reconnect + View error don't apply because they're
   connected).

For a user with `experimental.app_dock = false`, no change — Phase 47
is purely additive on top of the dock.

---

## Pre-flight: read these before touching code

### What Phases 42–46 shipped

- App Dock: multi-pane, reorder, collapse, migration, discovery
  consolidation, Timeline rename, View-as-graph bridge.
- Dock state: `entries: DockEntry[]` with `uri`, `app` (`McpAppResource`
  shape), `addedAt`, `collapsed`, `heightPx`, `migratedFromPinnedAt`.
- `useContext(DockContext)` always returns a value inside the session
  route (provider mounts unconditionally; only `<AppDock>` is flag-gated).
- Built-in apps use `server === "__builtin__"` (confirmed in Phase 46
  via `BUILTIN_SESSION_STATS` in `session.tsx`).

### MCP status surface

The canonical MCP status shape (verified in
`packages/librecode/src/mcp/index.ts`):

```ts
type MCPStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }
```

The live map is at `sync.data.mcp` keyed by **server name** (not URI):

```ts
const sync = useSync()
const status = sync.data.mcp[entry.app.server] // MCPStatus | undefined
```

Built-in apps (`server === "__builtin__"`) **don't have an entry** in
`sync.data.mcp`. Synthesize `{ status: "connected" }` for them.

Undefined status while the server is in the process of being added
(sync hasn't propagated yet) should show as "connecting" (yellow,
pulsing).

### Reconnect path

There's no existing "reconnect single server" public API in the
codebase as of v0.9.86. The MCP module has internal connect logic but
no idempotent `MCP.reconnect(serverName)` export.

**Two options:**

(a) Add a `POST /mcp/reconnect/:server` HTTP route in
`packages/librecode/src/server/routes/mcp.ts` that internally calls the
appropriate connect path. Wire SDK + frontend client.

(b) Use the existing `MCP.add()` shape — re-add the server config which
triggers reconnect as a side effect. Less clean but no new route.

**Go with (a).** It's a real new feature and deserves a dedicated
endpoint. Estimate: 30 lines server-side + SDK regen + 50 lines
frontend wiring.

### CLAUDE.md rules (recap)

- No semicolons / 120 char width / no `any` / Named exports only.
- ADR-006 lint covers `app-dock/**`. Phase 47 may introduce a new
  `createResource` for the status reactive — if so, annotate with
  `// adr-006: <reason>`.
- File size: `pane-header.tsx` (62 lines) will grow; extract sub-
  components if it crosses ~120 lines. Likely additions: `pane-status.tsx`
  (40 lines) + `pane-menu.tsx` (80 lines).

### Pitfalls inherited from Phases 45–46

#### 1. `scripts/release.sh` first arg IS the version string

Always call `scripts/release.sh 0.9.87`, never `--dry-run`. The first
arg becomes the literal version written to every package.json.

#### 2. `AppDockProvider` mounts unconditionally; gate on the flag

`useContext(DockContext)` returns a value everywhere in the session
route. Still gate behavior on `sync.data.config?.experimental?.app_dock`.

#### 3. `inDock`-style checks must AND the flag with the entries check

The provider being mounted doesn't mean the dock is enabled.

#### 4. `defaultDockState().visibility === "hidden"`

The first `toggleVisibility` call goes hidden → visible. Don't write
tests that assume default-visible state.

#### 5. Server-side test build trips on Solid context imports

Bun's server-side test build throws a SyntaxError when importing from
source files that use `useContext` / `useSync`. **Use mirror functions
defined inside the test file** rather than importing from the component
file directly. Pattern established in Phase 43–46 tests.

#### 6. Built-in server name

Built-in apps (Session Stats, Activity Graph) use `server === "__builtin__"`.
They don't appear in `sync.data.mcp`. Synthesize "connected" status.

---

## Files to create

### `packages/app/src/components/app-dock/pane-status.ts` (~80 lines, pure)

Pure status mapping. No JSX, no Solid hooks, no DOM. Just types +
mapping functions.

```ts
import type { McpAppResource } from "@/components/mcp-app-panel/types"

/** UI-level status — derived from MCP status + built-in synthesis. */
export type PaneStatusKind = "connected" | "connecting" | "failed" | "needs_auth" | "disabled"

export interface PaneStatus {
  kind: PaneStatusKind
  /** Human-readable label for the tooltip + accessibility text. */
  label: string
  /** Optional error detail (failed / needs_client_registration). */
  error?: string
  /** Whether this status indicates a recoverable problem (Reconnect button shown). */
  recoverable: boolean
}

const BUILTIN_SERVER = "__builtin__"

/**
 * Compute the UI status for a docked pane given the app and the live
 * sync.data.mcp map keyed by server name.
 *
 * - Built-in apps (`server === "__builtin__"`) always render as
 *   connected. They have no MCP server backing them.
 * - Missing entry in `mcpStatusMap` means the server hasn't reported
 *   yet — show as "connecting".
 * - All other statuses map per the table inside.
 *
 * Pure: same inputs always produce the same output.
 */
export function deriveStatus(
  app: Pick<McpAppResource, "server">,
  mcpStatusMap: Record<string, { status: string; error?: string } | undefined>,
): PaneStatus {
  if (app.server === BUILTIN_SERVER) {
    return { kind: "connected", label: "Connected (built-in)", recoverable: false }
  }
  const raw = mcpStatusMap[app.server]
  if (!raw) return { kind: "connecting", label: "Connecting…", recoverable: false }
  switch (raw.status) {
    case "connected":
      return { kind: "connected", label: "Connected", recoverable: false }
    case "disabled":
      return { kind: "disabled", label: "Disabled", recoverable: false }
    case "needs_auth":
      return { kind: "needs_auth", label: "Needs authentication", recoverable: true }
    case "needs_client_registration":
      return {
        kind: "failed",
        label: "Client registration required",
        error: raw.error,
        recoverable: true,
      }
    case "failed":
      return {
        kind: "failed",
        label: raw.error ? `Failed: ${raw.error}` : "Failed",
        error: raw.error,
        recoverable: true,
      }
    default:
      return { kind: "disabled", label: `Unknown status: ${raw.status}`, recoverable: false }
  }
}

/**
 * Tailwind class for the status dot. Pure — exported for test coverage
 * + so the dot component stays a thin shell.
 */
export function statusDotClass(kind: PaneStatusKind): string {
  switch (kind) {
    case "connected":
      return "bg-green-500"
    case "connecting":
      return "bg-yellow-500 animate-pulse"
    case "failed":
      return "bg-red-500"
    case "needs_auth":
      return "bg-amber-500"
    case "disabled":
      return "bg-text-weaker"
  }
}
```

### `packages/app/src/components/app-dock/pane-status.test.ts` (~80 lines)

10+ tests:

- `deriveStatus({server: "__builtin__"}, anyMap)` → connected.
- Missing status entry → connecting.
- `{status: "connected"}` → connected, label "Connected".
- `{status: "failed", error: "ECONNREFUSED"}` → failed, label
  "Failed: ECONNREFUSED", error preserved, recoverable=true.
- `{status: "needs_auth"}` → needs_auth, recoverable=true.
- `{status: "needs_client_registration", error: "x"}` → failed
  (kind=failed), error preserved, recoverable=true.
- `{status: "disabled"}` → disabled, recoverable=false.
- Unknown status value → disabled with diagnostic label.
- `statusDotClass` returns expected class for each kind.

### `packages/app/src/components/app-dock/pane-status-dot.tsx` (~30 lines)

Thin Solid component wrapping the dot + tooltip.

```tsx
import { type JSX } from "solid-js"
import { statusDotClass, type PaneStatus } from "./pane-status"

export interface PaneStatusDotProps {
  status: PaneStatus
}

export function PaneStatusDot(props: PaneStatusDotProps): JSX.Element {
  const tooltip = () => (props.status.error ? `${props.status.label}` : props.status.label)
  return (
    <span
      data-testid={`pane-status-${props.status.kind}`}
      class={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDotClass(props.status.kind)}`}
      role="status"
      aria-label={props.status.label}
      title={tooltip()}
    />
  )
}
```

### `packages/app/src/components/app-dock/pane-menu.tsx` (~120 lines)

⋮ button + Kobalte Popover with the three actions.

```tsx
import { Popover } from "@kobalte/core/popover"
import { Show, type JSX } from "solid-js"
import type { PaneStatus } from "./pane-status"

export interface PaneMenuProps {
  uri: string
  appName: string
  status: PaneStatus
  onReconnect: () => void
  onViewError: () => void
  onRemove: () => void
}

export function PaneMenu(props: PaneMenuProps): JSX.Element {
  return (
    <Popover>
      <Popover.Trigger
        data-testid={`pane-menu-${props.uri}`}
        class="text-text-weak hover:text-text-base shrink-0 ml-1 px-1"
        aria-label={`${props.appName} menu`}
        onClick={(e) => e.stopPropagation()}
      >
        ⋮
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 min-w-[180px] rounded-md border border-border-weak-base bg-surface-float-base shadow-lg p-1">
          <Show when={props.status.recoverable}>
            <MenuItem testId={`pane-menu-reconnect-${props.uri}`} onClick={props.onReconnect}>
              Reconnect
            </MenuItem>
          </Show>
          <Show when={props.status.kind === "failed" && props.status.error}>
            <MenuItem testId={`pane-menu-view-error-${props.uri}`} onClick={props.onViewError}>
              View error
            </MenuItem>
          </Show>
          <MenuItem testId={`pane-menu-remove-${props.uri}`} onClick={props.onRemove} variant="danger">
            Remove from dock
          </MenuItem>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

function MenuItem(props: {
  testId: string
  onClick: () => void
  variant?: "default" | "danger"
  children: JSX.Element
}): JSX.Element {
  const cls = props.variant === "danger" ? "text-text-danger-base" : "text-text-base"
  return (
    <button
      data-testid={props.testId}
      type="button"
      class={`block w-full text-left px-3 py-1.5 text-12-regular rounded-sm hover:bg-surface-raised-base-hover ${cls}`}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
    >
      {props.children}
    </button>
  )
}
```

### `packages/app/src/components/app-dock/pane-menu.test.tsx` (~120 lines)

10+ tests, using the same mirror-function pattern from Phase 46:

- Reconnect shown when `status.recoverable === true`, hidden otherwise.
- View error shown only when `status.kind === "failed" && status.error`.
- Remove always shown.
- Reconnect click calls `onReconnect` once.
- View error click calls `onViewError` once.
- Remove click calls `onRemove` once.
- Menu items don't trigger drag (stopPropagation works).
- Menu opens on trigger click.
- Status changes update the visible menu items reactively.
- `failed` status without error: View error is hidden.

---

## Files to modify

### `packages/app/src/components/app-dock/pane-header.tsx`

Add `status` + the three new callbacks as props. Render the dot + the
menu inline.

```tsx
import { createDraggable } from "@thisbeyond/solid-dnd"
import { Show, type JSX } from "solid-js"
import { PaneStatusDot } from "./pane-status-dot"
import { PaneMenu } from "./pane-menu"
import type { PaneStatus } from "./pane-status"

export interface PaneHeaderProps {
  uri: string
  appName: string
  collapsed: boolean
  status: PaneStatus
  onToggleCollapse: () => void
  onRemove: () => void
  onReconnect: () => void
  onViewError: () => void
}

export function PaneHeader(props: PaneHeaderProps): JSX.Element {
  const draggable = createDraggable(props.uri)
  return (
    <div
      use:draggable
      data-testid={`pane-header-${props.uri}`}
      data-uri={props.uri}
      class="flex items-center justify-between px-3 py-2 shrink-0 border-b border-border-weak-base cursor-grab active:cursor-grabbing select-none"
    >
      <div class="flex items-center gap-2 min-w-0">
        <button
          data-testid={`pane-collapse-${props.uri}`}
          type="button"
          class="text-text-weak hover:text-text-base shrink-0"
          aria-label={props.collapsed ? `Expand ${props.appName}` : `Collapse ${props.appName}`}
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleCollapse()
          }}
        >
          <Show when={!props.collapsed} fallback={<span aria-hidden="true">▸</span>}>
            <span aria-hidden="true">▾</span>
          </Show>
        </button>
        <PaneStatusDot status={props.status} />
        <span class="text-12-medium text-text-strong truncate">{props.appName}</span>
      </div>
      <PaneMenu
        uri={props.uri}
        appName={props.appName}
        status={props.status}
        onReconnect={props.onReconnect}
        onViewError={props.onViewError}
        onRemove={props.onRemove}
      />
    </div>
  )
}
```

Note: the prop name `name` has been **renamed** to `appName` to be
unambiguous. The old name conflicts with HTML `name` attribute when
spread. Update all callers in `dock.tsx`.

### `packages/app/src/components/app-dock/pane-header.test.tsx`

Update existing tests for the new prop name (`name` → `appName`) and
add cases for the new sub-component presence:

- Renders the status dot.
- Renders the menu trigger.
- Forwards the new callbacks correctly.

The drag + collapse + (legacy) remove behaviors are unchanged at the
header level — they're tested separately in `pane-menu.test.tsx` and
the existing `pane-header.test.tsx` cases.

### `packages/app/src/components/app-dock/dock.tsx`

The `DockPane` inner component (around the section that renders
`<PaneHeader>`) needs to:

1. Compute the status from `sync.data.mcp` + the entry's app.
2. Provide `onReconnect` and `onViewError` callbacks.
3. Track a per-pane `viewingError` signal that swaps the iframe for an
   error panel.

```tsx
import { useSync } from "@/context/sync"
import { createSignal, Show } from "solid-js"
import { deriveStatus } from "./pane-status"

// Inside the dock body, where DockPane is defined:
function DockPane(props: { entry: DockEntry; sessionID?: string; heightPx: number }) {
  const dock = useAppDockState()
  const sync = useSync()
  const [viewingError, setViewingError] = createSignal(false)

  const status = () => deriveStatus(props.entry.app, sync.data.mcp ?? {})

  const onReconnect = () => {
    // Call the new POST /mcp/reconnect/:server endpoint via the SDK.
    // Implementation in Step 4 below.
    void reconnectMcpServer(props.entry.app.server)
    setViewingError(false)
  }

  const onViewError = () => setViewingError(true)
  const closeError = () => setViewingError(false)

  return (
    <div style={...}>
      <PaneHeader
        uri={props.entry.uri}
        appName={props.entry.app.name}
        collapsed={props.entry.collapsed ?? false}
        status={status()}
        onToggleCollapse={() => dock.setCollapsed(props.entry.uri, !(props.entry.collapsed ?? false))}
        onRemove={() => dock.remove(props.entry.uri)}
        onReconnect={onReconnect}
        onViewError={onViewError}
      />
      <div
        class="flex-1 min-h-0 overflow-hidden"
        style={{ display: props.entry.collapsed ? "none" : "flex" }}
      >
        {/* Phase 47 — show error panel instead of iframe when viewingError */}
        <Show
          when={!viewingError() || status().kind !== "failed"}
          fallback={<PaneErrorPanel error={status().error ?? "Unknown error"} onClose={closeError} />}
        >
          <McpAppPanel ... />
        </Show>
      </div>
    </div>
  )
}
```

The `reconnectMcpServer` helper:

```ts
async function reconnectMcpServer(server: string): Promise<void> {
  if (server === "__builtin__") return
  // Use the existing globalSDK / SDK client to call POST /mcp/reconnect/:server.
  // Exact wiring depends on whether the SDK regen has picked up the new route.
}
```

And the `PaneErrorPanel` is a small inline component:

```tsx
function PaneErrorPanel(props: { error: string; onClose: () => void }): JSX.Element {
  return (
    <div class="flex flex-col p-4 gap-3 text-12-regular">
      <p class="text-text-danger-base font-mono break-words">{props.error}</p>
      <button type="button" class="text-text-weak hover:text-text-base self-start" onClick={props.onClose}>
        ← Back to app
      </button>
    </div>
  )
}
```

### `packages/app/src/components/app-dock/dock.test.tsx`

Add 4+ new tests:

- Status dot reflects sync.data.mcp entries.
- Built-in apps show connected even with no MCP map entry.
- View error replaces iframe content; close button restores it.
- Reconnect button calls the SDK helper (mocked).

### Server route + SDK

#### `packages/librecode/src/server/routes/mcp.ts`

Add:

```ts
.post("/reconnect/:server",
  describeRoute({
    summary: "Reconnect an MCP server",
    description: "Tear down the existing connection (if any) and re-connect using the stored config.",
    operationId: "mcp.reconnect",
    responses: {
      200: { description: "Reconnect initiated", content: { "application/json": { schema: resolver(z.object({ ok: z.literal(true) })) } } },
      ...errors(400, 404),
    },
  }),
  async (c) => {
    const server = c.req.param("server")
    if (!server) return c.json({ error: "missing server name" }, 400)
    try {
      await MCP.reconnect(server)
      return c.json({ ok: true as const })
    } catch (err) {
      log.error("reconnect failed", { server, error: String(err) })
      return c.json({ error: String(err) }, 500)
    }
  },
)
```

#### `packages/librecode/src/mcp/index.ts`

Add a `reconnect(name: string)` public method. Internally:

```ts
async function mcpReconnect(name: string): Promise<void> {
  await disconnect(name).catch(() => {})  // tear down any existing client
  // Fetch the stored config and re-add. Existing add() shape:
  const config = await getStoredConfig(name)
  if (!config) throw new Error(`No stored config for MCP server "${name}"`)
  await add(name, config)
}

// Export via the MCP barrel
export const MCP = {
  ...,
  reconnect: mcpReconnect,
}
```

(Exact internals depend on how config is stored. Read the existing
`add()` + `disconnect()` paths to find the right helper.)

#### SDK regen

After the server route lands:

```bash
cd packages/sdk/js && bun run build
```

The new method appears on the typed client. Update
`reconnectMcpServer` in `dock.tsx` to use it.

### `docs/adr/009-app-dock.md`

Append a "Phase 47 changelog" subsection:

```markdown
## Phase 47 — App lifecycle UX

Each dock pane now shows a colored status dot:

- Green: connected (or built-in)
- Yellow + pulse: connecting (server hasn't reported yet)
- Amber: needs authentication
- Red: failed (with error text in tooltip)
- Gray: disabled

A ⋮ menu button next to the status dot opens a popover with:

- **Reconnect** — visible when status is `failed` or `needs_auth`. Calls
  the new `POST /mcp/reconnect/:server` endpoint.
- **View error** — visible when status is `failed` with an error string.
  Replaces the iframe content with an inline error panel; a "Back to
  app" button restores the iframe.
- **Remove from dock** — always visible.

Deferred to Phase 47b (post-marketplace): Update available
notifications, Open in settings deep-link, View logs.
```

### `PLAN.md`

Add a Phase 47 entry under Phase 46. Update the header.

---

## Tests required

**Total: ~30 new tests.**

### Unit (pure logic)

1. `pane-status.test.ts` — 10 cases (built-in synthesis, all 5 raw
   status mappings + unknown + missing + statusDotClass for each kind).

### Solid component

2. `pane-menu.test.tsx` — 10 cases (visibility of each item per status,
   click handlers, stopPropagation).
3. `pane-header.test.tsx` — extend existing with 3 cases (status dot
   rendered, menu present, `appName` prop wired).
4. `dock.test.tsx` — extend with 4 cases (status reflects sync,
   built-ins, view error swaps content, reconnect button fires).

### Server-side

5. `packages/librecode/test/server/routes/mcp-reconnect.test.ts` —
   3 tests (200 happy path, 400 missing name, 500 on internal error).
6. `packages/librecode/test/mcp/reconnect.test.ts` — 2 tests (succeeds
   for a configured server, throws for unknown server).

### BDD / E2E

7. Add to `packages/app/e2e/app-dock.spec.ts`:

```gherkin
Scenario: status dot reflects MCP server state
  Given LibreCode is running with experimental.app_dock = true
  And the dock has Multica added
  And Multica's MCP server is connected
  Then the Multica pane should show a green status dot

Scenario: failed status surfaces an error
  Given the dock has fake-server added
  And fake-server's MCP server failed with "ECONNREFUSED"
  Then the fake-server pane should show a red status dot
  When I click the pane menu
  And I click "View error"
  Then the iframe should be replaced by an error panel
  And the panel should contain "ECONNREFUSED"

Scenario: reconnect retries a failed server
  Given the dock has fake-server in failed state
  When I click "Reconnect" from the pane menu
  Then a POST request to /mcp/reconnect/fake-server should be made
```

---

## Step-by-step execution order

### Step 1 — Recon

- Read `pane-header.tsx`, `dock.tsx`, `use-dock-state.tsx`.
- Read `packages/librecode/src/mcp/index.ts` — find `disconnect()` and
  the path that loads stored configs. Confirm a `reconnect` helper can
  be added cleanly.
- Read `packages/librecode/src/server/routes/mcp.ts` — confirm the
  route file exists at that path. If not, find where MCP routes live.
- Read existing dialog-select-mcp.tsx — it consumes `sync.data.mcp` and
  is the reference for status-style rendering.
- `bun run typecheck && bun run lint` — clean baseline.

### Step 2 — Pure status helper

- Create `pane-status.ts` + `pane-status.test.ts`.
- `cd packages/app && bun run test:unit` — 10 new tests green.

### Step 3 — Status dot component

- Create `pane-status-dot.tsx`.
- No test file (it's a 30-line passthrough; dock.test covers it).

### Step 4 — Server reconnect route

- Add `MCP.reconnect(name)` to `packages/librecode/src/mcp/index.ts`.
- Add `POST /mcp/reconnect/:server` to the route file.
- Add tests in `packages/librecode/test/mcp/reconnect.test.ts` +
  `test/server/routes/mcp-reconnect.test.ts`.
- `cd packages/librecode && bun run test:unit` — green.

### Step 5 — SDK regen

- `cd packages/sdk/js && bun run build`.
- Verify the new method appears: `grep -i reconnect packages/sdk/js/src/v2/gen/sdk.gen.ts`.
- `bun run typecheck` clean.

### Step 6 — Pane menu component

- Create `pane-menu.tsx` + `pane-menu.test.tsx`.
- `bun run test:unit` — 10 new tests green.

### Step 7 — Pane header rewire

- Update `pane-header.tsx`: new props (`appName`, `status`, callbacks),
  insert status dot + pane menu.
- Update `pane-header.test.tsx`.
- Update `dock.tsx`'s `DockPane`: compute status, wire callbacks, add
  `viewingError` signal, render `PaneErrorPanel`.
- Update `dock.test.tsx`.
- All other callers of `PaneHeader` (search the codebase) updated to
  the new prop shape.
- `bun run test:unit` — green.

### Step 8 — Manual smoke test

With `experimental.app_dock = true`:

- Add Session Stats. Status dot = green, tooltip "Connected (built-in)".
- Add an MCP-server app whose server is configured but offline. Status
  dot = yellow (connecting). After a moment, red (failed). Tooltip
  shows error.
- Click ⋮ on the failed pane. Menu shows Reconnect + View error +
  Remove from dock.
- Click View error. Iframe hides; error panel appears. Back button
  works.
- Click Reconnect. Status briefly shows connecting; then green if the
  server is now reachable.
- Click Remove from dock. Pane disappears.

### Step 9 — BDD/E2E

- Extend `packages/app/e2e/app-dock.spec.ts` with the 3 new scenarios.
- `cd packages/app && bun run test:e2e:local` — all green.

### Step 10 — ADR + PLAN updates

- Append Phase 47 changelog to `docs/adr/009-app-dock.md`.
- Add Phase 47 entry to `PLAN.md`.
- Update PLAN.md header.
- `bunx prettier --check` clean.

### Step 11 — Final verification

- `bun run typecheck` clean.
- `bun run lint` clean (biome + adr-006).
- `cd packages/app && bun run test:unit` — ~30 new tests, all green.
- `cd packages/librecode && bun run test:unit` — no regressions (plus
  5 new server-side tests).

### Step 12 — Atomic commits

1. `feat(app-dock): pure pane-status mapping helpers (Phase 47)`
2. `feat(app-dock): PaneStatusDot component`
3. `feat(mcp): MCP.reconnect(server) + POST /mcp/reconnect/:server route`
4. `chore(sdk): regen for mcp.reconnect endpoint`
5. `feat(app-dock): PaneMenu with reconnect / view-error / remove actions`
6. `feat(app-dock): wire status + menu into PaneHeader + DockPane error panel`
7. `test(app-dock): coverage for status mapping + menu + error panel`
8. `test(app-dock): BDD scenarios for Phase 47 lifecycle UX`
9. `docs(adr): ADR-009 Phase 47 lifecycle UX changelog`
10. `docs(plan): Phase 47 entry in PLAN.md`

### Step 13 — Bump + push

- `scripts/release.sh 0.9.87` (NOT `--dry-run`).
- Commit: `chore: bump version to 0.9.87`.
- Tag `v0.9.87`. Push main + tag.
- Watch the release pipeline (~18 min).

---

## Verification checklist

- [ ] Status dot renders correct color for each of the 5 status kinds.
- [ ] Built-in apps show "Connected (built-in)" regardless of sync.data.mcp.
- [ ] Missing entry in sync.data.mcp → "Connecting…" (yellow pulse).
- [ ] Pane menu shows Reconnect only when recoverable.
- [ ] Pane menu shows View error only when `failed` AND error text exists.
- [ ] Remove from dock works (regression check from Phase 43).
- [ ] View error swaps the iframe for an error panel; Back button restores.
- [ ] Reconnect calls the new SDK method.
- [ ] `POST /mcp/reconnect/:server` is exposed in the OpenAPI spec.
- [ ] `bun run typecheck` clean.
- [ ] `bun run lint` clean.
- [ ] `cd packages/app && bun run test:unit` — ~30 new tests green.
- [ ] `cd packages/librecode && bun run test:unit` — green + 5 new
      server-side tests.
- [ ] BDD scenarios pass (3 new).
- [ ] Manual smoke test (Step 8) — all 6 cases pass.
- [ ] ADR-009 Phase 47 changelog appended.
- [ ] PLAN.md updated.
- [ ] v0.9.87 release pipeline green.

---

## Common pitfalls

### 1. Status dot must NOT cause a Suspense flash

The status reactive (`status()`) is computed from `sync.data.mcp` which
updates on every SSE tick. Use it as a derived getter (not a
`createResource`). Phase 32's ADR-006 incidents teach the lesson:
don't introduce new resources keyed on signals that change frequently.

`sync.data.mcp` is a Solid store — reading it inside a getter is
correct Solid reactivity; no resource needed.

### 2. PaneErrorPanel must not unmount the iframe

The error panel is shown via `<Show when={...} fallback={<PaneErrorPanel/>}>`.
That implies the iframe IS unmounted when viewing error. **Phase 42's
design preserves iframe via `display:none`, not conditional render.**

To preserve the iframe, render BOTH and toggle display:

```tsx
<div class="flex-1 min-h-0 overflow-hidden">
  <div style={{ display: viewingError() && status().kind === "failed" ? "none" : "flex" }} class="h-full">
    <McpAppPanel ... />
  </div>
  <Show when={viewingError() && status().kind === "failed"}>
    <PaneErrorPanel error={status().error ?? "Unknown error"} onClose={closeError} />
  </Show>
</div>
```

This way the iframe persists; the error panel overlays it without
killing the bridge. Match the existing Phase 42 pattern.

### 3. `appName` rename — search all callers

`PaneHeader` currently takes `name`. Renaming to `appName` affects
`dock.tsx`'s `DockPane`. Run `grep -rn "PaneHeader" packages/app/src`
to find every caller. There should only be one (in `dock.tsx`), but
verify before merging.

### 4. The reconnect endpoint name + method matter for OpenAPI

The Hono route's `operationId` determines the generated SDK method name.
Use `mcp.reconnect` for the operationId → `client.mcp.reconnect()`.
Match the existing pattern in `mcp.ts` for adjacent endpoints.

### 5. Missing config error on Reconnect

If a user clicks Reconnect for a server whose config was removed
(rare, but possible if they removed it elsewhere mid-session), the
backend will throw "No stored config". Show a toast in the frontend
with the error text. Don't silently swallow.

### 6. `__builtin__` server short-circuit

Built-ins have no MCP server backing. The Reconnect handler must
no-op for `server === "__builtin__"` (returns immediately, no SDK
call). Failing to short-circuit would send a useless request to
`/mcp/reconnect/__builtin__` and the server would 404.

The frontend's `reconnectMcpServer` helper handles this; the server
route doesn't need to.

### 7. View error button when error is empty

`MCPStatus.failed` has `error: string` — but if upstream returns
`{ status: "failed", error: "" }` (empty string), View error
shouldn't appear. The pane-menu's `<Show when>` condition checks
truthy, so empty string already short-circuits. Confirm by writing
the test for it.

---

## When you're done

Report back with:

- The 10 main-repo commit IDs (matching Step 12).
- The v0.9.87 release URL.
- Test count delta (e.g., "665 → ~695 app tests, +30; 1982 → ~1987
  librecode tests, +5").
- Confirmation that all 6 manual smoke test cases passed.
- Any deviations from this spec with rationale.
- Any new pitfalls discovered — fold into a Phase 48 stub at
  `docs/plans/phase-48-spec.md`.

Update PLAN.md's `Last updated` line. Don't delete this spec.
