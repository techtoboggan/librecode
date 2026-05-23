# MCP Apps UX Redesign — Brainstorm + Plan

> Written 2026-05-22. The MCP-Apps integration shipped as a sequence of
> patches against the session side panel (Phases 15–17, 21, 28, 31, 32).
> The result is functional but cluttered: pinned MCP apps share a tab
> strip with Review, Activity, file tabs, port previews, and a Context
> view. This doc steps back, names the real friction, and proposes a
> redesign that gives MCP apps their own first-class layout slot.

---

## What's actually janky (the friction inventory)

Walking through the current session view honestly:

### 1. Seven categories of tabs in one strip

The session side panel today hosts:

1. **Review** — agent's diff (session-scoped, ephemeral)
2. **Apps** — MCP apps picker list (the McpAppsTab component)
3. **Activity** — Activity Graph (built-in MCP app)
4. **Pinned MCP apps** — one tab per pin (user-scoped, cross-session)
5. **Port previews** — auto-detected localhost ports (session-scoped, ephemeral)
6. **Context** — token usage display (session-scoped)
7. **File tabs** — sortable, drag-and-droppable open files (session-scoped)

These have completely different **lifecycles** (ephemeral vs persistent),
different **owners** (agent-driven vs user-pinned), and different
**interaction models** (read-only viewing vs full interaction). Putting
them in one horizontal strip flattens that hierarchy.

### 2. Pinned apps and Review fight for the same slot

The biggest UX failure: when the agent finishes a tool call, the Review
tab fills with diffs the user should look at. If the user has pinned
Session Stats and is watching cost in real-time, switching to Review
**hides** the stats. Switching to Stats hides Review.

What users actually want is to **see both at once** — agent diff
visible AND glanceable dashboards visible. The current layout makes
that physically impossible.

### 3. Activity exists twice

There's an "Activity" built-in tab (`ActivityTab` component, rendered
inline) AND an "Activity Graph" pinnable MCP app (rendered as
`McpAppPanel`). Same data, same purpose, different presentations.
Confusing for both users ("which one?") and contributors
("which one do I update?").

### 4. Three discovery paths

- **Start menu** (top-of-app shell, `start-menu.tsx`) — global
- **Apps tab** (inside session side panel) — same picker rendered inline
- **Pinned tabs** (inside session side panel) — quick access to already-pinned

Three doors, one room. Users have to learn which to use when.

### 5. Tab-strip overflow

A typical 30-minute session ends up with: Review, Apps, Activity,
3 pinned apps (Stats / Multica / Activity Graph), 2 port previews
(:3000, :5173), Context, and 6 open files. That's **15 tabs** in a
horizontal strip with scroll. Information density is fine; cognitive
load is not.

### 6. Iframe re-mount on tab switch

We worked around this with `forceMount` + `opacity:0` overlay positioning
(the comment at line 445-459 of `session-side-panel.tsx` explains the
hack). It works but the design owes its existence to "iframes are
expensive" — not to user intent. The right design wouldn't need this
trick.

### 7. Pinning state is per-LibreCode-instance, not per-workspace

Pinned apps persist in localStorage. Switching projects or worktrees
doesn't change which apps are pinned. For dashboards (Session Stats) this
is right. For project-specific tools (a Multica board configured for
THIS project) this is wrong.

### 8. Phase-31 wave of patches

Five separate Suspense-flash fixes (ADR-006), three iterations of the
start-menu, multiple "data seeding" patches, "no more duplicate tabs",
"forced Review on completion". Every fix added another rule to a system
that didn't have a clear underlying model. The model needs to be made
explicit so the next bug fixes itself.

---

## Mental model — what's a tab actually FOR?

Step back. There are four conceptually distinct things happening:

| Category              | Examples                                           | Lifecycle                | Who owns it              |
| --------------------- | -------------------------------------------------- | ------------------------ | ------------------------ |
| **Session output**    | Review diff, Activity log, Context usage           | Ephemeral per-session    | The agent                |
| **Session artifacts** | Port previews, file tabs, terminal output          | Ephemeral per-session    | Tools the agent invoked  |
| **User dashboards**   | Session Stats, Activity Graph                      | Persistent cross-session | User-pinned, glance-only |
| **User companions**   | Multica board, todo list, scratch pad, web preview | Persistent cross-session | User-pinned, interactive |

The current design puts categories 1–4 in **one horizontal strip**. That's
the root cause. Different categories want different real estate:

- **Session output** wants the main work area — that's the "what's the
  agent doing right now" view.
- **Session artifacts** want to flow naturally from the work — `:3000`
  preview should be near the bash command that spawned it; file tabs are
  fine as tabs.
- **User dashboards** want **always-visible, peripheral** real estate.
  Like the dock at the bottom of a Mac. Small, glanceable, no
  interaction needed.
- **User companions** want **always-available, on-demand** real estate.
  Like a sidebar in VS Code that toggles between Explorer / Search /
  Source Control / Extensions.

---

## Three design options

### Option A — Right-side App dock (recommended)

```
┌──────────────────────────────────────────────────────┬──────────────┐
│  Session view                                        │  App dock    │
│  ┌────────────────────────────────────────────────┐  │  ┌────────┐  │
│  │ Tabs:  Review · Activity · Context · file.ts   │  │  │ Stats  │  │
│  └────────────────────────────────────────────────┘  │  │ ▔▔▔▔▔  │  │
│  ┌────────────────────────────────────────────────┐  │  │ [chart]│  │
│  │                                                │  │  └────────┘  │
│  │  Agent thread / diff review / file content     │  │  ┌────────┐  │
│  │                                                │  │  │ Multica│  │
│  │                                                │  │  │ ▔▔▔▔▔  │  │
│  │                                                │  │  │ [board]│  │
│  │                                                │  │  └────────┘  │
│  └────────────────────────────────────────────────┘  │  ┌────────┐  │
│  ┌────────────────────────────────────────────────┐  │  │  + Add │  │
│  │ Composer (prompt input)                        │  │  └────────┘  │
│  └────────────────────────────────────────────────┘  │              │
└──────────────────────────────────────────────────────┴──────────────┘
```

**Key moves:**

- **Session tabs stay** for Review / Activity (renamed to Timeline or
  History) / Context / file tabs / port previews. These are
  session-scoped, agent-driven. The tab strip becomes cleaner.

- **A new right-side App dock** for pinned MCP apps. Multiple apps
  visible simultaneously — stacked vertically, or in a configurable
  1/2/3-column grid. Each app gets its own pane with a header (name,
  collapse/expand, settings).

- **Dock has its own toggle** — `Ctrl+B`-style. Collapsed by default
  on narrow screens; expanded by default if the user has pinned anything.

- **Built-in dashboards move into the dock** by default (Session Stats,
  Activity Graph). They're already designed for glanceable use; they
  should always be visible if pinned.

- **Activity tab gets renamed** to "Timeline" or "History" (live
  session events) and the duplicate Activity Graph pinnable app
  becomes the canonical visualization. Two views of the same data,
  but one is "session log" (left/main) and one is "graph dashboard"
  (right dock).

- **Start menu becomes the canonical discovery surface.** The "Apps"
  tab inside the session panel goes away — its functionality moves to
  a "+ Add" button at the bottom of the dock. Users learn: Start menu
  to browse/install; dock to use.

- **Per-workspace dock state**: persist `pinnedApps + dock state` keyed
  on `projectID` (not globally) so project-specific tool layouts stick.

**Pros:**

- Clean conceptual separation (session vs apps)
- Multi-app workflows enabled (Stats + Multica simultaneously)
- Eliminates duplicate Activity-tab-vs-Activity-Graph
- Dashboards become first-class always-visible
- Tab strip shrinks back to 5–7 items
- Mobile-friendly (dock collapses on narrow screens)

**Cons:**

- Two `Tauri/iframe` panes side-by-side = more memory than one tabbed pane
- Requires rethinking how the iframes mount/persist
- Wide screens benefit most; on a 13" laptop the dock eats space

**Effort:** medium. The infrastructure (`McpAppPanel`, pin context, SSE
forwarding) is all reusable. Need: a new `AppDock` component, layout
math for resizable split, dock state context, and migration of the
current pinned-app rendering from tab content to dock pane.

---

### Option B — Detachable app windows

```
┌────────────────────────┐        ┌────────────────────┐
│  Session view          │        │  Multica (window)  │
│                        │        │  ┌──────────────┐  │
│  Tabs/Review/Files     │        │  │   [board]    │  │
│                        │        │  │              │  │
│  Composer              │        │  └──────────────┘  │
└────────────────────────┘        └────────────────────┘

┌─────────────────────┐
│ Session Stats (win) │
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│  [chart]            │
└─────────────────────┘
```

**Key moves:**

- Each pinned MCP app opens as a **separate Tauri window** (we already
  have multi-window support in the desktop shell)
- App tab inside the session view goes away entirely
- Windows persist across sessions; user lays them out wherever
- The session view focuses entirely on agent + Review + files

**Pros:**

- Maximum flexibility for power users
- Native OS-level window management (taskbar, virtual desktops, mission control)
- Session view becomes truly clean
- Apps become true first-class workspace tools, not session subsidiaries

**Cons:**

- Native windows are heavyweight (Tauri's overhead per window)
- Web-only users (`bun run dev:web`) can't use this — Tauri-only feature
- Cross-window state sync is hard (the SSE forwarding currently relies
  on the iframe being in the same context)
- Drastic departure from current UX — high learning cost

**Effort:** high. Major refactor of how iframes mount + how state syncs.
Probably 4–6 weeks. Worth it eventually but not as a near-term unblock.

---

### Option C — Grouped tab strip (minimal change)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [Session: Review · Activity · Context] │ [Apps: Stats · Multica] │ │
│                                                                       │
│  Active tab content                                                   │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Key moves:**

- Keep the existing tab strip but visually split it into two **groups**:
  session tabs (left, blue) and app tabs (right, amber). A vertical
  separator between them. Same code path; same rendering.
- Remove the "Apps" tab; route discovery only through the Start menu.
- Eliminate Activity-tab-or-Activity-Graph-pinned-app duplication
  (pick one, deprecate the other).

**Pros:**

- Smallest possible refactor (~1 day)
- Visual clarity without structural change
- No new components

**Cons:**

- Doesn't solve the "review + stats hidden behind each other" problem
- Tab strip still gets crowded
- Still iframe-rebuild-on-switch (or stuck with the forceMount overlay hack)
- Bandaid, not redesign

**Effort:** trivial. Half a day.

---

## Recommendation

**Ship Option A in two phases.** It addresses the real friction, builds
on what we have, and lands incrementally without a single high-risk PR.

### Phase 42a — Foundations (1 sprint)

1. **New `AppDock` component** in `packages/app/src/components/app-dock/`.
   Right-side resizable pane that hosts 1–N pinned MCP apps stacked
   vertically. Reuses `McpAppPanel` for each pane.

2. **New `useAppDockState` context** that owns:
   - Which apps are in the dock (replaces the global `pinnedApps`)
   - Per-app expanded/collapsed state
   - Dock visibility (`hidden | collapsed | expanded`)
   - Dock width (resizable, persisted to localStorage)
   - Per-workspace overrides so each project can have its own dock layout

3. **Move Session Stats + Activity Graph into the dock by default.** They
   are dashboards — they belong there. The user can move them back to
   "pinned in session strip" via a setting, but the new default surfaces
   their natural use case.

4. **The session side panel keeps its tab strip** but loses:
   - "Apps" tab → removed (use Start menu instead)
   - Pinned-app tabs → moved to dock

5. **The Start menu becomes the canonical add path.** "+ Add to dock" button
   in the menu. The menu also surfaces "already in dock" indicators.

6. **Migration:** existing `pinnedApps` localStorage → seed the dock on
   first launch.

### Phase 42b — Polish (1 sprint)

7. **Resolve Activity duplication.** Decide:
   - "Activity" built-in tab becomes "Timeline" — a chronological event
     log (session log)
   - "Activity Graph" MCP app is the visualization — lives in the dock
   - They render different views of the same `activity.updated` events.
     Both ship; they're complementary, not duplicates.

8. **Workspace-scoped dock state.** Pin Multica when working on project A;
   it stays pinned when you come back; project B has its own dock layout.

9. **Dock layout modes.** Stacked (default), 2-column, tabbed (when the
   user wants the original "one app visible" behavior). User-toggled.

10. **Iframe lifecycle improvements.** Each dock pane manages its own
    iframe; collapsed panes can pause their iframe (no more forceMount
    overlay hack required for the simple case).

### Phase 42c — Detachable windows (later, optional)

11. **Detach button** on each dock pane → opens that app in a Tauri window.
    Window position/size persists. Closing the window puts it back in
    the dock.
12. Desktop-only feature. Web users keep the dock-only experience.

---

## What's a concrete first step?

Build a vertical-stack `AppDock` prototype as a SIDE-BY-SIDE addition to
the session panel — don't rip anything out yet. Wire one app (Session
Stats) into the dock alongside its current Pinned-tab presence. Get a
feel for the resizing, the iframe sharing, the empty-state UX.

If it feels right after a few days of dogfooding, the rest of the plan
follows naturally. If it feels wrong (dock eats too much screen real
estate, multiple iframes are too heavy, etc.) we learn that cheaply
and pivot before doing the larger refactor.

The prototype is maybe 200–300 lines:

```tsx
// packages/app/src/components/app-dock/dock.tsx
export function AppDock(props: { sessionID: string }) {
  const { dockApps, toggle, width, setWidth } = useAppDockState()
  return (
    <Show when={dockApps().length > 0}>
      <ResizableHandle ... />
      <div class="flex flex-col gap-2 p-2" style={{ width: `${width()}px` }}>
        <For each={dockApps()}>
          {(app) => (
            <DockPane app={app} sessionID={props.sessionID} />
          )}
        </For>
      </div>
    </Show>
  )
}
```

A morning's work for the prototype. The dock state context is another
half day. Then dogfood for a week before committing to the larger move.

---

## What this is NOT

Not in scope for this redesign:

- **Replacing the chat composer.** That stays exactly where it is.
- **The agent's diff review surface.** Reviewing diffs is a session-
  scoped concept; it lives in the Review tab unchanged.
- **The Start menu's role.** It remains the global discovery point.
- **MCP-Apps protocol changes.** All of this is host-side UX. The
  `text/html;profile=mcp-app` contract, the AppBridge JSON-RPC handlers,
  the ui:// resource fetch — none of that changes.
- **Marketplace integration.** That's its own Phase 41 (see
  docs/plans/plugin-marketplace.md).

---

## Open questions

Before starting, decide:

1. **Default dock visibility.** Hidden on first launch (so existing
   users don't see a strange new pane) or shown if pinnedApps is
   non-empty? → probably "shown if user has pins, hidden otherwise."

2. **Where do port previews live?** They're session artifacts (ephemeral)
   but visually they're "the dev server's UI" which feels app-like.
   Option A keeps them in the session strip; we could also let users
   move them to the dock.

3. **Workspace vs project scope for dock state.** Worktree-aware (every
   worktree has its own) or project-aware (all worktrees of a project
   share)? → probably project-aware. Worktree-aware leaks UI state
   between branches.

4. **What happens to the "Apps" tab in old sessions?** When a user
   upgrades, sessions stored from v0.9.x have "apps" as a recorded tab
   value. Migration: silently route it to the new equivalent (probably
   open the Start menu) or drop it.

5. **Mobile/narrow screens.** Below ~1200px, do we hide the dock by
   default? Auto-collapse? Tab into the session strip? → probably hide
   below 900px (dock has no value if it fits one app at 250px width).

---

## Effort + risk summary

| Phase                          | Effort    | Risk                                | Value                        |
| ------------------------------ | --------- | ----------------------------------- | ---------------------------- |
| Prototype dock (one app)       | 1 day     | Low — additive only                 | Validates the model          |
| Phase 42a — Foundations        | 1 week    | Medium — moves pinned-app rendering | Big UX improvement           |
| Phase 42b — Polish             | 1 week    | Low — refinements on top of 42a     | Closes loose ends            |
| Phase 42c — Detachable windows | 2–3 weeks | Higher (Tauri multi-window)         | Power-user delight, optional |

Total: 2-3 weeks for 42a + 42b combined. Detachable windows can wait.

---

## Why this is better than what we have

The current design treats MCP apps as **first-class session tabs**, when
in reality they're **first-class workspace tools that happen to render
inside a session view**. That category error is the root of the
friction.

Option A acknowledges the difference. Session output stays in the session
view. User tools live in a user-tool layout space. Each gets the affordances
it deserves. The tab strip stops being a graveyard of mixed concerns.

The user came back from "review panel feels janky" to a redesign because
the actual diagnosis isn't "review is janky" — it's "the system doesn't
know what reviews vs apps vs files vs ports vs context ARE." Naming the
categories and giving each one its right home is the actual fix.
