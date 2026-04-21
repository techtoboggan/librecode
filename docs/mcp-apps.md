# MCP Apps in LibreCode

LibreCode hosts MCP "apps" — sandboxed iframes loaded from `ui://` resources advertised by connected MCP servers. They show up in the **Apps** dropdown in the session header and can be pinned as tabs alongside Review and Activity.

This guide covers what an MCP server author needs to do to plug an app into LibreCode, what the app can and can't do, and how the security model works.

---

## What an MCP app is

A blob of HTML served as an MCP resource. The host:

1. Discovers the resource by listing MCP server resources and filtering by mime type `text/html;profile=mcp-app`.
2. Fetches the HTML on demand via `GET /mcp/apps/html?server=…&uri=…`.
3. Renders it in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) with the host's theme tokens injected as CSS custom properties.
4. Exposes a `postMessage`-based JSON-RPC channel ("AppBridge") so the app can call back into the host for tools, links, and logging.

The app's HTML can be anything — vanilla JS, a bundled SPA, a single canvas. As long as the iframe boots and the script runs, it's a valid app.

---

## Minimal MCP server exposing an app

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import z from "zod"

const APP_HTML = `<!doctype html>
<html><head><title>Hello</title></head><body>
  <h1>hello from acme</h1>
  <script>
    // Tell the host we're ready (built-in apps that want a snapshot do this).
    if (window.parent !== window) window.parent.postMessage({ type: "mcp-app-ready" }, "*")
  </script>
</body></html>`

const server = new McpServer({ name: "acme-app-server", version: "1.0.0" })

server.registerResource(
  "hello-app",
  "ui://acme/hello",
  {
    title: "Hello",
    mimeType: "text/html;profile=mcp-app",
    _meta: {
      ui: {
        // ADR-005 manifest: which tools may this app call?
        // [] / missing = display-only, ["*"] = any tool on this server,
        // ["foo","bar"] = only those names.
        allowedTools: [],
      },
    },
  },
  async () => ({
    contents: [{ uri: "ui://acme/hello", mimeType: "text/html;profile=mcp-app", text: APP_HTML }],
  }),
)

server.registerTool(
  "echo",
  { title: "Echo", inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: "text", text }] }),
)

await server.connect(new StdioServerTransport())
```

Wire it into LibreCode's `librecode.json`:

```json
{
  "$schema": "https://librecode.app/config.json",
  "mcp": {
    "acme-app-server": {
      "type": "local",
      "command": ["bun", "/path/to/server.ts"]
    }
  }
}
```

It'll appear in the Apps dropdown in the session header.

---

## What apps can do

### Receive live events (free, automatic)

The host forwards a fixed allowlist of SSE events into every running MCP app iframe via `postMessage`:

| Event | Use case |
|---|---|
| `activity.updated` | File / agent activity for the session |
| `message.part.updated` | Coalesced message-part updates (tool calls, step finishes) |
| `message.part.delta` | Streaming token deltas |
| `session.status` | Session busy / idle |

Listen with the standard browser API:

```js
window.addEventListener("message", (e) => {
  const msg = e.data
  if (msg?.type === "activity.updated") {
    console.log("session activity:", msg.properties)
  }
})
```

### Call tools on the same MCP server (gated)

Apps may invoke tools via the AppBridge. The host enforces the per-resource manifest:

- **`allowedTools` missing or `[]`** — display-only app, every `tools/call` is rejected with `isError: true`.
- **`allowedTools: ["foo", "bar"]`** — only those names.
- **`allowedTools: ["*"]`** — any tool the same MCP server exposes.

Cross-server calls are not permitted regardless of manifest contents. Built-in apps (`__builtin__` server) are always denied.

```js
import { AppHelper } from "@modelcontextprotocol/ext-apps/app"

const app = new AppHelper(/* ... */)
const result = await app.callTool({ name: "echo", arguments: { text: "hi" } })
```

The host returns a standard `CallToolResult`. Failures (manifest denial, server disconnect, network error, tool error) come back as `{isError: true, content: [{type: "text", text: "..."}]}` — never as a JSON-RPC fault.

### Open external links (validated)

```js
await app.openLink({ url: "https://example.com" })
```

Only `http:` and `https:` URLs are honored. `javascript:`, `data:`, `file:`, `blob:` etc. are silently rejected. The host calls `platform.openLink(url)` — on desktop this opens the system browser; on web it calls `window.open(url, "_blank", "noopener,noreferrer")`.

### Log to the host console

```js
app.sendLoggingMessage({ level: "info", logger: "submodule", data: "hello" })
```

Routed to the browser console as `[mcp-app:<server>/<logger>] <data>` with severity-appropriate console method. Useful for debugging without ever leaking back to the model.

### Push a host context request

Apps receive theme + display-mode info from the host on connect:

```ts
const ctx = app.getHostContext()
// ctx.theme === "dark" | "light"
// ctx.displayMode === "inline"
```

The host pushes `ui/notifications/host-context-changed` whenever the user toggles theme.

---

## What apps can't do (yet)

Deferred — these AppBridge methods return "not supported" errors today:

| Method | Status | Why deferred |
|---|---|---|
| `ui/message` | not wired | Easy to abuse as model-exfiltration channel; needs UX |
| `ui/update-model-context` | not wired | Same concern + context-window cost; needs UX |
| `ui/request-display-mode` | not wired | Fullscreen / pip needs design work |
| `ui/download-file` | not wired | Needs confirmation dialog UX |
| `resources/list`, `resources/read`, etc. | not wired | Needs proxy endpoints; coming in 0.9.40+ |
| `prompts/list` | not wired | Same |
| `sampling/createMessage` | not wired | LLM sampling cost + privacy |

The bridge structure already accommodates these — they're follow-up work, not architectural limits.

---

## Theming

The host injects two things into the iframe's `srcdoc` before mounting:

1. **CSS custom properties** mirroring the host's theme tokens — `--lc-bg`, `--lc-text`, `--lc-border`, `--lc-accent`, etc. Apps that style themselves with `var(--lc-bg)` look native.
2. **A `color-scheme: light dark` declaration** so form controls and scrollbars adapt.

You don't need any special CSS to look good — apps that use `var(--lc-*)` will inherit the host palette automatically. Hardcoded colors will look out of place when the user toggles theme.

The bridge also pushes `theme: "light"|"dark"` via the host context so JS can react:

```js
app.onhostcontextchanged = ({ changes }) => {
  if (changes.theme) renderForTheme(changes.theme)
}
```

---

## Security model

Layered defense in depth:

1. **Iframe sandbox**: `sandbox="allow-scripts"` only — no `allow-same-origin`. The app runs at a null origin, can't read host cookies, localStorage, or IndexedDB.
2. **CSP**: Strict default — `default-src 'none'`; scripts are inline-only with `unsafe-eval`; `connect-src 'none'` (apps cannot make HTTP requests, they communicate exclusively via the AppBridge); `frame-src 'none'` (no nested iframes).
3. **Manifest enforcement**: Per-resource `_meta.ui.allowedTools` is the gate on tool calls. Built-in apps always denied.
4. **URL allowlist for open-link**: Only http/https URLs are honored.
5. **Per-call audit trail**: Every tool call is logged at the host with `{server, uri, name, args}`.

Future work (tracked in [ADR-005](adr/005-mcp-app-tool-proxying.md)):
- Per-app permission UI ("Always allow" / "Always deny" the user can revoke).
- Per-app revoke button surfaced in the tab.
- Settings panel to manage stored grants.

---

## References

- [ADR-005: MCP App Tool Proxying](adr/005-mcp-app-tool-proxying.md) — full design rationale + trade-offs.
- [MCP App spec](https://github.com/modelcontextprotocol/ext-apps) — the AppBridge protocol and types.
- Built-in apps live at `packages/librecode/src/mcp/builtin-apps/` — `fs-activity-graph.html` and `session-stats.html` are minimal real examples.
- The host implementation is `packages/app/src/components/mcp-app-panel.tsx` — sandboxing, CSP, theme injection, AppBridge wiring.
- The server-side route is `packages/librecode/src/server/routes/session/mcp-apps.ts` — manifest enforcement + proxy.
