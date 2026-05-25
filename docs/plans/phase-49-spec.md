# Phase 49 — Detachable Tauri windows

> Self-contained execution spec for the next Sonnet worker.
> Phase 49 of the MCP-Apps overhaul (`docs/plans/mcp-apps-overhaul-roadmap.md`).
> Lands on top of Phase 48 (v0.9.88, shipped). Targets **v0.9.89**.
>
> **⚠️ This is the highest-risk phase in the overhaul.** It spans Rust
> (Tauri 2.x multi-window) + TypeScript (IPC + routing + UI). The roadmap
> Gate 3 note explicitly authorizes a pivot if Tauri multi-window proves
> too painful: "fall back to 'open in default browser window'." Read §0
> and §2 carefully before writing any code. If the Sub-A spike doesn't
> land cleanly in ~half a day, STOP and report — don't burn days fighting
> Tauri.

---

## 0. Why this phase exists

Phases 42–48 made the App Dock the canonical home for MCP apps. The
end-state vision in the roadmap includes multi-monitor power users who
want a Multica board on monitor 2, a Stats dashboard on monitor 3, and
the agent thread on monitor 1. The dock-only experience can't deliver
this — every pane lives in the main session window.

Phase 49 introduces **detachable Tauri windows**: any dock pane can be
"popped out" into its own native window, persists across LibreCode
restarts, and can be re-attached back into the dock when the user
wants the unified view again.

**End-state user flow:**

1. User clicks the Detach button (⤢) in a dock pane header.
2. A new Tauri window opens carrying the same MCP app — same iframe
   content, same AppBridge, same backend session.
3. The dock pane is replaced with a "Detached — re-attach" placeholder.
4. User can move/resize the new window anywhere (incl. another monitor).
5. Closing the new window keeps "detached" state — next session start,
   the window reopens at the same position.
6. Clicking "Re-attach to dock" from the new window OR the placeholder
   closes the new window and restores the pane inline.

**Why it's risky:**

- Tauri 2.x multi-window IPC: limited official docs, fast-moving API.
- Iframe re-mount on detach is unavoidable — apps that don't implement
  the v0.9.62 state-relay lose ephemeral state. Trade-off must be
  documented and explained in the UI.
- SSE event stream multiplexing: detached window opens its own SSE
  connection; backend must handle N concurrent connections per session.
- Tauri capability allow-list: forgetting to allow new commands gives
  cryptic runtime errors.
- macOS window menu, Linux window state plugin, Windows compositor —
  three different desktop integrations to validate.
- Web build must hide the Detach button entirely (no popup fallback —
  browsers can't open a new window with the same React/Solid tree).

---

## 1. Done-state walkthrough

After Phase 49 ships at **v0.9.89**:

1. **Desktop user**: opens LibreCode. Pins Stats + Multica + Activity
   Graph in the dock. Clicks the new ⤢ (detach) button on Multica's
   pane header. A new native window opens titled "Multica — LibreCode"
   carrying the same Multica board. The dock pane is replaced with a
   placeholder card showing "Multica detached — Re-attach" button.
2. **Multi-monitor**: user drags the Multica window to monitor 2.
   Closes LibreCode. Re-opens. Multica window automatically reopens
   on monitor 2 at the same position (via `tauri-plugin-window-state`).
3. **Re-attach**: user clicks "Re-attach to dock" in either the
   detached window's header menu OR the dock placeholder. The
   detached window closes; the dock pane shows the Multica iframe
   again at its previous height/collapse state.
4. **Web user** (`bun run dev:web`, browser): no Detach button
   visible anywhere — `usePlatform().platform === "web"` hides it.
   No regression in dock or panel behavior.
5. **Closing main window while detached**: closing the main LibreCode
   window cleanly closes all detached app windows too. Workspace
   state is preserved — next launch restores all detached windows.
6. **State-relay-aware apps** (Multica, Stats) survive detach without
   losing scroll position / filters. State-relay-naïve apps reset to
   defaults on detach with a one-line toast: "App state was reset on
   detach — apps can opt into state preservation via the state-relay
   protocol."

---

## 2. Scope

### In scope

- New Rust primitive: `DetachedAppWindow` struct + `open_detached_app_window`
  Tauri command in `packages/desktop/src-tauri/src/app_window.rs`.
- Three new Tauri commands: `open_detached_app_window`,
  `close_detached_app_window`, `is_detached_app_window_open`.
- Allow-list updates in `packages/desktop/src-tauri/capabilities/main.json`.
- New SolidJS route `/detached/:server/:uriHash` mounting a minimal
  `<DetachedAppShell>` that renders one `<McpAppPanel>`.
- Detach button in `pane-header.tsx`; web-platform-hidden.
- New dock placeholder UI: `pane-detached-placeholder.tsx`.
- Dock state extension: `DockEntry.detached?: boolean`, with
  `detach(uri)` and `reattach(uri)` actions in `use-dock-state.tsx`.
- IPC: detached window → main window event for re-attach via
  `app.emit_to("main", "dock.reattach", { uri })`.
- Platform context extension: `usePlatform().openDetachedWindow?()`.
- Main-window close hook to close all detached windows.
- Web fallback: Detach button hidden on `platform === "web"`.
- 12+ new unit tests covering detach state, web fallback, placeholder UI.
- Rust integration verification documented as a manual smoke step.
- ADR-009 changelog row + PLAN.md entry + CHANGELOG.md v0.9.89 entry.
- Version bump 0.9.88 → 0.9.89.

### Out of scope

- Sharing the SAME iframe DOM node across windows. Tauri can't do this.
  Apps will re-mount on detach; rely on state-relay for persistence.
- Detached window with multiple panes inside it. One detached window =
  one app, always.
- Drag-from-dock-to-detach gesture. Click-the-button only.
- Custom title bars / chrome on detached windows. Use Tauri defaults
  with the app name in the title.
- Detach for built-in apps (`server === "__builtin__"`). Defer to a
  follow-up — built-in apps embed app-specific code into the LibreCode
  bundle, making the route reuse trickier than for normal MCP apps.
  The Detach button is hidden for built-in entries in this phase. (If
  this turns out to be trivial during execution, expand scope to
  include built-ins — but don't go fighting it.)
- Phoenix telemetry for detach events. Add later via Phase 50's
  performance pass.
- Performance / accessibility polish — explicitly Phase 50.

### Pivot escape hatch (from roadmap Gate 3)

If by the end of **Step 3 (Sub-A — Rust window creation)** you cannot
open a second Tauri webview window carrying an arbitrary URL, **STOP
and report**. Do not invent workarounds or fight the API. The pivot
in that case is documented in Appendix B: "open in browser window"
via `shell.open(detachUrl)`, but it requires backend HTTP serving of
the UI bundle, which is itself non-trivial. Don't try to ship the
pivot in the same phase — that's a separate planning conversation.

---

## 3. Constraints

### CLAUDE.md non-negotiables

- **No semicolons** (TS), **120 char line width**, **named exports
  only**, **explicit return types** on exported TS functions.
- **TypeScript strict** — no `any`.
- **Rust**: follow existing `windows.rs` style. Public structs documented.
  No `unwrap()` in non-test code — use `?` and `tauri::Error`.
- **File length ≤ 1000**. Phase 48 set
  `session-side-panel.tsx` to 448 lines — DON'T regress it. The new
  files in this phase are all <300 lines by design.
- **TDD**: write failing test first.
- **Pre-commit hook**: `prettier --check` on staged files. Will catch
  formatting issues before commit.

### ADR-006 (Suspense / startTransition) — danger zone

The new files added in this phase are NOT in the existing danger-zone
glob (`pages/session/**`, `start-menu.tsx`, `mcp-app-panel.tsx`,
`pinned-apps.tsx`). However, `pages/detached/**` should be added to
`DANGER_ZONE_GLOBS` in `scripts/lint-adr-006.ts` because the detached
shell mounts the same `<McpAppPanel>` that triggers Suspense.

**Action**: in the same commit that creates `pages/detached/`, update
the lint allow-list. `<DetachedAppShell>` does not introduce new
`createResource` calls; the resource comes from `<McpAppPanel>`
itself, which is already audited.

### Tauri 2.x patterns

- Use `WebviewWindowBuilder::new(app, label, WebviewUrl::App(url))`,
  NOT the deprecated 1.x `WindowBuilder`.
- Webview URLs use the `tauri://localhost` scheme for production. In
  dev (`devUrl: http://localhost:1420`), use the same dev URL with
  the route path appended.
- Window state plugin (`tauri-plugin-window-state`) is already
  imported in `windows.rs`. New windows auto-persist when given a
  stable label.
- Tauri events are JSON-serializable. Use simple `{ uri: string }`
  payloads.
- Permissions: every new `#[tauri::command]` must be added to
  `capabilities/main.json` under `permissions`.

### IPC channel design

- **Main → Detached**: not needed in this phase. Detached windows
  fetch their own SSE / state via the standard SDK.
- **Detached → Main**: ONE event — `dock.reattach { uri }`. Emitted
  when the detached window's "Re-attach" menu item is clicked OR the
  user closes the window AND chooses "reattach to dock" in a
  confirmation. Default close = stay detached.

### Window labeling

- Label format: `detached-${server}-${uriHash}` where `uriHash` is a
  stable 8-char hex from the FNV-1a hash of the full URI (deterministic
  across Tauri versions, unlike `encodeURIComponent` which depends on
  the platform's escape table).
- The Rust side owns the hashing. TS passes raw `{ server, uri }` to
  the command; Rust computes the label and creates / looks up the
  window.

---

## 4. Files to create

### 4a. `packages/desktop/src-tauri/src/app_window.rs` — NEW

```rust
//! Detached MCP-app windows.
//!
//! Phase 49: each dock pane can be popped out into its own Tauri
//! webview window. The window URL points at the SolidJS detached
//! route (`/detached/:server/:uriHash`); the window state plugin
//! persists position/size/monitor per label across restarts.
//!
//! Labels: `detached-<server>-<uriHash>` where uriHash is a stable
//! FNV-1a hex digest of the full URI. This keeps the same window
//! identity across Tauri versions and across URI representations
//! that differ only in URL-encoding.

use std::ops::Deref;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Stable 8-char hex digest of a string using FNV-1a (32-bit).
pub fn uri_hash(uri: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5
    for byte in uri.bytes() {
        hash ^= byte as u32
        hash = hash.wrapping_mul(0x0100_0193)
    }
    format!("{:08x}", hash)
}

/// Build the canonical label for a detached app window.
pub fn window_label(server: &str, uri: &str) -> String {
    // Replace anything not [a-z0-9_-] in `server` so the Tauri label
    // validator accepts it (labels must match `[a-zA-Z0-9_-]+`).
    let safe_server: String = server
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect()
    format!("detached-{}-{}", safe_server, uri_hash(uri))
}

/// One detached app window.
pub struct DetachedAppWindow(WebviewWindow)

impl Deref for DetachedAppWindow {
    type Target = WebviewWindow
    fn deref(&self) -> &Self::Target { &self.0 }
}

impl DetachedAppWindow {
    /// Open a detached window for the given app. If one already exists
    /// with the same label, focuses it instead of creating a duplicate.
    pub fn open(
        app: &AppHandle,
        server: &str,
        uri: &str,
        app_name: &str,
    ) -> Result<Self, tauri::Error> {
        let label = window_label(server, uri)
        if let Some(existing) = app.get_webview_window(&label) {
            existing.set_focus()?
            return Ok(Self(existing))
        }

        // Compose the URL. URL-encode the URI for the path segment.
        let encoded_uri = urlencoding::encode(uri)
        let url = format!("/detached/{}/{}", urlencoding::encode(server), encoded_uri)

        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
            .title(format!("{} — LibreCode", app_name))
            .inner_size(800.0, 600.0)
            .min_inner_size(400.0, 300.0)
            .resizable(true)
            .decorations(true)
            .build()?

        Ok(Self(window))
    }

    /// Close the detached window if it exists. No-op otherwise.
    pub fn close(app: &AppHandle, server: &str, uri: &str) -> Result<(), tauri::Error> {
        let label = window_label(server, uri)
        if let Some(window) = app.get_webview_window(&label) {
            window.close()?
        }
        Ok(())
    }

    /// Check if a detached window for this app is currently open.
    pub fn is_open(app: &AppHandle, server: &str, uri: &str) -> bool {
        let label = window_label(server, uri)
        app.get_webview_window(&label).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*

    #[test]
    fn fnv1a_is_stable() {
        assert_eq!(uri_hash("ui://multica/board"), uri_hash("ui://multica/board"))
        assert_ne!(uri_hash("ui://a"), uri_hash("ui://b"))
    }

    #[test]
    fn label_sanitises_server_name() {
        let label = window_label("acme/weather", "ui://x")
        assert!(label.starts_with("detached-acme_weather-"))
        assert!(!label.contains("/"))
    }

    #[test]
    fn label_is_deterministic() {
        assert_eq!(window_label("s", "u"), window_label("s", "u"))
    }
}
```

**Critical**: write the `;` line endings as **the Rust file uses semicolons** (CLAUDE.md "no semicolons" applies to TS only). Copy-paste this file verbatim then RE-ADD all the semicolons that this Markdown spec dropped to render cleanly — every statement ending needs `;`. The Rust code in the spec uses dropped-`;` form purely for spec readability; the actual file needs them.

Add to `packages/desktop/src-tauri/Cargo.toml` if missing:

```toml
urlencoding = "2.1"
```

### 4b. `packages/desktop/src-tauri/src/lib.rs` — MODIFY

Add three new `#[tauri::command]` functions and register them:

```rust
mod app_window;

#[tauri::command]
async fn open_detached_app_window(
    app: tauri::AppHandle,
    server: String,
    uri: String,
    app_name: String,
) -> Result<(), String> {
    app_window::DetachedAppWindow::open(&app, &server, &uri, &app_name)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_detached_app_window(
    app: tauri::AppHandle,
    server: String,
    uri: String,
) -> Result<(), String> {
    app_window::DetachedAppWindow::close(&app, &server, &uri)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn is_detached_app_window_open(
    app: tauri::AppHandle,
    server: String,
    uri: String,
) -> bool {
    app_window::DetachedAppWindow::is_open(&app, &server, &uri)
}
```

Register in the `invoke_handler` call near line 336:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    open_detached_app_window,
    close_detached_app_window,
    is_detached_app_window_open,
])
```

(Adapt if the existing `invoke_handler` uses a builder — keep the
existing style.)

**Main window close hook** — find where `MainWindow::create` returns
or where the main window is configured. Add an `on_window_event`
handler that, when the main window is `CloseRequested`, iterates
all open `detached-*` labeled windows and closes them too. Pattern:

```rust
main_window.on_window_event(move |event| {
    if let tauri::WindowEvent::CloseRequested { .. } = event {
        // Close all detached app windows
        let handle = main_window.app_handle();
        for window in handle.webview_windows().values() {
            if window.label().starts_with("detached-") {
                let _ = window.close();
            }
        }
    }
});
```

### 4c. `packages/desktop/src-tauri/capabilities/main.json` — MODIFY

Find the existing capability file (likely under `capabilities/`). Add
the three new commands to the `permissions` array:

```json
{
  "permissions": [
    // ... existing
    "core:default",
    { "identifier": "core:webview:allow-create-webview-window" }
    // Phase 49 detach commands — exposed as direct invokes from JS:
    // (Tauri auto-grants user-defined commands by default in capability
    // files unless explicitly denied. Verify by checking an existing
    // command's pattern in this file.)
  ]
}
```

**Verify by trial**: the capability system in Tauri 2.x auto-allows
user-defined commands unless the capability file is set to a strict
allowlist. The existing main.json shows the pattern. Match it.

### 4d. `packages/app/src/pages/detached/detached-app.tsx` — NEW

```ts
import { type JSX, Show, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { McpAppPanel } from "@/components/mcp-app-panel"
import { usePlatform } from "@/context/platform"

/**
 * Detached app shell — Phase 49.
 *
 * Renders a single `<McpAppPanel>` in a standalone Tauri window with
 * a slim header bar (app name + ⋮ menu for Re-attach / Close / Reload).
 *
 * URL: `/detached/:server/:uri` where `:uri` is URL-encoded.
 *
 * ADR-006 N/A: no createResource at this layer. McpAppPanel is the
 * resource-bearing child and already audited.
 */
export function DetachedAppShell(): JSX.Element {
  const params = useParams<{ server: string; uri: string }>()
  const platform = usePlatform()
  const server = createMemo(() => decodeURIComponent(params.server))
  const uri = createMemo(() => decodeURIComponent(params.uri))

  const onReattach = async (): Promise<void> => {
    // Emit IPC event back to the main window. The main window's dock
    // state listener calls reattach(uri), which un-marks `detached`
    // and re-mounts the iframe inline.
    if (platform.invokeTauriEvent) {
      await platform.invokeTauriEvent("dock.reattach", { uri: uri() })
    }
    // Then close this window. Re-attach via main does NOT
    // close us; we close ourselves to keep the contract clean.
    if (platform.closeDetachedWindow) {
      await platform.closeDetachedWindow({ server: server(), uri: uri() })
    }
  }

  return (
    <div data-component="detached-app-shell" class="w-screen h-screen flex flex-col overflow-hidden">
      <DetachedHeader appName={server()} onReattach={onReattach} />
      <div class="flex-1 min-h-0">
        <Show when={server() && uri()}>
          <McpAppPanel server={server()} uri={uri()} class="w-full h-full" />
        </Show>
      </div>
    </div>
  )
}

function DetachedHeader(props: { appName: string; onReattach: () => void }): JSX.Element {
  return (
    <div
      class="flex items-center justify-between px-3 py-2 shrink-0 border-b border-border-weak-base bg-background-base"
      data-testid="detached-header"
    >
      <span class="text-12-medium text-text-strong truncate">{props.appName}</span>
      <button
        type="button"
        data-testid="detached-reattach"
        class="text-11-regular text-text-weak hover:text-text-base transition-colors"
        onClick={() => props.onReattach()}
        title="Re-attach this app to the main window's dock"
      >
        ↩ Re-attach to dock
      </button>
    </div>
  )
}
```

### 4e. `packages/app/src/pages/detached/index.ts` — NEW

```ts
export { DetachedAppShell } from "./detached-app"
```

### 4f. `packages/app/src/components/app-dock/pane-detached-placeholder.tsx` — NEW

```ts
import { type JSX } from "solid-js"
import type { McpAppResource } from "@/components/mcp-app-panel"

/**
 * Placeholder shown in the dock when an app has been popped out into
 * its own window. Includes a "Bring back" action.
 *
 * Phase 49 — replaces the iframe when DockEntry.detached === true.
 */
export interface PaneDetachedPlaceholderProps {
  app: McpAppResource
  onReattach: () => void
  onFocus: () => void
}

export function PaneDetachedPlaceholder(props: PaneDetachedPlaceholderProps): JSX.Element {
  return (
    <div
      data-testid={`detached-placeholder-${props.app.uri}`}
      class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center bg-background-subtle"
    >
      <div class="text-12-medium text-text-weak">{props.app.name} is detached</div>
      <div class="text-11-regular text-text-weaker max-w-64">
        This app is running in its own window. Bring it back to the dock or focus the window.
      </div>
      <div class="flex gap-2 mt-2">
        <button
          type="button"
          data-testid={`detached-placeholder-focus-${props.app.uri}`}
          class="text-11-medium text-text-weak hover:text-text-base px-2 py-1 rounded-md border border-border-weaker-base"
          onClick={() => props.onFocus()}
        >
          Focus window
        </button>
        <button
          type="button"
          data-testid={`detached-placeholder-reattach-${props.app.uri}`}
          class="text-11-medium text-text-base hover:text-accent-strong px-2 py-1 rounded-md bg-accent-subtle"
          onClick={() => props.onReattach()}
        >
          Bring back to dock
        </button>
      </div>
    </div>
  )
}
```

---

## 5. Files to modify

### 5a. `packages/app/src/components/app-dock/types.ts` — MODIFY

Add `detached?: boolean` to `DockEntry`:

```ts
export interface DockEntry {
  uri: string
  app: McpAppResource
  addedAt: number
  collapsed?: boolean
  heightPx?: number
  /** Phase 49 — true when this app is currently popped out into its own Tauri window. */
  detached?: boolean
}
```

### 5b. `packages/app/src/components/app-dock/state.ts` — MODIFY

In `migrateDockState`, add the new optional field:

```ts
entries.push({
  uri: rec.uri,
  addedAt: rec.addedAt,
  app: {
    /* ... */
  },
  collapsed: typeof rec.collapsed === "boolean" ? rec.collapsed : false,
  heightPx: typeof rec.heightPx === "number" ? rec.heightPx : undefined,
  detached: typeof rec.detached === "boolean" ? rec.detached : false,
})
```

Add two new pure helpers (export them):

```ts
/** Mark an entry as detached. No-op if entry doesn't exist. */
export function detachEntry(state: DockState, uri: string): DockState {
  return {
    ...state,
    entries: state.entries.map((e) => (e.uri === uri ? { ...e, detached: true } : e)),
  }
}

/** Mark an entry as attached (un-detach). No-op if entry doesn't exist. */
export function reattachEntry(state: DockState, uri: string): DockState {
  return {
    ...state,
    entries: state.entries.map((e) => (e.uri === uri ? { ...e, detached: false } : e)),
  }
}
```

### 5c. `packages/app/src/components/app-dock/use-dock-state.tsx` — MODIFY

Add `detach(uri)` and `reattach(uri)` to the returned context value.
They wrap `detachEntry` / `reattachEntry` and persist the new state.
Look at how the existing `pin()` / `removeEntry()` are wired and
mirror exactly.

### 5d. `packages/app/src/components/app-dock/pane-header.tsx` — MODIFY

Add a Detach button. Hidden when `platform.platform === "web"` OR
when the app is a built-in (`uri.startsWith("librecode://builtin/")`
or `server === "__builtin__"`).

```ts
import { usePlatform } from "@/context/platform"

export interface PaneHeaderProps {
  uri: string
  appName: string
  server: string // ADD — needed to check built-in
  collapsed: boolean
  status: PaneStatus
  detached: boolean // ADD
  onToggleCollapse: () => void
  onRemove: () => void
  onReconnect: () => void
  onViewError: () => void
  onDetach: () => void // ADD
}

export function PaneHeader(props: PaneHeaderProps): JSX.Element {
  const platform = usePlatform()
  const canDetach = (): boolean => platform.platform === "desktop" && props.server !== "__builtin__" && !props.detached
  // ... existing component body + insert Detach button before PaneMenu
}
```

The Detach button JSX (insert between collapse chevron and PaneMenu):

```jsx
<Show when={canDetach()}>
  <button
    data-testid={`pane-detach-${props.uri}`}
    type="button"
    class="text-text-weak hover:text-text-base shrink-0 ml-1"
    aria-label={`Detach ${props.appName} into its own window`}
    title="Detach into its own window"
    onClick={(e) => {
      e.stopPropagation()
      props.onDetach()
    }}
  >
    <span aria-hidden="true">⤢</span>
  </button>
</Show>
```

### 5e. `packages/app/src/components/app-dock/dock.tsx` — MODIFY

Where the iframe is currently rendered, branch on `entry.detached`:

```jsx
<Show
  when={!entry.detached}
  fallback={
    <PaneDetachedPlaceholder
      app={entry.app}
      onReattach={() => dock.reattach(entry.uri)}
      onFocus={() => platform.focusDetachedWindow?.({ server: entry.app.server, uri: entry.uri })}
    />
  }
>
  <McpAppPanel /* ... existing */ />
</Show>
```

Add a new effect at component-level that listens to Tauri
`dock.reattach` events and calls `dock.reattach(uri)` (the IPC
listener; only registered on `platform.platform === "desktop"`).

Pass `server={entry.app.server}` and `detached={entry.detached ?? false}`
and `onDetach={() => onDetach(entry)}` to `<PaneHeader>`.

The `onDetach(entry)` handler:

```ts
const onDetach = async (entry: DockEntry): Promise<void> => {
  if (!platform.openDetachedWindow) return
  try {
    await platform.openDetachedWindow({
      server: entry.app.server,
      uri: entry.uri,
      appName: entry.app.name,
    })
    dock.detach(entry.uri)
  } catch (err) {
    showToast({ kind: "error", message: `Failed to detach ${entry.app.name}: ${err}` })
  }
}
```

### 5f. `packages/app/src/context/platform.tsx` — MODIFY

Add three optional methods to the `Platform` type:

```ts
export type Platform = {
  // ... existing

  /** Phase 49 — Tauri only. Opens a detached window for an MCP app. */
  openDetachedWindow?(opts: { server: string; uri: string; appName: string }): Promise<void>

  /** Phase 49 — Tauri only. Closes a detached window if open. */
  closeDetachedWindow?(opts: { server: string; uri: string }): Promise<void>

  /** Phase 49 — Tauri only. Focuses a detached window (no-op if closed). */
  focusDetachedWindow?(opts: { server: string; uri: string }): Promise<void>

  /** Phase 49 — Tauri only. Emit a Tauri IPC event to the named target window. */
  invokeTauriEvent?(name: string, payload: unknown): Promise<void>
}
```

Then in the Tauri implementation (likely `desktop-platform.ts` or
similar — find by `grep -rn "platform: \"desktop\"" packages/app/src`):

```ts
openDetachedWindow: async ({ server, uri, appName }) => {
  await tauriInvoke("open_detached_app_window", { server, uri, appName })
},
closeDetachedWindow: async ({ server, uri }) => {
  await tauriInvoke("close_detached_app_window", { server, uri })
},
focusDetachedWindow: async ({ server, uri }) => {
  // Reuse open — it focuses if already open.
  await tauriInvoke("open_detached_app_window", { server, uri, appName: server })
},
invokeTauriEvent: async (name, payload) => {
  const { emit } = await import("@tauri-apps/api/event")
  await emit(name, payload)
},
```

The web implementation should NOT define these methods at all (they
remain `undefined`). Callers gate on `if (platform.openDetachedWindow)`
or use optional chaining.

### 5g. Router setup — find and modify

Search for the router config:

```bash
grep -rn "@solidjs/router\|<Router\|<Route " packages/app/src --include="*.tsx" --include="*.ts" | head -10
```

Add a new route:

```jsx
<Route path="/detached/:server/:uri" component={DetachedAppShell} />
```

The detached route should NOT be wrapped in the normal session
layout — it has its own minimal shell. If the router uses a layout
component, ensure the detached route is OUTSIDE that layout (sibling
route at the top level).

### 5h. `scripts/lint-adr-006.ts` — MODIFY

Add `pages/detached/**` to the `DANGER_ZONE_GLOBS` array. No
`createResource` calls in the new files, so no annotations needed
yet, but the glob ensures future additions get checked.

### 5i. ADR-009, PLAN.md, CHANGELOG.md — UPDATE

Standard pattern. Same shape as Phase 48 docs commits.

ADR-009 row:

```markdown
| Phase 49 (v0.9.89) | Added detachable Tauri windows. Each dock pane can pop out into its own native window (Detach button in pane header). Windows persist position/size/monitor across restarts via `tauri-plugin-window-state`. Re-attach via window header menu or dock placeholder. Web build hides Detach button. Built-in apps not detachable in this phase (deferred). |
```

CHANGELOG.md v0.9.89 entry:

```markdown
## [0.9.89] - 2026-05-XX

### Added

- **Detachable app windows (Desktop).** Click the ⤢ button on any
  dock pane header to pop the app out into its own native window.
  Windows persist position, size, and monitor across restarts.
  Multi-monitor workflows now work — put Multica on monitor 2 and
  the agent thread on monitor 1.

### Changed

- Detached apps re-mount when popped out. Apps that implement the
  v0.9.62 state-relay protocol (Multica, Stats) survive without
  losing state. Apps that don't will reset to defaults on detach.

### Known limitations

- Built-in apps (Session Stats, Activity Graph) cannot be detached
  in v0.9.89 — deferred to a follow-up.
- Web build does not support detach (browsers can't share the
  SolidJS root across windows).
```

---

## 6. Tests required

### 6a. Rust unit tests — `app_window.rs` `#[cfg(test)]` module

Already in §4a's skeleton. Three tests: `fnv1a_is_stable`,
`label_sanitises_server_name`, `label_is_deterministic`. Run with:

```bash
cd packages/desktop/src-tauri && cargo test
```

### 6b. TS pure tests — `pane-detached-placeholder.test.tsx`

Render the component with a mock app, click Reattach + Focus, assert
the respective callbacks fired. 4+ tests:

1. Renders with app name visible.
2. Reattach button click → `onReattach` called once.
3. Focus button click → `onFocus` called once.
4. Has `data-testid="detached-placeholder-{uri}"`.

### 6c. TS pure tests — `state.test.ts` add detach/reattach

Add to existing `state.test.ts`:

1. `detachEntry` sets `detached: true` on matching uri.
2. `detachEntry` is a no-op when uri not found.
3. `reattachEntry` sets `detached: false`.
4. Migration: an entry with `detached: true` in raw data is preserved.
5. Migration: invalid `detached` value (e.g. string `"true"`) → `false`.

### 6d. TS unit test — pane-header detach button visibility

In `pane-header.test.tsx`, add:

1. Desktop platform + non-builtin app → ⤢ button is rendered.
2. Desktop platform + `server === "__builtin__"` → no ⤢ button.
3. Web platform → no ⤢ button regardless of server.
4. `detached === true` → ⤢ button is hidden (already detached).
5. Click ⤢ → `onDetach` called once.

(Use a `PlatformContext.Provider` mock to inject the platform value.)

### 6e. TS unit test — dock.tsx detached entry renders placeholder

In `dock.test.tsx`, add:

1. Entry with `detached: true` → renders `<PaneDetachedPlaceholder>`,
   NOT `<McpAppPanel>`.
2. Entry with `detached: false` → renders `<McpAppPanel>` as normal.
3. Reattach button on placeholder → calls `dock.reattach(uri)`.

### 6f. TS unit test — detached-app.tsx

If full DOM render is too painful (provider tree), use the
mirror-function pattern: extract `onReattach` logic into a sibling
`detached-app.pure.ts` and test there. Bare minimum 3 tests:

1. `onReattach` calls `invokeTauriEvent` with correct payload.
2. `onReattach` then calls `closeDetachedWindow`.
3. `onReattach` is no-op if `platform.invokeTauriEvent` is undefined
   (web build).

### 6g. Manual smoke (CRITICAL — Phase 49 has no E2E coverage)

Run desktop dev:

```bash
bun run dev:desktop
```

Verify with eyes-on:

1. Add Stats and Multica to the dock.
2. Click ⤢ on Multica pane → new window opens with Multica board.
3. Move new window to different position on screen.
4. Close LibreCode entirely.
5. Re-launch LibreCode → Multica window should reappear at the same
   position (window-state plugin).
6. Click "Re-attach to dock" in detached window's header.
7. Detached window closes; dock pane shows Multica iframe inline.
8. Click ⤢ again, then "Bring back" from the dock placeholder.
9. Same result: window closes, iframe inline.
10. Detach + close main window → detached window also closes.
11. Toggle to web build (`bun run dev:web` in browser) → no Detach
    button visible anywhere.

Document the manual smoke results in the trip report.

---

## 7. Step-by-step execution order

Strict ordering. Each step ends with green tests before moving on.

### Step 1 — Baseline

```bash
cd /home/tristan/Projects/librecode
bun install
cd packages/app && bun test --timeout 30000 2>&1 | tail -5
cd ../librecode && bun test --timeout 30000 2>&1 | tail -5
cd ../desktop/src-tauri && cargo test 2>&1 | tail -5
```

Record counts. After Phase 48: 726 app + 1987 librecode = 2713 total.
Cargo: record current pass count.

### Step 2 — Pure TS state plumbing (safe — no Tauri yet)

1. Edit `types.ts` to add `detached?: boolean`.
2. Edit `state.ts` to add `detachEntry`/`reattachEntry` + migration.
3. Write the new tests in `state.test.ts`. Run them. Confirm pass.
4. Edit `use-dock-state.tsx` to expose `detach(uri)` / `reattach(uri)`.
5. Run app tests. Pass count up by 5+.
6. **Commit**: `feat(app-dock): detached state helpers + DockEntry.detached field (Phase 49)`

### Step 3 — Sub-A SPIKE: Tauri window creation

**TIMEBOX: half a day. If at the end of this step you can't open a
second Tauri window from the JS console, STOP and write a "Phase 49
blocked" report.**

1. Create `packages/desktop/src-tauri/src/app_window.rs` from §4a.
   Re-add semicolons that the spec dropped (Markdown rendering).
2. Add `urlencoding = "2.1"` to `Cargo.toml` if not present.
3. Edit `lib.rs` to `mod app_window;` and add the three commands
   from §4b.
4. Update `capabilities/main.json` per §4c.
5. Run `cargo build` inside `src-tauri`. Fix compile errors.
6. Run `cargo test` — three new tests pass.
7. Run `bun run dev:desktop`. Once it boots, open DevTools and try:

   ```js
   const { invoke } = await import("@tauri-apps/api/core")
   await invoke("open_detached_app_window", {
     server: "test",
     uri: "ui://test/x",
     appName: "Test",
   })
   ```

   A blank window should appear. If yes, the spike works. If you get
   an error, debug it. If it doesn't work after ~half a day, **STOP**.

8. Close all extra windows. **Commit**: `feat(desktop): Tauri app_window.rs + open/close/is_open commands (Phase 49 Sub-A)`

### Step 4 — Sub-B/C: SolidJS detached route

1. Create `pages/detached/detached-app.tsx` + `index.ts` per §4d/4e.
2. Add the route in the router config per §5g.
3. Add `pages/detached/**` to `lint-adr-006.ts` allow-list per §5h.
4. From DevTools (with the dev server running), navigate the main
   window to `localhost:1420/detached/test/ui%3A%2F%2Ftest%2Fx`. The
   detached shell should render (will show a fetch error for the
   non-existent app — that's expected; what matters is the SHELL
   renders).
5. Run `bun run typecheck` + lint. Fix any issues.
6. **Commit**: `feat(app): /detached/:server/:uri route + DetachedAppShell (Phase 49 Sub-B)`

### Step 5 — Sub-D: Placeholder + dock integration

1. Create `pane-detached-placeholder.tsx` per §4f.
2. Write `pane-detached-placeholder.test.tsx` first (TDD).
3. Make tests pass.
4. Modify `pane-header.tsx` per §5d. Add tests per §6d.
5. Modify `dock.tsx` per §5e. Add tests per §6e.
6. Run all app tests. Confirm green.
7. **Commit**: `feat(app-dock): Detach button + detached placeholder (Phase 49 Sub-D)`

### Step 6 — Sub-E: Platform context + IPC wiring

1. Modify `context/platform.tsx` per §5f (type only).
2. Find the Tauri impl (search for the platform factory).
3. Wire up `openDetachedWindow`, `closeDetachedWindow`,
   `focusDetachedWindow`, `invokeTauriEvent` per §5f.
4. In `dock.tsx`, register the Tauri event listener for
   `dock.reattach` (`platform.platform === "desktop"` only).
5. Run app tests. Confirm green.
6. **Commit**: `feat(platform): openDetachedWindow + IPC wiring (Phase 49 Sub-E)`

### Step 7 — End-to-end manual smoke

Run through the 11-step smoke checklist in §6g. Document any
failures. Fix or note as known limitations.

If everything passes:

8. **Commit**: `test(detached): manual-smoke checklist documented (Phase 49)`
   (Optional — only if you added a `docs/smoke/phase-49.md` or
   similar with the results. Otherwise skip and document inline in
   the trip report.)

### Step 8 — Docs

Update PLAN.md, ADR-009, CHANGELOG.md per §5i.

9. **Commit**: `docs(adr,plan,changelog): Phase 49 detachable windows`

### Step 9 — Bump + push

Bump 0.9.88 → 0.9.89. Push to main. Tag v0.9.89.

10. **Commit**: `chore: bump version to 0.9.89`
11. `git push origin main && git tag v0.9.89 && git push origin v0.9.89`

---

## 8. Verification checklist

- [ ] `cargo test` from `src-tauri` passes; 3+ new tests in
      `app_window.rs`.
- [ ] `bun test --timeout 30000` from `packages/app` passes
      (≥726 + new tests).
- [ ] `bun test --timeout 30000` from `packages/librecode` passes
      (≥1987, no librecode changes expected).
- [ ] `bun run typecheck` clean.
- [ ] `bunx prettier --check .` clean.
- [ ] `bun run lint` clean (ADR-006 allow-list updated).
- [ ] Manual smoke 1–11 from §6g all green (or partial fails
      documented).
- [ ] v0.9.89 GitHub release green with all 14+ assets.
- [ ] Web build (`bun run dev:web`) shows no Detach button.

---

## 9. Common pitfalls

### Pitfall 1 — Rust file needs semicolons re-added

The Rust skeletons in this spec render without `;` for Markdown
clarity. The actual `.rs` file needs `;` at the end of every
statement. After copy-pasting, do a sanity pass.

### Pitfall 2 — Tauri 2.x capability auto-allow

Some Tauri 2.x versions auto-allow user-defined commands; others
require explicit `permissions` entries. If `cargo run` succeeds but
the runtime `invoke()` gives "permission denied," add the command
to `capabilities/main.json`. Check the existing pattern there.

### Pitfall 3 — `withGlobalTauri: false`

The Tauri config has `withGlobalTauri: false`, so DON'T try to use
`window.__TAURI__.invoke(...)` from the spike DevTools test. Use
the dynamic import pattern in §Step 3 instead:

```js
const { invoke } = await import("@tauri-apps/api/core")
```

### Pitfall 4 — URL encoding round-trip

The detached route takes `:server` and `:uri` as URL-encoded
segments. `encodeURIComponent("ui://multica/board")` becomes
`ui%3A%2F%2Fmulticast%2Fboard`. Both Rust (the window-open command)
and TS (the route param) do encode/decode. If anywhere along the
path you forget to decode, you'll end up trying to mount with a
broken URI and the app fetch fails with "404 not found." Always
log the decoded URI in the detached shell on first mount during
development.

### Pitfall 5 — Iframe state loss on detach

The iframe re-mounts on detach. Apps that don't implement the
state-relay protocol (v0.9.62) lose ephemeral state (scroll,
modals, form input). Document in CHANGELOG. Consider adding a
one-time toast "App state may reset on detach if the app doesn't
implement state preservation" but DON'T over-engineer; the toast
can come in Phase 50 polish.

### Pitfall 6 — Phase 48 carry-forward: Zod default makes optional required

This phase adds `detached?: boolean` to `DockEntry`. **Do not** add
`.default(false)` to the Zod schema (if there is one — `types.ts`
is just TS). If there IS a Zod schema validating dock state, keep
the field as `.optional()` to preserve the union output type. (No
Zod schema is currently expected for dock state — it's plain
TypeScript + localStorage migration. But verify.)

### Pitfall 7 — Window label collision

Two apps with the same FNV-1a hash of their URI would collide (rare
but possible with very small URIs). The label includes the
sanitized server name, which reduces collision risk. The
`existing.set_focus()` fallback in `DetachedAppWindow::open` means
collisions silently focus the wrong window instead of erroring.
Document this as a known edge case in the spec but don't
over-engineer mitigation.

### Pitfall 8 — Main-window close handler iterates all windows

The close hook (§4b) iterates `app.webview_windows().values()`. If
this is called during Tauri shutdown, the iterator might invalidate
mid-iteration. Wrap in a `let labels: Vec<String> = ...; for label
in labels { ... }` to snapshot the labels first, then close.

### Pitfall 9 — Built-in apps detection

Multiple ways to detect a built-in app: `server === "__builtin__"`,
`uri.startsWith("librecode://builtin/")`, or `entry.app.server` value.
The canonical check is `server === "__builtin__"` per Phase 47's
`pane-status.ts`. Use that exact string match.

### Pitfall 10 — Tauri devUrl vs frontendDist

In dev (`bun run dev:desktop`), the webview URL is
`http://localhost:1420/...` (the Vite dev server). In production,
it's `tauri://localhost/...` (the bundled assets). The
`WebviewUrl::App("...")` form correctly handles both. Don't
hardcode the dev URL.

### Pitfall 11 — Web build router

If the web build also includes the `/detached/...` route, hitting
that URL in a browser would also work — but the `<DetachedAppShell>`
would call `usePlatform()` and get `platform === "web"`. The
reattach button would no-op (no `invokeTauriEvent`). Fine. But
the iframe rendering would still try to mount, hitting the same
fetch endpoints. Acceptable as a side-effect — web users can
share the detached URL with desktop users.

### Pitfall 12 — `tauri-plugin-window-state` storage path

The plugin stores state in a per-app data directory. For
`librecode-dev` (the dev identifier), it's separate from `librecode`
(production). When testing window persistence, make sure to use a
consistent dev or prod build — switching mid-test will lose
window state.

---

## 10. Pre-drafted atomic commit subjects

In execution order:

1. `feat(app-dock): detached state helpers + DockEntry.detached field (Phase 49)`
2. `feat(desktop): Tauri app_window.rs + open/close/is_open commands (Phase 49 Sub-A)`
3. `feat(app): /detached/:server/:uri route + DetachedAppShell (Phase 49 Sub-B)`
4. `feat(app-dock): Detach button + detached placeholder (Phase 49 Sub-D)`
5. `feat(platform): openDetachedWindow + IPC wiring (Phase 49 Sub-E)`
6. `docs(adr,plan,changelog): Phase 49 detachable windows`
7. `chore: bump version to 0.9.89`

7 commits. Less granular than Phase 48 because the Rust + TS
back-and-forth makes splitting harder without ending up with broken
intermediate states.

---

## 11. When you're done

Report back in the markdown table format used in Phases 42–48:

```
| Aspect | Detail |
|---|---|
| Release | v0.9.89 status, asset count, CI duration |
| Commits | N atomic, list of subjects |
| Test delta | app: X → Y (+Z); librecode: A (no change); cargo: P → Q |
| Spike outcome | Sub-A worked first try / required X attempts / blocked |
| Manual smoke | Pass count out of 11 (§6g), list any failures |
| Built-in apps | Detach button hidden ✓, deferred for follow-up |
| Web fallback | Detach button hidden on web ✓ |
| Multi-monitor | Manually verified on Y monitors |
| Window persistence | Persists across restart ✓ / Failed (describe) |
| Deviations | (if any — note them) |
| New pitfalls | (if any surfaced — document for Phase 50) |
```

If Sub-A was **blocked**, report immediately with:

```
| Aspect | Detail |
|---|---|
| Sub-A outcome | BLOCKED |
| Tauri error / symptom | (describe) |
| What you tried | (list) |
| Time spent | X hours |
| Recommended next move | Pivot to "open in browser" / abandon Phase 49 / try different Tauri pattern |
```

Don't keep grinding past the timebox. Phase 49 being blocked is a
LEGITIMATE outcome; we'll either pivot or skip to Phase 50.

---

## Appendix A — Recon checksums

Run these before starting:

```bash
cd /home/tristan/Projects/librecode
git rev-parse HEAD          # should match de1a0e3 (Phase 48 head) or later
ls packages/desktop/src-tauri/src/ | grep -E "windows.rs|lib.rs"   # exists
grep -n "withGlobalTauri" packages/desktop/src-tauri/tauri.conf.json
grep -n "app_dock" packages/librecode/src/config/schema.ts
wc -l packages/app/src/components/app-dock/pane-header.tsx       # ~66
wc -l packages/app/src/components/app-dock/dock.tsx              # ~291
wc -l packages/app/src/components/app-dock/use-dock-state.tsx    # ~121
grep -rn "experimental.app_dock" packages/app/src | head -5
```

If any baseline differs significantly, re-verify the recon notes
in this spec before executing.

---

## Appendix B — Pivot to "open in browser" (if Sub-A blocks)

Do NOT attempt this in the same execution session as the spike. If
Sub-A fails, file a report and let Opus plan the pivot phase.

**Why it's not trivial**:

- The bundled UI is served from disk in production
  (`frontendDist: "../dist"` in tauri.conf.json). A browser pointing
  at `file://` URLs hits CORS issues immediately — the AppBridge
  postMessage works regardless of origin, but the fetch calls to
  `/mcp/apps/html` fail because the origin is `file://` and the
  backend CORS allow-list doesn't include it.
- In dev, the Vite dev server (`localhost:1420`) is reachable from a
  browser, so the pivot works there. Not in production.
- The librecode CLI HTTP server already runs on a localhost port. It
  doesn't serve the UI bundle today. Adding a static-file route to
  the CLI server would let the browser load `localhost:PORT/index.html`,
  which would work — but it expands scope significantly and changes
  the CLI's security posture (now serving arbitrary HTML).

The cleanest pivot is "use Tauri's `webview` plugin to embed the
webview manually without going through `WebviewWindowBuilder`"
which is more Rust gymnastics. We'd plan that as a new phase rather
than ship it inside Phase 49's grace period.

---

## 12. What ships next

Phase 50 — **Performance + accessibility polish**. After Phase 49,
the dock has its full feature set; Phase 50 polishes lazy iframe
mount, keyboard navigation, a11y landmarks, and Phoenix telemetry
for dock-pane lifecycle. The lower-risk phase after a higher-risk
one. Phase 51 is the public-docs / announcement phase. Then the
overhaul wraps.
