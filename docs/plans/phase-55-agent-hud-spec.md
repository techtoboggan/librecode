# Phase 55 — Agent HUD: overlay mode + telemetry channels

> Self-contained execution spec for Sonnet workers.
> Phase 55 of the MCP-Apps line (`docs/plans/mcp-apps-overhaul-roadmap.md`),
> implementing **ADR-0011**. Lands on top of v0.10.16 (dock visible + PTY auth).
>
> **Mandatory verification:** every UI-visible sub-phase MUST be verified in the
> real WebKitGTK webview via the Phase-54 harness (`packages/app/e2e/tauri-real/`,
> run headless under xvfb — see `docs/adr/0010-test-architecture.md` and the
> WebKit-divergence playbook). Browser-mode + web-preview alone are NOT
> sufficient: this feature is desktop-webview-shaped (overlay z-stacking,
> pointer-events, live postMessage), and Chromium hides exactly the bugs that
> bit the dock (v0.10.12–.16).
>
> **One sub-phase per PR.** Each is independently shippable. Ship order is
> 55A → 55B → 55C → 55D → 55E; 55F is deferred (needs backend skill telemetry).

---

## 0. Why this phase exists

The dock can box an MCP app (`inline`) or let it take the whole viewport
(`fullscreen`). It cannot render a translucent **heads-up display over the live
session**, and apps see only four hardcoded bus events — a sliver of the rich
agentic telemetry already flowing on the bus.

Phase 55 turns MCP apps into **real-time renderers of the agentic platform's
state**: where it is focusing, what's been cleared, what's been gained, what
remains. The platform ships the contract + one reference HUD; the community
writes the creative views (pipeline maps, RTS minimaps, ARPG worlds) as
ordinary sandboxed MCP apps. Data comes from two sources (ADR-0011 §2–3):
**derived** telemetry (automatic, from the bus) and **agent-authored** scene
state (a tool the agent/plugins drive).

Read ADR-0011 once before starting. The architecture map (display modes,
bridge contract, bus events, builtins) is in that ADR's Context.

---

## 1. Done-state walkthrough

After Phase 55 ships (target **v0.11.x**):

1. **Overlay HUD.** A user opens the **Mission HUD** app and clicks its
   "Overlay" toggle. A translucent panel fades in over the right side of the
   session — the chat stays visible and clickable underneath. The HUD shows:
   tasks (✓ cleared / ◐ in-progress / ○ remaining), active subagents and their
   current phase, and live cost/tokens ticking up as the agent works. Clicking
   away from the HUD's controls passes through to the session (click-through).
   `Esc` or the toggle dismisses it back to the dock.
2. **Live, opt-in data.** The HUD declared `channels: ["tasks","agents","cost"]`
   in its manifest. It received a snapshot on load and now gets throttled deltas
   as todos change, subagents spawn/finish, and messages complete. A different
   app that declared no channels gets none — no app sees telemetry it didn't ask
   for.
3. **Agent-authored scene.** During a long task the agent calls the `scene`
   tool: `scene.objective({ id: "auth-refactor", label: "Refactor auth",
status: "active" })`, later `status: "cleared"`. A scene-aware renderer lights
   that objective up in real time — fog-of-war clearing as the platform makes
   progress. Scene state persists across reloads for the session.
4. **Author SDK.** A developer scaffolds a new HUD from the starter template,
   imports `@librecode/sdk/hud`, calls `hud.subscribe("pipeline", render)` and
   `hud.requestDisplayMode("overlay")`, and ships their own StarCraft-style view
   without touching LibreCode internals.

---

## 2. Sub-phase 55A — `overlay` display mode

**Goal:** a third display mode that renders an app over the session, opt-in,
click-through, dismissible.

### Files

- `packages/app/src/components/mcp-app-display-mode.ts`
  - Add `"overlay"` to `HostDisplayMode` and `HOST_AVAILABLE_DISPLAY_MODES`.
  - `resolveDisplayModeRequest` already allowlists from the set — confirm it
    accepts `overlay`.
- `packages/app/src/components/mcp-app-panel.tsx`
  - Wrapper `classList` (the inline/fullscreen branch, ~L771): add an `overlay`
    branch. Overlay container: `fixed top-0 right-0 h-full` (or a configurable
    edge), `z-40` (below fullscreen's `z-50`, above the session), translucent
    backdrop, **`pointer-events: none`** on the container. The iframe itself
    keeps `pointer-events: auto` (the app decides interactivity via its own DOM;
    document this in the SDK so authors set `pointer-events:none` on their HUD
    root and `auto` on controls).
  - Header bar: in overlay mode, render a minimal floating dismiss affordance
    (reuse the fullscreen exit-button pattern, ~L801); `Esc` exits overlay too
    (extend the existing fullscreen `Esc` handler ~L579).
  - Gate the overlay toggle button on the app's opt-in (see manifest below).
- Manifest opt-in: extend `McpAppResource` consumption so an app's
  `_meta.ui.displayModes?: string[]` is read at discovery
  (`mcp-app-panel/fetch.ts` / `types.ts`). Only show the overlay toggle when
  the app advertises `"overlay"`. Builtins set this in their bundled resource.
- A per-pane "Overlay" toggle in the pane header (`app-dock/` pane header) that
  calls the same path as `bridge.onrequestdisplaymode` would, OR drives the
  `displayMode` signal directly.

### Constraints

- The overlay layer must mount **inside** the existing `<AppDockProvider>` /
  session subtree but escape the flex row visually via `fixed` positioning. Do
  NOT add a new `createResource` keyed on the overlay toggle (ADR-006). The
  iframe is the same pooled iframe — toggling overlay only changes the wrapper
  class, never remounts (preserves bridge + state).
- Respect `prefers-reduced-motion` for the fade.

### Tests

- **Layer 1 (unit):** `resolveDisplayModeRequest("overlay", "inline")` →
  `"overlay"`; rejects unknown → current. Wrapper classList helper returns the
  overlay classes for `displayMode==="overlay"`.
- **Layer 3 (real WebKit, MANDATORY):** new `e2e/tauri-real/overlay-mode.spec.ts`
  — toggle an overlay-capable demo app; assert (a) the iframe wrapper is
  `position:fixed` and `z-index >= 40` and inside the viewport, (b) the session
  timeline element underneath is still hit-testable at a point outside the HUD
  controls (`document.elementFromPoint` is NOT the overlay container →
  click-through works), (c) `Esc` returns to `inline`. Pattern: copy
  `dock-visible.spec.ts`.

### Regression note for the PR

State which layer would have caught any regression. Overlay z-stacking +
click-through is **Layer 3** (real webview) — browser mode can't see the
WebKit pointer-events/stacking behavior reliably.

---

## 3. Sub-phase 55B — Telemetry Channel framework + derived channels

**Goal:** replace the hardcoded forwarded-events allowlist with a typed,
opt-in, throttled, per-app channel subscription system, and ship 5 derived
channels.

### New module: channel schemas (SDK)

`packages/sdk/js/src/hud/channels.ts` (new) — Zod schemas, one per channel,
each `{ snapshot, delta }`. Keep payloads derived/aggregated (ADR-0011 §4).

```ts
// pipeline — from agent.loop.start/transition/end
PipelineSnapshot = { state: string; step: number; running: boolean; agent?: string }
PipelineDelta    = { kind: "transition"|"start"|"end"; from?: string; to?: string;
                     step?: number; reason?: string; durationMs?: number; toolCalls?: number }

// tasks — from todo.updated
TaskItem  = { id: string; content: string; status: "pending"|"in_progress"|"completed"|"cancelled";
              priority: "high"|"medium"|"low" }
TasksSnapshot = { items: TaskItem[]; cleared: number; total: number }
TasksDelta    = TasksSnapshot   // todo.updated already sends the full list; send full each time

// activity — from activity.updated (files)
ActivityFile  = { path: string; kind: "read"|"write"|"shell"|"search"|"other"|"idle"; tool?: string; at: number }
ActivitySnapshot = { files: ActivityFile[] }
ActivityDelta    = { changed: ActivityFile[] }   // only files whose entry changed

// agents — from activity.updated (agents)
AgentEntry    = { agentID: string; phase: string; tool?: string; file?: string; at: number }
AgentsSnapshot = { agents: AgentEntry[] }
AgentsDelta    = { changed: AgentEntry[] }

// cost — from message.updated
CostSnapshot = { usd: number; tokensIn: number; tokensOut: number; messages: number }
CostDelta    = CostSnapshot   // cumulative; recompute + send (throttled)
```

A `CHANNELS` registry maps channel name → `{ snapshot, delta }` schema +
metadata `{ throttleMs }`. Export the union type `ChannelName`.

### Host broker

`packages/app/src/components/mcp-app-panel/telemetry-broker.ts` (new). Replaces
`events.ts`'s hardcoded forwarding.

- A factory `createTelemetryBroker({ sessionID, sdk })` that subscribes once to
  the SSE event stream (the same source `createEventForwarder` uses today) and
  maintains per-channel in-memory state.
- Per subscribing app: given its declared `channels`, deliver a **snapshot**
  (computed from current state or the existing seed endpoints) right after the
  `mcp-app-ready` handshake, then **deltas** as events arrive — **coalesced**
  per channel to `throttleMs` (e.g. `cost`/`activity` ≤ 250ms; `pipeline`/
  `tasks`/`agents` on-change but rate-capped). Use `onCleanup` to unsubscribe.
- Delivery envelope (extends the existing postMessage path in
  `mcp-app-panel.tsx` / `events.ts`):
  `iframe.contentWindow.postMessage({ type: "mcp-app-channel", channel, kind, payload, seq }, "*")`.
  `seq` is a per-channel monotonic counter so the client can detect gaps.
- **Redaction** lives here: never include file _contents_, full tool _args_,
  or message _text_ — only the shapes above.

### Manifest opt-in

Read `_meta.ui.channels?: ChannelName[]` at discovery (`fetch.ts`/`types.ts`).
The broker only wires channels the app listed. Unknown channel names are
ignored with a `console.warn` (forward-compat).

### Migration

- Delete `FORWARDED_EVENT_TYPES` and route the four old events through the
  broker. The `session-stats` builtin → subscribes `["cost"]` (+ its existing
  stats seed); `activity-graph` builtin → subscribes `["activity","agents"]`.
  Keep their rendered output identical — this is a behavior-preserving refactor.
- Seed endpoints (`/session/:id/activity`, `/session/:id/stats-seed`) stay; the
  broker uses them to compute initial snapshots for `activity`/`agents`/`cost`.
  `pipeline`/`tasks` snapshots come from current bus state (or a small new
  read; `todo` is persisted — a `/session/:id/todos` read may be needed).

### Tests

- **Layer 1:** schema round-trips for every channel; broker delta-shaping
  (feed a fake `agent.loop.transition` → assert correct `PipelineDelta`);
  throttle/coalesce (N rapid `cost` updates within `throttleMs` → 1 delta);
  redaction (a `message.part.updated` with text → `activity` delta carries no
  text); unknown channel name → ignored.
- **Layer 1 (regression for the builtins):** session-stats/activity-graph
  seed+delta payloads unchanged vs. golden fixtures.
- **Layer 3 (real WebKit):** `e2e/tauri-real/channels.spec.ts` — a demo app
  subscribing `["tasks"]` receives a `mcp-app-channel` snapshot then a delta
  after a todo changes (drive a todo update via the backend/test hook). Assert
  an app that subscribed to nothing receives zero `mcp-app-channel` messages.

---

## 4. Sub-phase 55C — Mission HUD reference app

**Goal:** the first builtin overlay HUD; the template authors copy.

### Files

- New builtin resource `ui://builtin/mission-hud`, bundled HTML like the other
  builtins (served via `GET /mcp/apps/html?server=__builtin__&uri=…`). Register
  alongside `BUILTIN_URI_SESSION_STATS` / `BUILTIN_URI_ACTIVITY_GRAPH`
  (`mcp-app-panel/seed.ts`, the builtin list, `SEEDABLE_BUILTIN_URIS` if seeded).
- Manifest: `_meta.ui.displayModes: ["inline","overlay"]`,
  `_meta.ui.channels: ["tasks","agents","cost"]`.
- The HTML/JS renders three zones, translucent, `pointer-events:none` on the
  root and `auto` on its (minimal) controls:
  - **Tasks:** cleared/in-progress/remaining counts + a compact list with status
    glyphs, from the `tasks` channel.
  - **Agents:** active subagents + current phase/tool, from the `agents` channel.
  - **Cost:** live USD + tokens in/out + message count, from the `cost` channel.
- Defaults to `inline` in the dock; the overlay toggle (55A) promotes it.

### Tests

- **Layer 3 (real WebKit):** `e2e/tauri-real/mission-hud.spec.ts` — open the
  Mission HUD, toggle overlay, assert the three zones render and the cost figure
  updates after a message completes (or after a scripted backend event). Confirm
  click-through to the session.
- **Layer 2 (web preview smoke):** desktop-viewport screenshot at baseline +
  overlay state (per `preview-smoke-template.md`).

---

## 5. Sub-phase 55D — agent-authored `scene` channel

**Goal:** let the agent/plugins push semantic game-state that renderers
interpret; deliver it on a reserved `scene` channel; persist per session.

### Files

- **Tool:** `packages/librecode/src/tool/scene.ts` (new). `Tool.define("scene", …)`
  with `capabilities: ToolProfiles.pure` (`src/tool/capabilities.ts`) — no fs,
  no network, no shell. Verbs (single tool, discriminated `action`):
  - `objective` — `{ id, label, status }` where status ∈
    `cleared|active|gained|remaining|blocked` (the fixed scene vocabulary).
  - `region` — `{ id, label, status, hint? }` (for map/fog-of-war renderers).
  - `marker` — `{ id, label, kind?, at? }` (points of interest).
  - `clear` — reset scene for the session.
  - Merge semantics: by `id`; absent fields preserved.
  - Register in the tool registry; add the capability-declaration test asserts
    every tool has capabilities (Playbook 3).
- **Storage:** per-session scene state. Drizzle migration
  `migration/<ts>_scene_state/migration.sql` + a `SceneTable` (sessionID PK,
  JSON blob, updatedAt). Access only via `src/storage/` (no raw SQLite). A
  `Scene` module (`src/session/scene.ts`) with `get/merge/clear` that emits a
  bus event `scene.updated { sessionID, scene }`.
- **Plugin API:** a hook so plugins/skills can push scene updates without the
  model (mirror how plugins receive `hook.event`; add a `ctx.scene.merge(...)`
  surface or a documented bus-publish path). Keep minimal in 55D; document.
- **Broker:** add `scene` to the channel registry (snapshot = current scene;
  delta = merged change) and shape `scene.updated` → `scene` channel deltas.
- **Mission HUD (optional in 55D):** render scene objectives if present
  (a fourth zone), proving the dual-source model end-to-end.

### Scene schemas (SDK, `channels.ts`)

```ts
SceneStatus   = "cleared"|"active"|"gained"|"remaining"|"blocked"
SceneObjective= { id: string; label: string; status: SceneStatus }
SceneRegion   = { id: string; label: string; status: SceneStatus; hint?: string }
SceneMarker   = { id: string; label: string; kind?: string; at?: number }
SceneSnapshot = { objectives: SceneObjective[]; regions: SceneRegion[]; markers: SceneMarker[] }
SceneDelta    = Partial<SceneSnapshot>   // merged by id
```

### Tests

- **Layer 1:** `scene` tool merge semantics (objective upsert by id; `clear`
  empties; invalid status rejected by Zod); `Scene` module get/merge/clear;
  capability declaration test passes.
- **Storage:** migration applies; round-trip persist/read; survives "reload"
  (re-read after dispose).
- **Layer 1 (broker):** `scene.updated` → correct `SceneDelta` on the `scene`
  channel.
- **Layer 3:** drive the `scene` tool (via a backend/test hook), assert a
  scene-subscribing app receives the snapshot + delta in the real webview.
- **Regression:** every bug fix gets a test in the right layer (mandatory).

---

## 6. Sub-phase 55E — author SDK + starter template + docs

**Goal:** make it trivial to write a third-party HUD.

### Files

- `packages/sdk/js/src/hud/client.ts` (new) — a tiny iframe-side client over the
  existing postMessage/AppBridge plumbing:
  - `hud.subscribe(channel, cb)` / `hud.getSnapshot(channel)` — wraps the
    `mcp-app-channel` envelope + `seq` gap detection.
  - `hud.requestDisplayMode("overlay"|"inline"|"fullscreen")` — wraps
    `bridge.requestDisplayMode`.
  - `hud.onHostContext(cb)` — theme + displayMode changes.
  - Re-export the channel types from `channels.ts`.
- Export `@librecode/sdk/hud` from the SDK package entry.
- `docs/mcp-apps/hud-authoring.md` (new) — the channel catalog with schemas,
  the overlay/click-through contract, the scene vocabulary, and a minimal
  copy-paste HUD example. Link from `docs/plans/mcp-apps-overhaul-roadmap.md`.
- A starter template under `examples/` (or the marketplace repo, ADR Phase 39):
  a runnable minimal HUD (HTML + the SDK client) people fork.

### Tests

- **Layer 1:** client envelope parsing (snapshot/delta/seq-gap); display-mode
  request round-trip against a mocked bridge.
- **Docs check:** the example HUD in the docs is the starter template (keep them
  identical; a test or lint asserts the snippet compiles / matches the file).

---

## 7. Sub-phase 55F — `skills` channel (DEFERRED — needs backend telemetry)

Skills are static `SKILL.md` declarations today; **nothing emits a runtime
"skill invoked" event**, so a derived `skills` channel has no source. This
sub-phase is blocked on backend work and is explicitly out of scope for the
initial Phase 55 ship.

When unblocked: emit `skill.invoked { sessionID, name, at }` (and optionally
`skill.completed`) where skills are loaded/run (`src/skill/`, the skill tool
path), add a `skills` channel (`{ invocations, milestones }`), and let the
Mission HUD / community renderers surface skill-usage milestones. Track as its
own phase once the event source lands.

---

## 8. Cross-cutting checklist (every sub-phase)

- [ ] One sub-phase per PR; `bun run typecheck`, `bun test`, `bun run lint`
      clean; no function >12 cyclomatic / >60 lines / file >1000 lines.
- [ ] No new `createResource` in the session/dock danger zone without an
      `// adr-006:` justification; add new overlay/HUD files to
      `DANGER_ZONE_GLOBS` if they enter the Suspense subtree.
- [ ] Real-WebKit Layer-3 spec for every UI-visible change (the harness is the
      gate this feature exists _because of_ — see Phase 54).
- [ ] Channels expose derived/aggregated data only — no file contents, tool
      args, message bodies, or secrets (ADR-0011 §4). Add a redaction test.
- [ ] Update `PLAN.md` (Phase 55 table) after each sub-phase.
- [ ] Regression-test statement in each PR: "would have been caught by Layer N."

## 9. Open questions to resolve during 55B/55D (not blockers)

1. Channel delivery vs. the bridge: a dedicated `mcp-app-channel` postMessage
   envelope (proposed) vs. modeling channels as MCP resources the app reads.
   Proposed wins on latency + simplicity; revisit if the MCP ext-apps spec gains
   a native streaming primitive.
2. Scene authoring ergonomics: single `scene` tool with an `action` discriminator
   (proposed) vs. several small tools. One tool keeps the tool list lean.
3. Overlay placement: fixed right-edge panel (v1) vs. author-controlled anchor
   via a manifest hint. Start fixed; add a hint later if asked.
