# Agentic HUD — North Star & Roadmap

> Planning-session output. Frames the ambition behind ADR-0011 / Phase 55
> (`docs/adr/0011-agent-hud-telemetry-channels.md`,
> `docs/plans/phase-55-agent-hud-spec.md`) and the arc beyond it.
> Status: **accepted** (decisions resolved 2026-05-30). Posture:
> prove-then-invest, community-weighted authorship, opt-in agent narration.

---

## 1. The north star

**Make the agentic platform a legible, renderable world.**

What the agent is doing — where it's focusing, what it's cleared, what it's
gained, what remains — should be _visible_ and _trustworthy_, in whatever
representation gives a person meaning: a quiet HUD, a pipeline map, an
RTS-style minimap, an ARPG world.

Two layers make that real:

1. The platform emits a **rich, typed, real-time stream** of its own activity
   (derived telemetry) plus a **semantic scene** the agent itself authors.
2. **Anyone can render that stream** however they want, as an ordinary
   sandboxed MCP app. The platform ships the contract + one reference; the
   community ships the creativity.

The bet: **trust comes from transparency, and adoption comes from delight.**
A coding agent you can _watch_ — like a game, a dashboard, a living map — is
both easier to trust and more fun to use than a wall of streaming text.

## 2. Why now

- **Trust is the #1 barrier to agentic adoption.** People don't trust what they
  can't see. "What is it doing right now, and is it on track?" is unanswered
  today except by reading the transcript.
- **The pieces are unusually ready.** LibreCode already has (a) a rich event
  bus with the agent-loop state machine, activity tracking, tasks, and cost;
  (b) a sandboxed MCP-app host with a display-mode system and a bridge;
  (c) — as of Phase 54 — a way to actually _verify_ desktop-webview UI in the
  real WebKitGTK runtime. Most of this is assembly, not invention.
- **It's a differentiator.** No coding agent lets you watch it as a HUD or a
  game. It's simultaneously a trust tool, a delight surface, and a marketing
  surface (a streamable "command center" view).

## 3. Design tenets

1. **Contract-first.** The telemetry-channel + scene schema _is_ the product.
   Renderers are interchangeable; the data contract is the durable API.
2. **Platform ships the contract + one reference; community ships creativity.**
   We are not in the business of building StarCraft. We make it possible to.
3. **Opt-in, redacted by default.** Apps receive only channels they declare;
   channels carry derived/aggregated signals, never file contents, tool args,
   message bodies, or secrets (ADR-0011 §4).
4. **Two data sources, two strengths.** Derived telemetry works for _free_, for
   every session. Agent-authored scene is the magic layer — the agent narrating
   its own work — and only lights up when something drives it.
5. **Verified in the real webview.** Everything UI-visible is asserted in real
   WebKitGTK (the Phase-54 harness), never Chromium-only. We earned this rule
   the hard way (v0.10.12–.16).

## 4. Strategic bets (proposed — confirm in §6)

- **Bet A — Ship a vertical slice before investing in the ecosystem.** Validate
  that an overlay HUD _feels_ right and that people leave it open, before
  building the SDK/marketplace machinery. Cheapest way to de-risk a speculative
  feature.
- **Bet B — The agent-authored scene is the more novel half.** A Mission HUD of
  derived telemetry is nice; the agent _narrating its work as a living map_ is
  the thing nobody else has. Treat scene as a first-class direction, not a
  footnote.
- **Bet C — Lean on the existing marketplace.** Renderers + scene-emitting
  skills are marketplace content (Phase 39, mcpappfoundry.app). Don't build a
  second distribution channel.

## 5. Roadmap horizons

> Horizons, not hard dates. Each horizon ends with a decision point: do the
> reactions justify the next horizon's investment?

**H0 — Vertical slice (validate the feel).** _Phase 55A–55C._
Overlay display mode + a thin telemetry broker (3 channels: tasks, agents,
cost) + the Mission HUD reference app. Outcome: a translucent HUD you can watch
during a real session. **Gate:** does it feel good? Do you leave it open?

**H1 — Make it real for authors.** _Phase 55B (full) + 55D + 55E._
All five derived channels; the agent-authored `scene` channel + `scene` tool +
persistence; the `@librecode/sdk/hud` client + starter template + authoring
docs. Outcome: a third party can ship their own renderer without touching
LibreCode internals.

**H2 — Ecosystem + first-party showcase.** _New phases, post-55._
Marketplace integration for renderers + scene skills; 1–2 polished first-party
HUDs that show range (a **pipeline/agent map**, an **RTS-style minimap** over
the file tree); a default scene-authoring skill so the agent narrates by
default (if Bet/decision §6.3 says default-on). Outcome: a living catalog +
the "wow" demos.

**H3 — Speculative / community-driven (the wild stuff).** _Backlog._
ARPG/HOMM-style worlds; a multi-session **command center** (watch several
agents at once); **shared/streamed sessions** (watch someone's agent like a
Twitch stream); **historical replay** (scrub a finished session's scene). These
are mostly community-authored once H1 lands; we enable, we don't build.

**Dependencies / backlog (not on the critical path):**

- `skills` channel — needs new backend `skill.invoked` telemetry (Phase 55F).
- Cross-session aggregation + replay/recording of the channel/scene stream.
- A higher-performance canvas path if heavy renderers strain the iframe
  postMessage bridge (revisit only if a real renderer hits the ceiling).

## 6. Resolved decisions (2026-05-30)

1. **Ambition level → prove-then-invest.** Ship the H0 slice first; expand into
   H1/H2 only on evidence the feel lands. H0 carries a hard gate (§5).
2. **Renderer authorship → both, community-weighted.** Ship the contract +
   starter template + marketplace path AND polish 1–2 first-party showcase HUDs
   (H2: pipeline map, RTS minimap) to set the bar. Community does the long tail.
3. **Agent narration → opt-in first, measure.** The `scene` tool exists and the
   agent uses it when relevant; no forced narration. Revisit a default
   narration skill in H2 with adoption + cost data in hand.

Implication for sequencing: **H0 (Phase 55A–C) is the only committed work;**
H1 (55D–E) and H2 are contingent on the H0 gate. The `scene` tool (55D) still
ships in H1 as an opt-in capability — the decision above only defers _default_
narration, not the capability itself.

(Contract versioning — channels are a public API — is an implementation concern
handled in 55B: `seq` per channel, additive-only schema evolution, explicit
`version` in the channel registry.)

## 7. Success signals

- People **leave the HUD open** during real sessions (retention of the surface).
- Qualitative: "I finally trust what it's doing" / "I can tell when it's stuck."
- Community publishes **≥ a few independent renderers** within a release or two
  of H1.
- Scene-authoring gets adopted (skills/plugins emitting scene), proving the
  dual-source model.

## 8. Risks & how we hold them

- **Over-investing before validation** → H0 gate; don't build H2 until the slice
  proves the feel.
- **Performance** (iframe + high-frequency data) → broker throttling/coalescing
  from day one; canvas-path escape hatch only if needed.
- **Contract churn** breaking community renderers → additive-only evolution +
  `seq`/`version` discipline from 55B.
- **Security** (telemetry → sandboxed app) → opt-in + redaction + null-origin
  sandbox (ADR-0011 §4); a redaction test per channel.
- **Scope creep into a game engine** → we ship the _contract + reference_; the
  wild renderers are community-authored. Hold the line.
