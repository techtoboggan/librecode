# ADR-008: Multica MCP App + Phoenix Arize Telemetry

**Status:** Accepted
**Date:** 2026-04-26
**Decision:** (1) Add a self-contained Multica MCP app at
`mcpapps/multica/` that embeds Multica's kanban into LibreCode and
exposes three issue-management tools to the agent. (2) Wire a
Phoenix Arize OTel telemetry pipeline + Control Panel "Telemetry"
tab so users can ship LLM spans to a self-hosted Phoenix instance
and verify it's reachable.

---

## Context

Two adjacent asks the user posed in the same conversation:

1. **Multica.** [`multica-ai/multica`](https://github.com/multica-ai/multica)
   is an open-source agentic-issue-tracker (Linear-style kanban with
   AI agents as first-class actors alongside humans). The user wanted
   LibreCode to (a) embed Multica's web UI as an MCP app so an agent's
   work is visible on a kanban globally, and (b) push agent activity
   into Multica issues automatically. The user owns the eventual home
   for this — `librecode-multica-mcp-app` — but wants to iterate
   in-tree at `mcpapps/` first to avoid premature repo-split friction.

2. **Phoenix Arize.** [`Arize-ai/phoenix`](https://github.com/Arize-ai/phoenix)
   is the de-facto open-source LLM observability tool. The user wants
   the Control Panel to (a) configure where LibreCode ships LLM spans
   and (b) sanity-check that the configured endpoint is alive. The
   user runs the Phoenix daemon themselves — we don't manage its
   lifecycle.

Both could have been third-party packages, but each has a distinct
strategic value to LibreCode that justifies in-repo or
in-codebase placement: Multica as a reference MCP app for the
ecosystem, Phoenix as the canonical observability sink for the
agent loop.

## Decision

### Multica: a self-contained MCP app at `mcpapps/multica/`

The package has its own `package.json`, `node_modules`,
`README.md`, and tests — nothing in it imports from other LibreCode
packages. The future `librecode-multica-mcp-app` repo extraction is a
single `git filter-repo --path mcpapps/multica/` away.

What ships:

- **`MulticaClient`** — typed REST wrapper around `/api/issues`,
  `/api/projects`, `/api/comments`. PAT auth (`Authorization:
Bearer mul_…` + `X-Workspace-Slug: <slug>`). Health-checks via
  `/healthz`. Throws `MulticaError` (preserves status + endpoint)
  on non-2xx so callers can branch on the failure mode.

- **MCP server** with three tools:
  - `multica_create_issue(title, description?, projectId?, status?, priority?)`
  - `multica_update_status(identifier, status)`
  - `multica_add_comment(identifier, content)`

  Plus a `ui://multica/board` resource (HTML, mimeType
  `text/html;profile=mcp-app`) that renders an iframe pointing at
  the configured Multica web UI. Configuration is read from env
  vars on startup so MCP hosts can drive it via their existing
  config mechanism (e.g. LibreCode's `librecode mcp add` CLI).

- **Tests** — 30 unit tests against a fake `fetchFn`. Network paths
  are mocked; the full WebSocket realtime stream is out of scope for
  v0.9.76 (the `multica_*` tools push to REST, Multica's UI handles
  the realtime subscription on its own).

#### Why a separate package, not a `packages/librecode-multica/`?

Two reasons:

1. **Repository separation locality.** The user said this should be
   its own repo eventually. Putting it in `packages/` would imply
   "part of the librecode monorepo permanently"; `mcpapps/` reads as
   "external MCP apps that happen to live here for now."

2. **Dependency boundary.** An MCP app is a separate process —
   spawned by the host over stdio. It runs in its own Bun runtime,
   with its own `package.json`, no shared deps with the host. The
   `mcpapps/` parent has no `package.json` of its own; each app is a
   leaf with its own install.

Future MCP apps the user wants to ship in-repo before extracting
follow the same pattern: `mcpapps/<name>/` with its own
`package.json`, `README.md`, src, tests.

### Phoenix Arize: telemetry/phoenix.ts + Control Panel tab

Three pieces:

- **`packages/librecode/src/telemetry/phoenix.ts`** — `initPhoenix()`
  constructs a `NodeTracerProvider` with an `OTLPTraceExporter`
  pointed at the configured endpoint, registers an
  `OpenInferenceSimpleSpanProcessor` so Vercel AI SDK spans get
  rewritten into the OpenInference semantic conventions Phoenix's
  LLM-specific UI keys off, plus a fallback `BatchSpanProcessor` for
  any non-LLM spans. Idempotent — same config = no-op, changed
  config = shutdown + reconfigure.

  `checkPhoenixHealth()` pings `/healthz` (derived from the
  `/v1/traces` endpoint) with a configurable timeout. Returns a
  structured result so the UI can render success / failure / latency
  without a try/catch on every call site. Never throws.

- **Config schema** — new `telemetry.phoenix` block in
  `librecode.jsonc`:

  ```jsonc
  {
    "telemetry": {
      "phoenix": {
        "enabled": true,
        "endpoint": "http://localhost:6006/v1/traces",
        "projectName": "librecode",
        "apiKey": "...", // optional, hosted Phoenix only
      },
    },
  }
  ```

  When `enabled: true`, the AI SDK call site flips
  `experimental_telemetry.isEnabled = true` so spans flow.

- **Control Panel "Telemetry" tab** — new tab in the existing
  settings dialog. Shows the saved config (endpoint, project,
  api-key-presence-only — never echoes the key) and exposes a "Test
  connection" button that calls `POST
/control-panel/telemetry/health-check` to probe Phoenix's
  `/healthz`. Live status indicator turns green on success, red on
  failure with the error message (HTTP status, ECONNREFUSED, etc.).

#### Why client-side rendering of `experimental_telemetry`, not a wrapper?

The Vercel AI SDK already emits OTel-shaped LLM spans natively when
you flip `experimental_telemetry.isEnabled = true`. Wrapping the AI
SDK to emit our own spans would duplicate that work and risk drift
when the AI SDK extends its conventions. Instead, we tap into the
existing OTel pipeline: AI SDK emits `gen_ai.*` spans → our globally-
registered `OpenInferenceSimpleSpanProcessor` rewrites them to
`llm.*` (OpenInference) attributes → exporter ships them.

#### Why is `initPhoenix` lazy-imported from llm.ts?

Cold-start cost. `@opentelemetry/sdk-trace-node` + the OTLP exporter

- OpenInference adapter is ~50-80 MB of dep trees. Users who don't
  enable Phoenix should never load it. The dynamic `import("../telemetry/phoenix")`
  inside `llmStream` only fires when `cfg.telemetry?.phoenix?.enabled`
  is true.

#### Read-only Telemetry tab in v0.9.76

Same v0.9.74 read-only-first reasoning: editing the config still
happens in `librecode.jsonc`; the UI surfaces what's currently set
and exposes one action (test connection). Inline editing of
endpoint / project name / api key is v0.9.77+ once we know which
fields actually need a UI form vs. text-edit-config.

## Non-goals

- **No Multica websocket subscription.** v0.9.76 ships REST-only
  tools. Realtime kanban updates come from Multica's own UI inside
  the iframe; LibreCode pushes via REST and trusts Multica's UI to
  fan out the changes.
- **No automatic agent-activity → Multica mirroring.** The user has
  to explicitly call the tools (or build a session-mirror plugin
  that does). Auto-mirroring is a v0.10+ conversation once we know
  the right granularity (every tool call? every step-finish? per
  session?).
- **No host-side OTel-pipeline wiring for non-AI-SDK spans.** Phoenix
  only sees what flows through `experimental_telemetry`. Adding
  custom spans for permission-grant, MCP-tool-call, etc. is a v0.9.77+
  addition once the basic pipeline is proven.

## Architecture

```
mcpapps/multica/
├── package.json          # standalone — no @librecode/* imports
├── README.md             # how to wire to LibreCode via `mcp add`
├── src/
│   ├── index.ts          # bun entrypoint, stdio bootstrap
│   ├── multica/client.ts # typed REST + healthz
│   ├── mcp/server.ts     # MCP server factory + env config
│   ├── mcp/tools.ts      # 3 tools, pure result formatting
│   └── web/board.html    # iframe-of-Multica-UI ui:// resource
└── test/
    ├── client.test.ts    # 18 tests (REST + headers + errors)
    └── server.test.ts    # 12 tests (config, render, tool wrappers)

packages/librecode/src/
├── telemetry/phoenix.ts  # initPhoenix + checkPhoenixHealth + tests
├── config/schema.ts      # +telemetry.phoenix.{enabled,endpoint,projectName,apiKey}
├── session/llm.ts        # lazy-init Phoenix + flip experimental_telemetry
└── server/routes/
    └── control-panel.ts  # +/telemetry (read), +/telemetry/health-check (POST)

packages/app/src/components/
├── settings-control-panel.tsx        # +<SettingsTelemetry />
├── settings-control-panel-client.ts  # +fetchTelemetryConfig, checkPhoenixHealth, formatLatency
└── dialog-settings.tsx               # +Telemetry tab (icon: status-active)
```

## Consequences

**Good:**

- LibreCode now has a working observability story. Phoenix renders
  every prompt + response side-by-side, eval scores, token-cost
  rollups — all through a daemon the user already trusts.
- Multica MCP app is the first ecosystem-grade reference for
  third-party MCP apps that want to live alongside LibreCode.
  The pattern (standalone `package.json`, env-driven config,
  iframe ui:// resource + tools) is documented in the README and
  ready for extraction.
- Both integrations are zero-cost when off — Phoenix deps lazy-
  import, Multica MCP server doesn't run unless the user adds it
  via `librecode mcp add`.

**Bad:**

- ~50-80 MB of OTel deps land in the host package, even though
  they're lazy-imported. Bun install / cold-cache release builds
  pay the bandwidth.
- Multica's frontend wasn't designed for iframe embedding. Multica's
  CSP needs an `ALLOWED_ORIGINS` tweak for production embeds. Local
  dev works without it.
- The "Test connection" button on the Telemetry tab proves Phoenix
  is reachable, not that LibreCode's spans are actually arriving.
  A v0.9.77 round-trip test (send a test span, query Phoenix's
  trace API to confirm it landed) would close the loop.

**Neutral:**

- Multica's modified Apache 2.0 license restricts redistribution as
  a commercial product. Our MCP app **connects to** Multica via
  public REST + iframes its already-running web UI; we don't
  redistribute Multica source. Self-hosters' own redistribution
  obligations are theirs to track. README documents this.

## Test coverage at launch

| Area               | Tests  | What's covered                                    |
| ------------------ | ------ | ------------------------------------------------- |
| Multica client     | 18     | All 4 REST methods, headers, errors, URL encoding |
| Multica MCP server | 12     | Env loading, board.html rendering, tool wrappers  |
| Phoenix telemetry  | 11     | `healthzUrlFor` URL math, healthz fetch + timeout |
| **Total**          | **41** | All pass; typecheck clean; prettier clean         |
