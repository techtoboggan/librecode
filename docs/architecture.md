# LibreCode Architecture

> Technical reference for contributors. See [CLAUDE.md](/CLAUDE.md) for coding standards
> and [PLAN.md](/PLAN.md) for the roadmap.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│ CLI (packages/opencode)                                  │
│                                                          │
│   User Input ──► Agent Loop ──► LLM Provider             │
│                    │    ▲                                 │
│                    │    │                                 │
│                    ▼    │                                 │
│                 Tool System ──► MCP Servers               │
│                    │                                      │
│                    ▼                                      │
│             Permission System                             │
│                    │                                      │
│                    ▼                                      │
│              Storage (SQLite)                             │
└─────────────────────────────────────────────────────────┘
│ Desktop (packages/desktop) — Tauri + Solid.js UI          │
│ App (packages/app) — Shared UI shell                      │
│ UI (packages/ui) — Component library                      │
└───────────────────────────────────────────────────────────┘
```

---

## Agent Loop

> ADR-003 · Implemented in `session/agent-loop.ts` + `session/prompt.ts`

The agent loop processes user messages through an explicit state machine:

```
INITIALIZE → ROUTE → { SUBTASK | COMPACTION | PROCESS } → ... → EXIT
```

### States

| State | What happens |
|-------|-------------|
| **INITIALIZE** | Load message history, find latest user/assistant, validate model |
| **ROUTE** | Check for pending subtasks or compaction, decide next state |
| **SUBTASK** | Execute a delegated task via TaskTool (spawns sub-agent) |
| **COMPACTION** | Compress history when context window is full |
| **PROCESS** | Build system prompt, resolve tools, call LLM, stream response |
| **EXIT** | Prune old outputs, return final message |

### Exit Reasons

| Reason | Trigger |
|--------|---------|
| `complete` | Model finished naturally (no more tool calls) |
| `abort` | User cancelled |
| `error` | Unrecoverable API error |
| `structured_output` | JSON schema result captured |
| `compaction_failed` | Context still too large after compaction |
| `blocked` | Permission denied |
| `max_steps` | Step limit reached |

### Modules

| Module | Role |
|--------|------|
| `session/prompt.ts` | Main loop orchestrator, tool resolution, user message creation |
| `session/processor.ts` | LLM streaming, tool execution, retry logic |
| `session/compaction.ts` | Context overflow detection, history summarization |
| `session/agent-loop.ts` | State types, tracker, transition events |
| `session/llm.ts` | AI SDK integration, model call |

---

## Provider System

> ADR-001 · Implemented in `provider/`

### Architecture

```
models.dev database ──► Provider registry ──► SDK instantiation ──► LLM call
                              ▲
                              │
              Custom loaders (provider/loaders/)
              Plugin auth hooks
              Config overrides
```

### Provider Plugin API (`provider/plugin-api.ts`)

New providers implement the `ProviderPlugin` interface:

```typescript
interface ProviderPlugin {
  id: string
  sdk?: string  // @ai-sdk/* package name
  load(provider: ProviderInfo): Promise<ProviderLoadResult>
  getModel?(sdk, modelID, options): Promise<LanguageModelV2>
  vars?(options): Record<string, string>
}
```

### Built-in Loaders (`provider/loaders/`)

| Category | Providers |
|----------|-----------|
| **Simple** (headers only) | Anthropic, OpenRouter, Vercel, Zenmux, Cerebras, Kilo |
| **OpenAI-compatible** | OpenAI, GitHub Copilot, Azure, Azure Cognitive Services |
| **Cloud platforms** | Amazon Bedrock, Google Vertex, Google Vertex Anthropic, SAP AI Core, Cloudflare Workers AI, Cloudflare AI Gateway |
| **Platform-specific** | LibreCode built-in, GitLab Duo |

### Provider Lifecycle

1. **Discovery**: Load from models.dev snapshot + user config
2. **Loading**: Run custom loader → returns `{ autoload, options, getModel, vars }`
3. **SDK creation**: Instantiate `@ai-sdk/*` package with loader options
4. **Model resolution**: `getModel(sdk, modelID)` → `LanguageModelV2`
5. **Caching**: SDK instances cached by `hash(providerID, npm, options)`

---

## Tool System

> Implemented in `tool/`

### Tool Definition

Tools are defined via `Tool.define(id, init)`:

```typescript
Tool.define("grep", {
  description: "Search file contents",
  parameters: z.object({ pattern: z.string(), path: z.string().optional() }),
  async execute(args, ctx) {
    return { title: "Searched files", output: results, metadata: { matches } }
  },
})
```

### Tool Capabilities (`tool/capabilities.ts`)

Every tool declares what it can do:

```typescript
interface ToolCapabilities {
  reads: ReadableResource[]    // filesystem, network, process, database, clipboard
  writes: WritableResource[]   // filesystem, network, process, git, ...
  sideEffects: boolean
  executesCode?: boolean
  risk?: "low" | "medium" | "high"
}
```

Pre-defined profiles: `fileReader`, `fileWriter`, `shellExecutor`, `networkReader`, `pure`

### Tool Capability Registry (`tool/capability-registry.ts`)

All 23 built-in tools are annotated:

| Risk | Tools |
|------|-------|
| **Low** | read, glob, list, grep, codesearch, webfetch, websearch, plan_enter, plan_exit, question, todowrite, todoread |
| **Medium** | edit, write, multiedit, apply_patch, batch |
| **High** | bash, task, skill |

### Tool Telemetry (`tool/telemetry.ts`)

`withTelemetry()` wrapper captures per-execution metrics:
- Timing (duration in ms)
- Input/output size
- Truncation status
- Risk level
- Success/error

Emitted via `ToolExecutionEvent` Bus event.

---

## Permission System

> Implemented in `permission/`

### Rule Evaluation

Permissions use wildcard pattern matching with last-match-wins semantics:

```typescript
evaluate(permission, pattern, ...rulesets): Rule
// Returns: { action: "allow" | "deny" | "ask", permission, pattern }
```

### Rule Sources (merged in order)

1. **Agent defaults** — hardcoded base rules (e.g., `* = allow`, `doom_loop = ask`)
2. **User config** — `librecode.json` permission section
3. **Agent overrides** — per-agent permission modifications
4. **Session overrides** — transient per-session rules

### Audit Logging (`permission/audit.ts`)

All permission decisions are logged with:
- Tool capabilities (risk, reads/writes, sideEffects)
- Decision type (asked, auto_approved, replied, denied)
- Patterns matched
- Reply type (once, always, reject)

### Capability Integration

`PermissionNext.capabilityInfo(permission)` returns risk level and capability
breakdown for a tool, enabling smarter permission prompts.

---

## Instruction System

> Implemented in `session/instruction-compiler.ts`

### Priority Tiers

| Tier | Priority | Source |
|------|----------|--------|
| **system** | 100 | Provider-specific base prompt |
| **format** | 90 | Structured output instructions |
| **agent** | 80 | Agent skills, mode |
| **project** | 60 | CLAUDE.md, AGENTS.md, .librecode/ |
| **user** | 40 | ~/.config/librecode/ |
| **contextual** | 20 | Dynamically loaded from file reads |

### Features

- **Source tracking**: Every instruction records where it came from
- **Dual deduplication**: By content (exact match) AND by source path
- **Token budgeting**: Per-tier and total limits, lowest-priority dropped first
- **Debug output**: `formatCompiled()` shows all sections with token counts

---

## MCP Server Management

> Implemented in `mcp/`

### Server Types

| Type | Transport | Config |
|------|-----------|--------|
| **Local** | stdio (subprocess) | `command: ["npx", "server"]` |
| **Remote** | StreamableHTTP → SSE fallback | `url: "https://..."` |

### Health Monitoring (`mcp/health.ts`)

- Periodic ping via `listTools()`
- Auto-reconnect with exponential backoff (5s → 10s → 20s → 40s → 80s)
- Status tracking: healthy / unhealthy / reconnecting
- Events: check_failed, recovered, reconnected, reconnect_failed

### Error Diagnostics (`mcp/diagnostics.ts`)

Categorizes errors with actionable suggestions:

| Category | Examples |
|----------|---------|
| **auth** | 401, OAuth failures, dynamic registration |
| **connection** | ECONNREFUSED, network issues |
| **timeout** | Slow server startup |
| **process** | ENOENT (command not found), EACCES |
| **protocol** | Invalid JSON, method not found |
| **config** | Invalid URL, bad config |

---

## Session Management

### Export (`session/export.ts`)

Versioned JSON format (v1) containing session metadata, messages, and parts.

```typescript
const json = await exportSessionJSON(sessionID)
```

### Branching (`session/branch.ts`)

Fork a session at any message point:

```typescript
const result = await fork({
  sessionID: "original",
  atMessageID: "msg_123",  // optional cutoff
  title: "Alternative approach",
})
```

Features:
- ID remapping (new MessageIDs/PartIDs, parentID references updated)
- Branch listing: `branches(sessionID)`
- Ancestry tree: `ancestry(sessionID)` returns root→leaf path

---

## Storage

SQLite via Drizzle ORM (`storage/`).

| Table | Purpose |
|-------|---------|
| SessionTable | Session metadata, title, permissions, summary |
| MessageTable | Conversation turns (JSON data column) |
| PartTable | Message content pieces (JSON data column) |
| TodoTable | Session-scoped task items |
| PermissionTable | Per-project permission rules |
| AccountTable | Cloud account credentials |
| ProjectTable | Project directory tracking |

Migrations in `migration/` directories (YYYYMMDDHHMMSS format).

---

## Package Structure

```
packages/
  opencode/     Core CLI agent
    src/
      agent/      Agent definitions and registry
      cli/        CLI commands (yargs)
      config/     Configuration loading
      mcp/        MCP server client + health + diagnostics
      permission/ Permission system + audit logging
      provider/   LLM providers + loaders + plugin API
      session/    Agent loop + processor + instruction compiler + export + branching
      storage/    SQLite + Drizzle ORM
      tool/       Tool definitions + capabilities + telemetry
    test/         Unit tests (mirrors src/)
    script/       Build + publish scripts
    migration/    Drizzle SQL migrations
  desktop/      Tauri desktop app (Rust + Solid.js)
  app/          Shared UI application
  ui/           Component library (Solid.js + Tailwind)
  sdk/          TypeScript SDK
  util/         Shared utilities
  plugin/       Plugin system types
  script/       Monorepo build tooling
```
