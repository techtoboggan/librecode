# ADR-005: MCP App Tool Proxying

**Status:** Accepted
**Date:** 2026-04-20
**Decision:** Wire the AppBridge so MCP apps can call tools on the MCP server that exposed them, gated by an explicit allowlist on the resource and the existing per-session permission system.

---

## Context

LibreCode hosts MCP "apps" — sandboxed iframes loaded from `ui://` resources advertised by connected MCP servers. Up to v0.9.37 the host instantiated `AppBridge` with a `null` MCP client, meaning apps were purely a one-way display surface: they received SSE-derived events via `postMessage` (activity, message parts, status) but had no way to call back into the host. That's fine for the two built-in widgets (Activity Graph, Session Stats) but blocks any third-party use case where the iframe wants to *do* something — read a file, run a tool, fetch a resource, list prompts.

The MCP App spec defines exactly this surface via JSON-RPC over `postMessage`:

| App → Host request | Purpose |
|---|---|
| `tools/call` | Execute a tool exposed by the MCP server |
| `tools/list` | Enumerate tools |
| `resources/list`, `resources/read`, `resources/templates/list` | Read resources from the server |
| `prompts/list` | Read prompts from the server |
| `ui/open-link` | Ask the host to open an external URL |
| `ui/download-file` | Ask the host to deliver a file to the user |
| `ui/message` | Post a message into the chat thread |
| `ui/update-model-context` | Push context that the model sees on the next turn |
| `notifications/message` | Logging |

This ADR commits to wiring the read-only and tool-call paths in v0.9.38–9, and explicitly defers the chat/context-injection paths to a later release.

## Problem

A naive wiring — "pass the connected MCP `Client` directly to `AppBridge` and let it auto-forward everything" — breaks LibreCode's security posture in three ways:

1. **No principal separation.** The MCP server's tools execute under the agent's permission scope. Letting an iframe punch through to those tools means a third-party app can run `bash` (or any other destructive tool the server exposes) with no user consent and no audit trail.

2. **No tool scoping.** A malicious or buggy app could enumerate every tool on every connected server and try to abuse them. Apps should only be able to call tools the server author explicitly opted-in.

3. **No revocation surface.** The user has no way to see what an app is doing or stop it once it starts.

## Decision

### 1. Resource-side manifest

The MCP server author declares the tools each `ui://` resource is allowed to call via `_meta.ui.allowedTools` on the resource:

```ts
server.registerResource(
  "weather-app",
  "ui://acme/weather",
  {
    title: "Weather",
    mimeType: "text/html;profile=mcp-app",
    _meta: {
      ui: {
        allowedTools: ["get_forecast", "geocode"],  // explicit allowlist
      },
    },
  },
  async () => ({ contents: [...] }),
)
```

- **Empty / missing array** → display-only app, no tool calls allowed (the v0.9.37 default).
- **Concrete tool names** → those tools and only those tools may be called.
- **Wildcard `["*"]`** → all tools the same MCP server exposes. Server authors should use this rarely; it's an explicit "this app is the server" signal.
- **Cross-server calls are prohibited.** An app may only call tools on the server that hosted its resource. The host enforces this on every request.

### 2. Per-call permission gating

Every `tools/call` from an iframe flows through the existing `Permission` system with a new principal: `{ kind: "mcp-app", server, uri, tool }`. First-time calls show a permission prompt:

> **Weather app wants to run `get_forecast`.**
> [ Allow once ]  [ Always allow ]  [ Always deny ]  [ Cancel ]

- "Always allow" is stored per-app-per-tool, scoped to the project (re-prompts on a new project).
- "Always deny" is similarly stored; the bridge returns `isError: true` immediately on subsequent calls.
- Auto-accept mode covers MCP-app calls just like agent calls — users who've turned on auto-accept opt into not being prompted.

Built-in apps (`__builtin__` server) get no tool access regardless of manifest contents — they're hard-coded display widgets.

### 3. Endpoint shape

```
POST /session/:sessionID/mcp-apps/tool
Content-Type: application/json
{
  "server": "acme-weather",
  "uri":    "ui://acme/weather",
  "name":   "get_forecast",
  "arguments": { "location": "NYC" }
}
```

Response: standard MCP `CallToolResult` JSON, or `{ isError: true, content: [{ type: "text", text: <reason> }] }` for any of the failure modes (server not connected, manifest denial, permission denial, tool error).

The route validates in order:
1. Session exists and the request is authed.
2. Server `acme-weather` is currently connected.
3. The resource at `uri` is on that server and lists `name` in its `allowedTools` (or wildcard).
4. The Permission system grants the call (may prompt).
5. `MCP.callTool(server, name, arguments)` runs and returns.

### 4. Read-only proxies (no permission prompt)

`resources/list`, `resources/read`, `resources/templates/list`, and `prompts/list` proxy directly to the same MCP server with no permission gating. They're scoped to that one server (an app cannot enumerate other servers' resources). These are advisory — apps need them to render UI based on what the server actually exposes.

### 5. `ui/open-link`

Confirmed via the existing dialog system before opening. `https?://` only — `file://`, `javascript:`, `data:` etc. are rejected outright. Desktop calls `platform.openPath`; web falls back to `window.open(url, "_blank", "noopener,noreferrer")`.

### 6. `ui/download-file`

Confirmed via dialog. Embedded resources become a `Blob` + anchor click; resource links open in a new tab. No automatic save without consent.

### 7. Logging

`notifications/message` from the iframe routes to the existing notification context as `app.log` events — visible in the dev console and the notifications panel, never auto-dismissed for `error` level.

### 8. Explicitly deferred

The following AppBridge paths are **not** wired in v0.9.38–9 and stay as `null` handlers (returning a "not supported" error to the app):

- `ui/message` — apps can post into the chat thread. Powerful but easy to abuse as a model exfiltration channel; needs a separate UX design pass.
- `ui/update-model-context` — apps can stuff content into the next model turn. Same concern, with an extra wrinkle around context-window cost. Needs design.
- `ui/request-display-mode` — fullscreen / pip mode. Defer to UX work.
- `tools/list` from the app — apps already get the manifest's `allowedTools` as part of the host context; no need to round-trip the server.
- `sampling/createMessage` — apps requesting LLM sampling through the host. Defer (privacy + cost).

These are tracked as follow-up work; they're easy to add later because the bridge structure already accommodates handler registration.

### 9. Per-app revocation

Each pinned MCP app gets a small "running" indicator + a revoke button in the tab UI. Revoking:
- Closes the bridge transport (terminating in-flight calls)
- Drops the per-app permission grants for the current session
- Unmounts the iframe

The user's "Always allow" choices persist across revoke (project-scoped); the user can clear those from a settings panel (out of scope for v0.9.38–9, file follow-up).

## Trade-offs

**Why a per-resource manifest rather than per-server?** Some servers want to expose multiple apps with different capability surfaces — e.g., an admin dashboard with full tool access vs. a read-only viewer. Per-resource keeps the scope tight.

**Why proxy through a host endpoint rather than the AppBridge auto-forwarder with a real Client?** The auto-forwarder bypasses our permission system. Proxying lets us insert the permission check, the manifest enforcement, and the audit log on the boundary. It also means we can fail safely (return `isError`) without crashing the bridge.

**Why no rate-limiting in v0.9.38?** The permission system already rate-limits user-facing prompts. A misbehaving app that hammers `tools/call` will mostly hammer the user-consent dialog, which auto-coalesces. We can add explicit rate limits if real-world usage shows the need.

**Why defer `ui/message`?** The simplest abuse: an app reads sensitive output, then posts it as a "user" message to nudge the model into exfiltrating it elsewhere. Mitigation needs a separate UX (clearly labeling app-originated messages) and a default-deny posture. Worth doing right rather than fast.

## Implementation order

| Release | Scope |
|---|---|
| v0.9.38 | Endpoint, manifest enforcement, permission gate, `oncalltool` + `onlistresources/onreadresource/onlistresourcetemplates/onlistprompts` wiring, unit tests |
| v0.9.39 | `onopenlink`, `ondownloadfile`, `onloggingmessage`, `setHostContext` (theme + dimensions + display mode), per-app revoke UI, docs/mcp-apps.md |

## References

- MCP App spec types: `@modelcontextprotocol/ext-apps/app-bridge`
- AppBridge API surface: `node_modules/@modelcontextprotocol/ext-apps/dist/src/app-bridge.d.ts`
- LibreCode permission system: `packages/librecode/src/permission/`
- Existing MCP integration: `packages/librecode/src/mcp/index.ts`
- Built-in apps + host: `packages/librecode/src/mcp/builtin-apps/` + `packages/app/src/components/mcp-app-panel.tsx`
