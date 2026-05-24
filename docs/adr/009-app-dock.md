# ADR-009: App Dock as first-class layout for MCP apps

Date: 2026-05-23
Status: Prototype (Phase 42)

## Context

Through Phases 15–32 LibreCode shipped MCP-Apps support as a series of
patches against the session side panel's tab strip. The result mixed
seven categories of tabs into one horizontal strip:

- Review / Timeline / Context / file tabs — session-scoped, ephemeral
- Pinned MCP apps — workspace-scoped, durable
- Port previews — environment-scoped, transient

These categories have different lifecycles, owners, and interaction
models. A single horizontal strip forces them into a shared UX that
serves none of them well. The full friction inventory is in
`docs/plans/mcp-apps-ux-redesign.md`.

Specific problems with the old design:

1. **Tab overflow.** Heavy workspaces (5+ pinned apps, multiple file
   tabs) overflow the strip into a scrollable area that users miss.
2. **Lifecycle mismatch.** Closing the review panel also hides pinned
   apps, confusing users who want both open simultaneously.
3. **Suspense coupling.** Every additional tab that hosts a
   `createResource` extends the surface area of the session Suspense
   boundary (ADR-006 incidents v0.9.54, .58, .70, .71).

## Decision

Pinned MCP apps move to a dedicated right-side **App Dock** — a
resizable pane that is independent of the session side panel. The
session tab strip keeps only session-scoped content (Review, Timeline,
Context, file tabs, port previews).

Key properties of the dock:

- **Workspace-scoped.** State persists per directory via localStorage
  (`Persist.workspace`) so apps survive session switches and restarts.
- **Additive.** The dock coexists with the existing pinned-tabs system
  during Phases 42–43; both coexist without conflict.
- **Feature-flagged.** Controlled by `experimental.app_dock` in
  `librecode.jsonc`. Default OFF. Users opt in explicitly.
- **Iframe-preserving.** Visibility toggling (`Ctrl+\`) uses
  `display:none` rather than unmounting the McpAppPanel, so the iframe,
  AppBridge, and postMessage transport survive hide/show cycles.
- **ADR-006 safe.** No `createResource` in the dock is keyed on a
  signal written by a user event handler. The persisted store uses
  synchronous localStorage hydration (no async resource). See
  `use-dock-state.tsx` for the justification comment.

This ADR covers Phase 42 (prototype): single-pane, no multi-app, no
reorder. Subsequent phases (43–51) flesh out the full model. See
`docs/plans/mcp-apps-overhaul-roadmap.md`.

## Consequences

**For users:** MCP apps can live in the dock independently of the review
panel. Ctrl+\\ toggles the dock without affecting the session transcript
or the review panel. Dock state (which app, width) survives restarts.

**For contributors:** New MCP apps that should appear in the dock are
added via `dock.add(McpAppResource)`. Do NOT add new tabs to the session
side panel's tab strip for MCP apps. The `app-dock/` component subtree
is in the ADR-006 danger zone — every `createResource` call must carry
an `// adr-006:` justification comment.

**For app authors:** No change. The dock hosts a `McpAppPanel` with the
same `server` / `uri` props as the tab-strip version. AppBridge and
theme injection work identically.

## Alternatives considered

**Option B — Floating overlay panel.** An absolute-positioned panel
that slides over the session content. Rejected: hides the transcript,
conflicts with portal-rendered modals, and requires z-index management
across Tauri WebView and desktop window layers.

**Option C — Detached Tauri window (first).** Ship the dock as a
separate Tauri window from day one. Rejected: too much surface area for
the prototype. Phase 49 will add this as an option once the single-pane
dock is validated.

## File references

- Implementation: `packages/app/src/components/app-dock/`
- Session integration: `packages/app/src/pages/session.tsx`
- Config flag: `packages/librecode/src/config/schema.ts` (`experimental.app_dock`)
- Phase spec: `docs/plans/phase-42-spec.md`
- Roadmap: `docs/plans/mcp-apps-overhaul-roadmap.md`
