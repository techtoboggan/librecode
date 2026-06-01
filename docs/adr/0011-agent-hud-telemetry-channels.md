# ADR-0011: Agent HUD — overlay display mode + telemetry channels

Date: 2026-05-30
Status: Proposed (Phase 55)

## Context

The App Dock (ADR-009) hosts MCP apps as `inline` panes or `fullscreen`
takeovers. Two limitations block a whole class of experience:

1. **No way to render _over_ the live session.** An app is either boxed in the
   dock or it replaces the viewport. There is no translucent HUD layer that
   coexists with the chat/timeline — the natural shape for a heads-up display.
2. **No general data contract.** MCP apps see exactly four bus events
   (`activity.updated`, `message.part.updated`, `message.part.delta`,
   `session.status`), hardcoded in `mcp-app-panel/events.ts`, plus two ad-hoc
   REST seed endpoints (`/session/:id/activity`, `/session/:id/stats-seed`).
   Every app gets the same four events whether it wants them or not, and the
   far richer telemetry already on the bus is invisible to apps.

Meanwhile the bus already carries a deep, real-time picture of the agentic
platform's work:

- `agent.loop.start/transition/end` — a formalized state machine (ADR-003)
  with step counts, durations, tool-call counts, and exit reasons.
- `activity.updated` — files touched, classified by tool (read/write/shell/
  search), plus per-subagent phase.
- `todo.updated` — tasks with status (pending/in_progress/completed/cancelled)
  and priority.
- `message.updated` — per-message cost (USD) and token usage.
- permission/question gates, `mcp.app.tool_called`, `file.edited`.

The product goal (Phase 55): let people **see** what the agentic platform is
doing — where it is focusing, what has been cleared, what has been gained, what
remains — in whatever representation gives them meaning and trust: a HUD, a
pipeline map, an RTS-style minimap, an ARPG-style world. The platform should
ship the _contract and a reference renderer_; the community writes the creative
views as ordinary MCP apps.

Two data sources are in scope (decided with the user):

- **Derived** — automatic signals shaped from existing bus events. Works for
  every session with zero agent cooperation, but generic.
- **Agent-authored** — semantic "scene" state the agent (or a plugin/skill)
  explicitly pushes ("objective X cleared", "region Y gained"). The richer,
  game-like layer; only populates when something drives it.

Gap surfaced during design: **skills have no runtime telemetry.** Skills are
static `SKILL.md` declarations; nothing emits a "skill invoked" event. A
derived `skills` channel therefore needs new backend events and is deferred.

## Decision

### 1. Add an `overlay` display mode

Extend the existing display-mode system (`mcp-app-display-mode.ts`,
`HostDisplayMode`) with a third value `overlay`, alongside `inline` and
`fullscreen`. An overlay app renders as a translucent layer **over** the
session view (z-index between the timeline and `fullscreen`'s `z-50`), so the
chat remains visible underneath.

- **Opt-in.** An app advertises overlay support via its manifest
  (`_meta.ui.displayModes` includes `"overlay"`); the host only offers the
  toggle for apps that opt in. `resolveDisplayModeRequest` gains `overlay` in
  `HOST_AVAILABLE_DISPLAY_MODES`.
- **Click-through by default.** The overlay container is
  `pointer-events: none`; the app re-enables `pointer-events: auto` on its own
  interactive regions. A HUD must not trap clicks meant for the session.
- **Reuses all existing plumbing.** The bridge already pushes display-mode
  changes (`setHostContext({ displayMode })` →
  `ui/notifications/host-context-changed`). Detach, iframe pooling, seeding,
  and the tool-proxy contract are display-mode-agnostic and unchanged.
- **ADR-006 safe.** Display mode is pure UI state; it does not key any
  `createResource`, so toggling overlay never trips the Suspense boundary.

### 2. Introduce Telemetry Channels (host → app)

A typed, **opt-in, per-app subscription** framework replaces the hardcoded
event allowlist.

- A **channel** is a named real-time data source with two Zod schemas: a
  `snapshot` (initial state, delivered on `mcp-app-ready`) and a `delta`
  (incremental updates). Schemas live in the SDK so app authors can type
  against them.
- A host-side **Telemetry Broker** subscribes once to the bus, shapes each
  relevant event into channel deltas, **throttles/coalesces** high-frequency
  channels, **redacts** (see §4), and pushes only the channels a given app
  subscribed to, over a new bridge message envelope
  (`{ type: "mcp-app-channel", channel, kind: "snapshot"|"delta", payload }`).
- Apps declare consumed channels in `_meta.ui.channels`. The existing
  `session-stats` and `activity-graph` builtins migrate onto channels; the
  four hardcoded forwarded events are removed in favor of the broker.

**v1 derived channels:** `pipeline` (agent.loop.\*), `tasks` (todo.updated),
`activity` (activity.updated files), `agents` (activity.updated agents),
`cost` (message.updated cost/tokens).

> Naming: deliberately **not** "provider" (collides with LLM `Provider`) and
> **not** "signal" (collides with Solid's `createSignal`). The framework is
> "telemetry channels"; the host component is the "broker".

### 3. Add an agent-authored `scene` channel

A new agent-facing surface lets the model/plugins/skills push **semantic game
state** that a renderer interprets:

- A new tool `scene` (capabilities: `pure`; opt-in, gated by `ToolCapabilities`)
  with verbs to set/merge objectives, regions, and markers, each carrying a
  status from a fixed vocabulary (`cleared` | `active` | `gained` | `remaining`
  | `blocked`). Generic enough for a Mission HUD, a fog-of-war map, or an RPG.
- A plugin API hook so plugins/skills can push scene updates without the model.
- The host stores per-session scene state (Drizzle migration), persists it, and
  broadcasts deltas on the reserved `scene` channel — same delivery path as
  derived channels, so renderers consume scene exactly like any other channel.

### 4. Security + performance model

- Channels expose **derived/aggregated** signals — counts, states, names,
  relative paths — **never** raw file contents, full tool arguments, secrets,
  or message bodies. Redaction is per-channel and enforced in the broker.
- **Opt-in only.** An app receives a channel solely if its manifest lists it;
  no app gets telemetry it didn't request. Scene data is session-scoped.
- The iframe sandbox is unchanged (`allow-scripts`, null origin); the default
  CSP still blocks exfiltration. High-frequency channels (anything fed by
  `message.part.delta`) are throttled/coalesced in the broker to a bounded rate.

## Consequences

- The hardcoded `FORWARDED_EVENT_TYPES` allowlist is retired; `events.ts`
  becomes the broker's delta-shaping layer. Builtins move to channel
  subscriptions (behavior-preserving migration with tests).
- New agent tool surface (`scene`) and a new SDK module (channel schemas + an
  iframe-side client). App authors get a typed contract + a starter template.
- A new ADR-006 danger-zone entry if the Mission HUD (or future overlays) use
  `createResource`; the broker itself uses bus subscriptions with `onCleanup`,
  not resources, so it is outside the Suspense hazard.
- The `skills` channel is **not** delivered here — it depends on new backend
  skill-invocation telemetry (deferred sub-phase 55F).
- Verification leans on the Phase-54 real-WebKitGTK harness
  (`e2e/tauri-real/`): overlay rendering, click-through, and live channel
  updates are all asserted in the real desktop webview, not just Chromium.
