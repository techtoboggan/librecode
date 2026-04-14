# LibreCode Roadmap

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Local-first AI coding agent with clean architecture and community provider ecosystem.
> Last updated: 2026-04-13 | ~184 commits | Tests: 1385 pass, 0 fail | v0.3.11

---

## Completed Work

### Phase 0: Foundation ✅

- GitHub Actions: 6 workflows (ci, build, release, desktop, nix, copr)
- Linux packaging: RPM/COPR, PKGBUILD/AUR, Nix flake
- Full rebrand: 377+ files, @opencode-ai → @librecode

### Phase 1: Build System ✅

- Dead deps stripped, build scripts decomposed
- Lock file clean (bun 1.3.11), test infrastructure (11 new test files)

### Phase 2: Core Architecture ✅

- Effect-ts fully removed (ADR-001). All 5 services → plain async.
- 4 namespace → barrel export migrations (MessageV2, Provider, Session, SessionPrompt)
- Provider plugin API (`ProviderPlugin` interface, `defineProvider()`, 6 loader files)
- Tool capabilities system (23 tools annotated, `ToolProfiles`, telemetry)
- Storage cleanup (ADR-002, 1,400 lines of dead JSON migration removed)

### Phase 3: Agentic SDLC ✅

- Agent loop formalized (ADR-003, state machine, 13 tests)
- Instruction compiler (6 priority tiers, source tracking, token budgets, 16 tests)
- Permission hardening (audit logging, capability-enriched requests)
- Session export/branch (versioned JSON, fork with ID remapping)
- MCP health monitor (auto-reconnect, exponential backoff, error diagnostics, 19 tests)

### Phase 4: Desktop & UI ✅

- Desktop packaging (AppStream, Flatpak manifest)
- Wayland taskbar icon fixed
- E2E test identifiers rebranded
- Desktop dev verified on Fedora 44

### Phase 5: Documentation ✅

- CLAUDE.md with coding standards, migration playbooks, quality gates
- Architecture docs, development guide, quality baseline
- ADR-001 through ADR-004
- Brand system (tokens, DESIGN-SPEC.md, site scaffolds)

### Phase 6: Provider System ✅

- Removed hosted "librecode" provider (Zen/Go subscriptions, free models, public key)
- Provider auth prompts extension (ADR-004): URL + API key + connection validation
- LiteLLM as first-class provider with auth plugin
- Ollama as first-class provider
- Local Server Discovery wizard: TCP port check, multi-endpoint probe (/v1/models + /api/tags), always visible in all dialogs, targeted remote host probing
- Local-first UI overhaul: popularProviders = [litellm, ollama, bedrock, azure], cloud providers deprioritized, "paid" concept removed

### Phase 7: npm & Community Ecosystem ✅

- `@librecode/sdk@0.1.7` published to npm (with sigstore provenance)
- `@librecode/plugin@0.1.7` published to npm (zod: `^4.1.8` — catalog: dep resolved from bun.lock)
- npm org `@librecode` created (techtoboggan)
- `~/Projects/librecode-3rdparty-providers` monorepo scaffolded (provider-anthropic, provider-openai, provider-openrouter, provider-bundle)
- GitHub Actions npm-publish.yml in both repos: NPM_TOKEN auth, sigstore provenance, catalog: dep resolution via bun.lock parsing
- `docs/providers.md` — comprehensive guide for adding new providers
- `.claude/skills/add-provider` — Claude Code skill for adding providers
- 3rdparty repo: `@librecode/provider-{anthropic,openai,openrouter,bundle}@0.1.4` published to npm

### Phase 8: Provider System Cleanup ✅

- `BUILTIN = []` — removed broken `librecode-anthropic-auth@0.0.13` npm reference
  - Generic auth fallback in `dialog-connect-provider.tsx` handles all simple API key providers
  - `loadApiKeyProviders()` generically injects stored keys for all providers
  - No BUILTIN npm plugins needed for Anthropic/OpenAI/etc.
- Ollama provider icon added to sprite sheet
- npm-publish.yml in both repos fixed: NPM_TOKEN auth, catalog: dep resolution, repository.url for provenance

---

## v0.1.0 ✅ SHIPPED

All MVP blockers resolved. npm ecosystem fully published with provenance.

| Item                                         | Status   |
| -------------------------------------------- | -------- |
| Remove stale "librecode" provider refs       | ✅       |
| Fix failing test (bun install timeout)       | ✅       |
| Stale i18n strings                           | ✅ clean |
| First-run experience (empty state hints)     | ✅       |
| Model selector context-sensitive empty state | ✅       |
| npm auth + all 6 packages published          | ✅       |
| README update                                | ✅       |

---

## v0.1.x Fast-follows ✅

### Phase 9: Ollama Auth + Wizard Cleanup ✅

| Item                                            | Description                                                                                                                    | Effort | Status  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- |
| **OllamaAuthPlugin**                            | Already exists and complete in `packages/librecode/src/plugin/ollama.ts` — URL prompt, connection validation, model injection. | Medium | ✅ Done |
| **Rename litellm-wizard → local-server-wizard** | Renamed to `LocalServerWizard`, provider IDs changed from `litellm-<url>` → `local-<url>`.                                     | Small  | ✅ Done |

### Code Quality Cleanup ✅

**Complexity target achieved:** 0 violations. Every function under complexity 12.
**File size target achieved:** 0 source files over 1000 lines.

- 18 files split into focused modules (session/prompt, lsp/server, acp/agent, github, config, etc.)
- 1385/1385 tests pass.

### Phase 10: Bug Fixes + Security Hardening ✅

| Item                                 | File                              | Status  |
| ------------------------------------ | --------------------------------- | ------- |
| **Rust unused imports**              | `desktop/src-tauri/src/lib.rs`    | ✅ Done |
| **GTK main thread panic**            | `windows.rs:set_window_icon()`    | ✅ Done |
| **Dev channel plugin version**       | `config.ts:installDependencies()` | ✅ Done |
| **npm package name injection**       | `plugin/index.ts`                 | ✅ Done |
| **SSRF in /provider/scan**           | `routes/provider.ts`              | ✅ Done |
| **console.log → structured logging** | `routes/provider.ts`              | ✅ Done |
| **Partial access token in logs**     | `mcp/helpers.ts`                  | ✅ Done |

---

## v0.2.0 ✅ SHIPPED

All v0.2.0 items complete. 1385 tests pass, 0 complexity violations, 0 source files over 1000 lines.

| Item                                                                        | Status |
| --------------------------------------------------------------------------- | ------ |
| AppImage packaging                                                          | ✅     |
| Structured credential storage (`provider_credentials` table)                | ✅     |
| Provider capability detection (`detectCapabilitiesFromId`)                  | ✅     |
| Flatpak manifest scaffold (`com.librecode.desktop.yml`)                     | ✅     |
| Local server wizard: removed from manage-models, collapsed in add-providers | ✅     |
| Code quality: 0 complexity violations, 0 source files over 1000 lines       | ✅     |

---

### Phase 11: i18n Extraction ✅

| Item                              | Description                                                                             | Status       |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| **`@librecode/i18n` npm package** | New repo `techtoboggan/librecode-i18n`, 3 sub-paths (app/ui/desktop), 17 locales        | ✅ Published |
| **Monorepo migration**            | Removed 19,037 lines of duplicated locale files from app/ui/desktop packages            | ✅ Done      |
| **CI publish**                    | `npm-publish.yml` publishes `@librecode/i18n` on every `v*` tag from main repo workflow | ✅ Done      |

### Phase 12: Brand Assets ✅

| Item                    | Description                                                                                                       | Status  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ------- |
| **LC monogram SVG**     | Hand-coded stroke-based LC letterforms, teal→navy gradient, intertwining C/L paths                                | ✅ Done |
| **Full logo lockups**   | `logo-full-light.svg` + `logo-full-dark.svg` (480×268 viewBox, wordmark + tagline)                                | ✅ Done |
| **Mark variants**       | `mark-dark.svg`, `mark-light.svg`, `mark-transparent.svg` (180×180, rounded rect)                                 | ✅ Done |
| **PNG export pipeline** | `scripts/generate-brand.ts` (cairosvg+PIL) — 42 PNGs: logo, marks, favicons, Tater, OG images                     | ✅ Done |
| **Favicon set**         | favicon-16/32/48/192/512.png, apple-touch-icon.png, favicon.ico (ImageMagick composite)                           | ✅ Done |
| **Tauri app icons**     | Replaced all opencode placeholders in icons/dev+beta+prod with LC mark (32–512px + Windows Store)                 | ✅ Done |
| **Tater mascot**        | Winged capuchin monkey, golden amber fur, brand-gradient wings, kawaii potato — dark/light/transparent SVG + PNGs | ✅ Done |

---

## v0.3.x Roadmap

### Phase 13: Zero Lint Warnings ✅

| Item                                          | Description                                                                              | Status  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | ------- |
| **1,933 → 0 lint warnings**                   | All `noExplicitAny`, `noNonNullAssertion`, `noNamespace`, and 13 other rules eliminated  | ✅ Done |
| **TypeScript dynamic import fix**             | `models-snapshot` gitignored file — variable path trick prevents CI typecheck failure    | ✅ Done |
| **COPR CI fix**                               | `grep -v src` was filtering built RPM (path contained "src-tauri") → `grep -v '\.src\.rpm'` | ✅ Done |
| **pip3 Ubuntu 24.04 fix**                     | Added `--break-system-packages` for Python 3.12 externally-managed-environment           | ✅ Done |

### Phase 14: Security & Stability ✅

| Item                                    | Description                                                                                                       | Status  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------- |
| **Symlink escape fix**                  | `Filesystem.containsSafe()` uses `realpath` before comparison; `Instance.containsPath()` updated                 | ✅ Done |
| **Windows cross-drive bypass**          | Same `realpathSync` fix normalises drive letters on Windows                                                       | ✅ Done |
| **Linux auto-update disabled**          | CLI returns early on `process.platform === "linux"`; Tauri `UPDATER_ENABLED` gated on `!cfg!(target_os = "linux")` | ✅ Done |
| **Dead code removed**                   | `TodoReadTool` (definition + registry comment), `PlanEnterTool` (commented-out block) deleted                     | ✅ Done |
| **Node.js 20 → 24 in CI**              | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` added to all 7 workflows                                               | ✅ Done |

---

## v0.4 Roadmap — MCP Apps (Development Operating System)

### Phase 15: MCP Apps Host — Protocol Layer

**Context:** MCP Apps is an official protocol extension (`io.modelcontextprotocol/ui`, SEP-1865), live since Jan 2026. Ships in Claude Desktop, VS Code Copilot, Cursor. LibreCode must implement the **host** side. MCP servers expose a `ui://` resource with `mimeType: "text/html;profile=mcp-app"`. Host fetches it, renders in sandboxed iframe, communicates via JSON-RPC 2.0 over `postMessage`.

| Item | Description | Files | Effort |
| ---- | ----------- | ----- | ------ |
| **Declare `ui` capability** | Add `io.modelcontextprotocol/ui` + `elicitation` to `Client` init capabilities | `src/mcp/index.ts` | Tiny |
| **`MCP.uiResources()`** | Filter `listResources()` to `text/html;profile=mcp-app` mime type | `src/mcp/index.ts` | Small |
| **`MCP.fetchAppHtml()`** | Call `readResource` on `ui://` URI, return HTML string | `src/mcp/index.ts` | Small |
| **Tool visibility filter** | Skip tools with `visibility: ["app"]` (no `"model"`) from agent tool list | `src/mcp/index.ts` | Small |
| **`mcp.app.*` bus events** | `mcp.app.registered`, `mcp.app.tool_called` for routing UI tool calls | `src/bus/` | Small |
| **Elicitation handler** | Handle `elicitation/create` from server — render form dialog in TUI + app | `src/mcp/index.ts`, dialogs | Medium |

### Phase 16: MCP Apps Host — Desktop Rendering

| Item | Description | Files | Effort |
| ---- | ----------- | ----- | ------ |
| **`McpAppPanel` component** | Sandboxed `<iframe srcdoc=...>` + full postMessage host (`ui/initialize`, `tools/call` proxy, `ui/message`, size tracking) | `packages/app/src/components/mcp-app-panel.tsx` (new) | Large |
| **CSP injection** | Inject `<meta http-equiv="Content-Security-Policy">` from `_meta.ui.csp` before iframe render; required since WebkitGTK can't intercept iframe headers | `McpAppPanel` | Medium |
| **Host context / theme tokens** | Pass LibreCode theme CSS variables as `styles.variables` in `HostContext` so apps inherit the active theme | `McpAppPanel` | Small |
| **Inline tool-result rendering** | When tool result has `_meta.ui.resourceUri`, replace text block with `McpAppPanel` | `packages/app/src/components/session/` | Medium |
| **`@modelcontextprotocol/ext-apps` dep** | Add to `packages/app` and `packages/librecode` — provides `AppBridge` and `PostMessageTransport` | `package.json` | Tiny |

### Phase 17: MCP Apps — Persistent Side Panel + Activity Visualization

| Item | Description | Files | Effort |
| ---- | ----------- | ----- | ------ |
| **Pinnable MCP Apps panel** | Persistent side panel tab for MCP servers with `listResources` `ui://` entries not tied to a tool call | `packages/app/src/pages/layout/sidebar-panel.tsx` | Medium |
| **Activity tracker** | `ActivityTracker` module — maps file paths and agents to real-time activity state from bus events | `src/session/activity-tracker.ts` (new) | Medium |
| **Activity panel (desktop)** | Canvas-based grid: each cell = a file, colored by read/write/search/error/idle, agent status bar for parallel sub-agents | `packages/app/src/components/activity-grid.tsx` (new) | Large |
| **Activity view (TUI)** | Character-cell grid toggle via `<leader>a`, agent status line, truecolor cells | `src/cli/cmd/tui/routes/session/activity.tsx` (new) | Large |
| **Port preview panel** | `<iframe src="http://localhost:PORT">` for running project services; detect ports from bash tool child processes | sidebar | Medium |

### Nice to Have

| Item                   | Description                                                                                                                 | Effort | Priority |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| **Flatpak full build** | SHA256 hashes filled (Bun x64/aarch64 + v0.1.0 tarball); cargo-sources.json generated (1,379 Cargo deps); manifest complete | Medium | ✅ Done  |
| **Turbo evaluation**   | Keep Turbo. Cold run: 40.5s · Warm (cache hit): 272ms = **149× speedup**. Already integrated at zero cost.                  | Small  | ✅ Done  |

---

## Project Stats

| Metric                       | Value                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Total commits                | ~184                                                                                                       |
| Tests passing                | 1,385                                                                                                      |
| Tests failing                | 0                                                                                                          |
| Test files                   | 113                                                                                                        |
| Complexity violations        | 0                                                                                                          |
| Source files over 1000 lines | 0                                                                                                          |
| Lint warnings total          | 0 (down from 1,933)                                                                                        |
| ADRs                         | 4 (Effect-ts, Storage, Agent Loop, Auth Prompts)                                                           |
| npm packages                 | 7 published (sdk, plugin, provider-anthropic, provider-openai, provider-openrouter, provider-bundle, i18n) |
| Sister repos                 | librecode-3rdparty-providers, librecode-i18n                                                               |
| Core providers               | LiteLLM, Ollama, Amazon Bedrock, Azure                                                                     |
