# LibreCode Roadmap

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Local-first AI coding agent with clean architecture and community provider ecosystem.
> Last updated: 2026-05-26 | ~465 commits | Tests: 2872 pass, 13 skip, 0 flaky | **v0.10.0** (Phase 52 — Testing Architecture Overhaul shipped)
>
> **Release track:** staying on `0.9.x` patch tags until real beta testing validates the product end-to-end. No `1.0.0-preview.x` tags yet. Phase 29 closed all 7 high + 7 medium OWASP findings. Phases 30–35 shipped Tauri/desktop hardening, full MCP-Apps host, Activity Graph + Session Stats polish, native MCP CLI, Agentic Control Panel, and Multica/Phoenix integrations.

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

| Item                              | Description                                                                                 | Status  |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ------- |
| **1,933 → 0 lint warnings**       | All `noExplicitAny`, `noNonNullAssertion`, `noNamespace`, and 13 other rules eliminated     | ✅ Done |
| **TypeScript dynamic import fix** | `models-snapshot` gitignored file — variable path trick prevents CI typecheck failure       | ✅ Done |
| **COPR CI fix**                   | `grep -v src` was filtering built RPM (path contained "src-tauri") → `grep -v '\.src\.rpm'` | ✅ Done |
| **pip3 Ubuntu 24.04 fix**         | Added `--break-system-packages` for Python 3.12 externally-managed-environment              | ✅ Done |

### Phase 14: Security & Stability ✅

| Item                           | Description                                                                                                        | Status  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------- |
| **Symlink escape fix**         | `Filesystem.containsSafe()` uses `realpath` before comparison; `Instance.containsPath()` updated                   | ✅ Done |
| **Windows cross-drive bypass** | Same `realpathSync` fix normalises drive letters on Windows                                                        | ✅ Done |
| **Linux auto-update disabled** | CLI returns early on `process.platform === "linux"`; Tauri `UPDATER_ENABLED` gated on `!cfg!(target_os = "linux")` | ✅ Done |
| **Dead code removed**          | `TodoReadTool` (definition + registry comment), `PlanEnterTool` (commented-out block) deleted                      | ✅ Done |
| **Node.js 20 → 24 in CI**      | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` added to all 7 workflows                                                | ✅ Done |

---

## v0.4 Roadmap — MCP Apps (Development Operating System)

### Phase 15: MCP Apps Host — Protocol Layer ✅

**Context:** MCP Apps is an official protocol extension (`io.modelcontextprotocol/ui`, SEP-1865), live since Jan 2026. Ships in Claude Desktop, VS Code Copilot, Cursor. LibreCode must implement the **host** side. MCP servers expose a `ui://` resource with `mimeType: "text/html;profile=mcp-app"`. Host fetches it, renders in sandboxed iframe, communicates via JSON-RPC 2.0 over `postMessage`.

| Item                                     | Description                                                                                                                                           | Files                   | Effort | Status |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------ | ------ |
| **`@modelcontextprotocol/ext-apps` dep** | Added to `packages/librecode` — provides `getToolUiResourceUri`, `isToolVisibilityAppOnly`, `RESOURCE_MIME_TYPE`, `AppBridge`, `PostMessageTransport` | `package.json`          | Tiny   | ✅     |
| **`MCP.uiResources()`**                  | Filters `resources()` to `mimeType === "text/html;profile=mcp-app"`                                                                                   | `src/mcp/index.ts`      | Small  | ✅     |
| **`MCP.fetchAppHtml()`**                 | Calls `readResource` on `ui://` URI, extracts HTML text with type-safe content union narrowing                                                        | `src/mcp/index.ts`      | Small  | ✅     |
| **`MCP.getAppResourceUri()`**            | Wraps `getToolUiResourceUri()` — supports both modern `_meta.ui.resourceUri` and legacy `_meta["ui/resourceUri"]` formats                             | `src/mcp/index.ts`      | Small  | ✅     |
| **Tool visibility filter**               | `isToolVisibilityAppOnly()` skips app-only tools from agent tool list in `tools()`                                                                    | `src/mcp/index.ts`      | Small  | ✅     |
| **`mcp.app.*` bus events**               | `mcp.app.registered`, `mcp.app.tool_called` added to `MCP` barrel export                                                                              | `src/mcp/index.ts`      | Small  | ✅     |
| **15 protocol-layer tests**              | Tests for `getToolUiResourceUri`, `isToolVisibilityAppOnly`, `uiResources`, `fetchAppHtml`, `getAppResourceUri`, bus events                           | `test/mcp/apps.test.ts` | Small  | ✅     |

### Phase 16: MCP Apps Host — Desktop Rendering ✅

| Item                                 | Description                                                                                                                   | Files                                                 | Effort | Status |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ | ------ |
| **`McpAppPanel` component**          | Sandboxed `<iframe srcdoc=...>` + `AppBridge` + `PostMessageTransport`; CSP injection; auto-app-picker for multi-app servers  | `packages/app/src/components/mcp-app-panel.tsx` (new) | Large  | ✅     |
| **CSP injection**                    | `injectCsp()` inserts `<meta http-equiv="Content-Security-Policy">` into `<head>` before iframe render (WebkitGTK workaround) | `mcp-app-panel.tsx`                                   | Medium | ✅     |
| **`sandbox="allow-scripts"`**        | Null-origin sandbox — app can't access host cookies/localStorage; postMessage bridge works regardless                         | `mcp-app-panel.tsx`                                   | Small  | ✅     |
| **`GET /mcp/apps` endpoint**         | Lists all `ui://` resources across connected clients                                                                          | `routes/mcp.ts`                                       | Small  | ✅     |
| **`GET /mcp/apps/html` endpoint**    | Fetches HTML for a specific UI resource by server + URI                                                                       | `routes/mcp.ts`                                       | Small  | ✅     |
| **`McpAppsTab` component**           | Side-panel tab: app list → picker → renders `McpAppPanel`; empty state when no apps                                           | `mcp-app-panel.tsx`                                   | Medium | ✅     |
| **"Apps" tab in session side panel** | New tab trigger + content pane in `SessionSidePanel`; `createSessionTabs` recognizes "apps"                                   | `session-side-panel.tsx`, `helpers.ts`                | Small  | ✅     |
| **`resourceUri` in tool metadata**   | `convertMcpTool()` now attaches `_meta.ui.resourceUri` to call results — ready for inline rendering                           | `src/mcp/index.ts`                                    | Small  | ✅     |
| **i18n: `session.tab.apps`**         | Added English key `"Apps"` to `librecode-i18n`                                                                                | `librecode-i18n/src/app/en.ts`                        | Tiny   | ✅     |

### Phase 17: Activity Visualization — Backend + Desktop Panel ✅

| Item                                     | Description                                                                                                                                                                                                    | Files                                                 | Effort | Status |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ | ------ |
| **`ActivityTracker` module**             | Subscribes to `message.part.updated`, `file.edited`, `agent.loop.transition` bus events; maintains `Map<sessionID, SessionActivity>` with per-file and per-agent state; publishes `activity.updated` bus event | `src/session/activity-tracker.ts` (new)               | Medium | ✅     |
| **Unsub cleanup**                        | `ActivityState` stores `unsubs: Array<() => void>`; cleanup iterates and calls all; prevents subscription leaks on instance dispose                                                                            | `activity-tracker.ts`                                 | Small  | ✅     |
| **`GET /session/:id/activity` endpoint** | Returns `SessionActivity` snapshot for the given session; seeds the frontend before live SSE events arrive                                                                                                     | `routes/session/actions.ts`                           | Small  | ✅     |
| **SSE auto-wiring**                      | `ActivityTracker.Updated` goes through `Bus.publish` → `GlobalBus.emit` → SSE stream → `global-sdk.tsx` emitter — no extra wiring needed                                                                       | `bus/index.ts` (existing pattern)                     | None   | ✅     |
| **`EventActivityUpdated` SDK type**      | Added `EventActivityUpdated`, `EventActivityFileEntry`, `EventActivityAgentEntry` to SDK types + `Event` union                                                                                                 | `packages/sdk/js/src/v2/gen/types.gen.ts`             | Small  | ✅     |
| **`ActivityTab` component**              | Fetches initial state via REST; subscribes to `activity.updated` SSE; renders agent status bar + file activity grid + legend                                                                                   | `packages/app/src/components/activity-grid.tsx` (new) | Large  | ✅     |
| **"Activity" tab in session side panel** | New tab trigger + content pane; `createSessionTabs` recognizes "activity"                                                                                                                                      | `session-side-panel.tsx`, `helpers.ts`                | Small  | ✅     |
| **i18n: `session.tab.activity`**         | Added English key `"Activity"`                                                                                                                                                                                 | `librecode-i18n/src/app/en.ts`                        | Tiny   | ✅     |

### Phase 18: opncd.ai Share Removal ✅

Removed the opncd.ai share feature entirely (not local-first, external dependency).

| Item                                         | Description                                                                                                  | Status  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| **`share-next.ts` + `share.sql.ts` deleted** | Core share module and SQL schema removed                                                                     | ✅ Done |
| **Migration `20260414000000_remove_share`**  | `DROP TABLE session_share; ALTER TABLE session DROP COLUMN share_url`                                        | ✅ Done |
| **Session `index.ts`**                       | Removed `share`/`unshare` functions, `share` field from `Info` schema                                        | ✅ Done |
| **Config schema**                            | Removed `share`, `autoshare` fields, `session_share`/`session_unshare` keybinds                              | ✅ Done |
| **REST API**                                 | Removed `POST/DELETE /:id/share` endpoints from `routes/session/actions.ts`                                  | ✅ Done |
| **SDK types**                                | Removed `SessionShare*`, `SessionUnshare*` types; removed `share` from `Session` and `Config`                | ✅ Done |
| **TUI commands**                             | Removed `/share` and `/unshare` command entries; removed `session.share` from TUI sidebar                    | ✅ Done |
| **`run.ts --share` flag**                    | Removed `--share` CLI flag and auto-share logic                                                              | ✅ Done |
| **`import.ts`**                              | Removed URL-based import path (opncd.ai share URLs); command now handles local JSON only                     | ✅ Done |
| **GitHub action**                            | Removed `resolveShareId`, `normalizeShare`, `shareId`/`shareBaseUrl` from `RunCtx`; simplified `buildFooter` | ✅ Done |
| **Frontend**                                 | Removed share popover + share state from `session-header.tsx` and `message-timeline.tsx`                     | ✅ Done |

---

### Phase 19: TUI Activity View ✅

| Item                           | Description                                                                                                                 | Files                                               | Effort | Status |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ | ------ |
| **`session_activity` keybind** | Added `<leader>v` (v = visualize) to `config/schema.ts` keybinds — `<leader>a` already taken by agent_list                  | `src/config/schema.ts`                              | Tiny   | ✅     |
| **`ActivityPanel` component**  | Absolute-positioned overlay panel: agent status bar, recent files grid with truecolor kind indicators, stats footer, legend | `src/cli/cmd/tui/routes/session/activity.tsx` (new) | Large  | ✅     |
| **Activity command**           | `session.activity.toggle` registered in `commands.tsx`; toggle title updates with current state                             | `routes/session/commands.tsx`                       | Small  | ✅     |
| **Panel wiring in Session**    | `activityOpen` signal in `index.tsx`; renders `<ActivityPanel>` overlay; passes toggle deps to `useSessionCommands`         | `routes/session/index.tsx`                          | Small  | ✅     |

---

### Phase 20: Coverage Push ✅ (partial)

Pushed coverage from 71.74% lines → **73.55% lines** (+1.81pp) and 58.30% functions → **60.23% functions** (+1.93pp). Added 199 new unit tests across 10 test files.

| File                                    | Before | After |
| --------------------------------------- | ------ | ----- |
| `src/session/activity-tracker.ts`       | 32%    | 98%   |
| `src/provider/error.ts`                 | 67%    | 97%   |
| `src/session/instruction.ts`            | 71%    | 83%   |
| `src/tool/invalid.ts`                   | 60%    | 100%  |
| `src/tool/registry.ts`                  | 57%    | 100%  |
| `src/session/summary.ts`                | 35%    | 75%   |
| `src/provider/transform-input.ts`       | 74%    | 100%  |
| `src/session/status.ts`                 | 70%    | 100%  |
| `src/config/config.ts`                  | 64%    | 78%   |
| `src/provider/loaders/litellm.ts`       | 44%    | 100%  |
| `src/provider/loaders/openai-compat.ts` | 56%    | 100%  |
| `src/provider/loaders/cloud.ts`         | 64%    | 72%   |

**Remaining gap to 80%**: Large integration files (`processor.ts` 4%, `prompt.ts` 13%, `prompt-builder.ts` 9%, `compaction.ts` 20%) require a full running agent + LLM to test and are not suitable for unit tests. Closing that gap requires BDD/E2E tests, not unit tests.

---

### Phase 21: MCP App Pinning + Port Preview Panel ✅

| Item                               | Description                                                                                                                                                 | Files                                                   | Effort | Status |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ | ------ |
| **`Bus.PortDiscovered` event**     | New `port.discovered` bus event (sessionID, port, url) wired through GlobalBus → SSE                                                                        | `src/bus/index.ts`                                      | Tiny   | ✅     |
| **Port detection in bash tool**    | `extractPorts()` regex scans each output chunk for localhost/loopback URL patterns; deduplicates per invocation via `Set`; publishes `PortDiscovered` event | `src/tool/bash.ts`                                      | Small  | ✅     |
| **`EventPortDiscovered` SDK type** | Added to `types.gen.ts` + `Event` union so frontend can receive typed SSE events                                                                            | `packages/sdk/js/src/v2/gen/types.gen.ts`               | Tiny   | ✅     |
| **MCP App pin button**             | Pin icon (📌) next to each app in `McpAppsTab` picker; filled when pinned; `McpAppsTab` accepts `onPin`/`onUnpin`/`pinnedUris` props                        | `packages/app/src/components/mcp-app-panel.tsx`         | Small  | ✅     |
| **Pinned app tabs in sidebar**     | `pinnedApps` signal in `SessionSidePanel`; each pinned app renders its own `Tabs.Trigger` + `Tabs.Content` with `<McpAppPanel>`; middle-click or ✕ unpins   | `packages/app/src/pages/session/session-side-panel.tsx` | Medium | ✅     |
| **`PortPreviewTab` component**     | `<iframe src="http://localhost:PORT">` with a URL bar showing `localhost:PORT ↗` external link                                                             | `packages/app/src/components/port-preview.tsx` (new)    | Small  | ✅     |
| **Port preview tabs in sidebar**   | `discoveredPorts` signal + SSE subscription; each port gets a monospace `:{port}` tab; middle-click or ✕ dismisses                                          | `packages/app/src/pages/session/session-side-panel.tsx` | Small  | ✅     |
| **Unit tests for port detection**  | 17 tests covering all regex patterns, edge cases, privilege port rejection, empty input                                                                     | `test/tool/bash-port-detection.test.ts` (new)           | Small  | ✅     |

### Phase 22: v1.0.0-preview.1 Release Prep ✅

Shipped the v1.0 preview: version alignment across all three repos, release metadata, distribution infrastructure push, and dependent-repo lockstep.

| Item                                       | Description                                                                                                                                     | Files                                                                                | Status |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| **Blocking: broken GH Action ref**         | `anomalyco/librecode/github@latest` → `techtoboggan/librecode/github@latest`                                                                    | `cli/cmd/github/install.ts:236`                                                      | ✅     |
| **Blocking: Homebrew/GitHub refs**         | Installation module + docker tip referenced wrong org                                                                                           | `installation/index.ts`, `cli/cmd/tui/component/tips.tsx`                            | ✅     |
| **Agent prompt rebrand**                   | All 8 system prompts identified the agent as "OpenCode" — rebranded to LibreCode, URLs updated                                                  | `session/prompt/*.txt`                                                               | ✅     |
| **@ts-expect-error cleanup**               | Dead-TODO comment replaced with accurate rationale (Copilot SDK intentionally omits embedding/image methods)                                    | `provider/provider.ts:78`                                                            | ✅     |
| **Version bump: main repo**                | All 7 package.json + Cargo.toml → `1.0.0-preview.1`                                                                                             | `packages/*/package.json`, `src-tauri/Cargo.toml`                                    | ✅     |
| **Config JSON schema**                     | Generator script (`z.toJSONSchema`) + output at `schema/config.json`; users reference via `$schema` URL for editor autocomplete                 | `packages/librecode/scripts/generate-config-schema.ts`, `schema/config.json`         | ✅     |
| **Flatpak: cargo-sources.json**            | `scripts/generate-flatpak-sources.sh` downloads `flatpak-cargo-generator.py` on demand and produces 1,379-entry, 405 KB `cargo-sources.json`    | `scripts/generate-flatpak-sources.sh`, `packages/desktop/flatpak/cargo-sources.json` | ✅     |
| **Flatpak: Bun sha256 to 1.3.10**          | Downgraded manifest from Bun 1.3.11 to 1.3.10 (matching workflows + package.json packageManager) with verified sha256s                          | `packages/desktop/flatpak/com.librecode.desktop.yml`                                 | ✅     |
| **Flatpak: build workflow enabled**        | Auto-computes release tarball sha256 at build time, runs `flatpak-builder`, uploads `.flatpak` bundle to GitHub Release                         | `.github/workflows/flatpak.yml`                                                      | ✅     |
| **Nix: nodejs_20 → nodejs_24**             | Bumps dev shell to match GH Actions Node 24 migration path                                                                                      | `flake.nix`                                                                          | ✅     |
| **Release workflow: preview tag handling** | `release.yml` + `desktop.yml` set `prerelease: true` when tag contains `-preview.` or `-rc.`; COPR submission skipped for preview tags          | `.github/workflows/release.yml`, `desktop.yml`                                       | ✅     |
| **Desktop AppImage enabled**               | `APPIMAGE_EXTRACT_AND_RUN=1` env var lets Tauri's AppImage bundler work without FUSE on GH Actions                                              | `.github/workflows/desktop.yml`                                                      | ✅     |
| **Schema as release artifact**             | `librecode-config-schema.json` uploaded alongside binaries on each release                                                                      | `.github/workflows/release.yml`                                                      | ✅     |
| **Homebrew formula**                       | Tap-ready formula for macOS (arm64) + Linux (x64/arm64); sha256 filled post-release                                                             | `contrib/homebrew/librecode.rb`                                                      | ✅     |
| **Universal installer: install.sh**        | OS + arch detection, SHA256SUMS verification, user-scope install, PATH hint                                                                     | `scripts/install.sh`                                                                 | ✅     |
| **Universal installer: install.ps1**       | Windows PowerShell equivalent of install.sh                                                                                                     | `scripts/install.ps1`                                                                | ✅     |
| **CHANGELOG.md (main repo)**               | Keep-a-Changelog format, full v1.0.0-preview.1 entry with known limitations + upgrade notes                                                     | `CHANGELOG.md`                                                                       | ✅     |
| **README install matrix update**           | Added one-line installer, Homebrew tap, Flatpak, `$schema` autocomplete hint                                                                    | `README.md`                                                                          | ✅     |
| **Docs index + troubleshooting**           | `docs/index.md` table of contents; `docs/troubleshooting.md` covers install, macOS gatekeeper, WebKitGTK compositing, providers, MCP, dev setup | `docs/index.md`, `docs/troubleshooting.md`                                           | ✅     |
| **i18n repo: desktop locale parity**       | Added `th.ts` + `tr.ts` to `librecode-i18n/src/desktop/`                                                                                        | `librecode-i18n/src/desktop/`                                                        | ✅     |
| **i18n repo: version bump + CHANGELOG**    | Bumped and publishing via OIDC per release cut                                                                                                  | `librecode-i18n/`                                                                    | ✅     |
| **3rd-party providers: bump + publish**    | All 4 packages publishing via OIDC on each tag                                                                                                  | `librecode-3rdparty-providers/`                                                      | ✅     |

### Phase 22a: Release Pipeline Consolidation + OIDC ✅ (v0.9.8)

After initial preview work, consolidated 6 racing workflows into a single master orchestrator and fixed npm OIDC trusted publishing end-to-end.

| Item                                    | Description                                                                                                                            | Files                                      | Status |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| **Master release orchestrator**         | `release.yml` calls CI, npm-publish, desktop, flatpak, copr as `workflow_call` subs — no parallel racing, proper `needs:` dependencies | `.github/workflows/release.yml` (7 stages) | ✅     |
| **Gate CI to PRs only**                 | `ci.yml`, `build.yml`, `nix.yml` no longer fire on push-to-main; release orchestrator runs CI via workflow_call                        | `.github/workflows/{ci,build,nix}.yml`     | ✅     |
| **npm OIDC: no more NPM_TOKEN**         | Removed `registry-url` from `setup-node` (which wrote an `.npmrc` with broken NODE_AUTH_TOKEN interpolation that overrode OIDC)        | all 3 repos' `npm-publish.yml`             | ✅     |
| **npm OIDC: Node 24 pin for npm 11+**   | Node 22 ships npm 10 which predates OIDC. Pinned `node-version: "24.9.0"` — ships npm 11.x, no unpinned `@latest` supply-chain risk    | all 3 repos' `npm-publish.yml`             | ✅     |
| **COPR: librecode-desktop AutoReqProv** | Disable automatic dependency scan on 132 MB binary (was hanging COPR build forever)                                                    | `packages/rpm/librecode-desktop.spec`      | ✅     |
| **macOS signed DMG + notarization**     | Pre-unlock keychain + `set-keychain-settings -t 3600` to prevent codesign timeout on long builds                                       | `.github/workflows/desktop.yml`            | ✅     |
| **Bun.build success gate**              | `Bun.build()` silently returned raw runtime on failure → added `result.success` check so compile errors fail the build step            | `packages/librecode/script/build.ts`       | ✅     |
| **RPM strip skip for Bun binary**       | `%global __strip /bin/true` prevents rpmbuild strip from destroying the Bun-compiled binary                                            | `packages/rpm/librecode-desktop.spec`      | ✅     |

### Phase 23: Platform-Aware File Manager Icon ✅ (Issue #1)

| Item                           | File                                                         | Status |
| ------------------------------ | ------------------------------------------------------------ | ------ |
| Tauri `getFileManagerInfo` cmd | `packages/desktop/src-tauri/src/lib.rs`                      | ✅     |
| Platform context adapter       | `packages/app/src/context/platform.tsx`                      | ✅     |
| Generic folder icon in sprite  | `packages/ui/src/components/app-icons/sprite.svg` + types.ts | ✅     |
| Session header dynamic label   | `packages/app/src/components/session/session-header.tsx`     | ✅     |

### Phase 24: Progress Indicator + Liveness Detection ✅ (Issue #2)

| Item                         | File                                                          | Status |
| ---------------------------- | ------------------------------------------------------------- | ------ |
| StreamingIndicator component | `packages/app/src/components/session/streaming-indicator.tsx` | ✅     |
| Stall-detector primitive     | `packages/app/src/utils/stall-detector.ts`                    | ✅     |
| Token I/O accumulators       | `packages/librecode/src/session/activity-tracker.ts`          | ✅     |
| Event SDK type extension     | `packages/sdk/js/src/v2/gen/types.gen.ts`                     | ✅     |

### Phase 25: Local Compute Guided Setup ✅ (Issue #6)

| Item                    | File                                                  | Status |
| ----------------------- | ----------------------------------------------------- | ------ |
| Setup wizard component  | `packages/app/src/components/local-compute-setup.tsx` | ✅     |
| `/system/info` endpoint | `packages/librecode/src/server/routes/system.ts`      | ✅     |
| Wizard integration      | `packages/app/src/components/local-server-wizard.tsx` | ✅     |

### Phase 26: Voice "Talk to Me" Mode ✅ (Issue #5)

| Item                    | File                                               | Status |
| ----------------------- | -------------------------------------------------- | ------ |
| `createVoiceInput` hook | `packages/app/src/utils/voice-input.ts`            | ✅     |
| Prompt input mic button | `packages/app/src/components/prompt-input.tsx`     | ✅     |
| Voice settings          | `packages/app/src/components/settings-general.tsx` | ✅     |
| macOS mic entitlement   | `packages/desktop/src-tauri/entitlements.plist`    | ✅     |

### Phase 27: Productivity vs Development Mode ✅ (Issue #4)

| Item                  | File                                                     | Status |
| --------------------- | -------------------------------------------------------- | ------ |
| Mode context          | `packages/app/src/context/mode.tsx`                      | ✅     |
| `app_mode` config     | `packages/librecode/src/config/schema.ts`                | ✅     |
| Session-header toggle | `packages/app/src/components/session/session-header.tsx` | ✅     |
| Tool visibility field | `packages/librecode/src/tool/capabilities.ts`            | ✅     |

### Phase 28: MCP App Start Menu + Built-in Apps ✅ (Issue #3)

| Item                          | File                                                             | Status |
| ----------------------------- | ---------------------------------------------------------------- | ------ |
| Built-in app registry         | `packages/librecode/src/mcp/builtin-apps/index.ts`               | ✅     |
| FS activity graph app         | `packages/librecode/src/mcp/builtin-apps/fs-activity-graph.html` | ✅     |
| Session stats dashboard app   | `packages/librecode/src/mcp/builtin-apps/session-stats.html`     | ✅     |
| Start menu popover            | `packages/app/src/components/start-menu.tsx`                     | ✅     |
| SSE → iframe event forwarding | `packages/app/src/components/mcp-app-panel.tsx`                  | ✅     |
| Pinned-apps context           | `packages/app/src/context/pinned-apps.tsx`                       | ✅     |

---

### Phase 29: Pre-1.0 Security Hardening ✅ (v0.9.9 + v0.9.10)

Full OWASP Top 10 audit was performed 2026-04-18. Initial posture: **NEEDS WORK** — 7 high + 7 medium findings. Phase 29 closed all 14 in 18 commits across two releases.

**Sub-phase sequencing:**

| Sub-phase | Commits | Focus                                                                                | Release |
| --------- | ------- | ------------------------------------------------------------------------------------ | ------- |
| 29a       | 5       | Quick wins (SHA256SUMS, cargo-audit CI, CORS, stack trace, /log schema)              | v0.9.9  |
| 29b       | 3       | Tauri hardening (prod CSP, narrow capabilities, CycloneDX SBOMs)                     | v0.9.9  |
| 29c       | 2       | Network fail-closed (mdns password, webfetch SSRF)                                   | v0.9.9  |
| 29d       | 1       | npm dep bumps (hono, mcp-sdk, minimatch, vite, dompurify, solid-js) + `cargo update` | v0.9.10 |
| 29e       | 4       | Credential protection (read-block, OS keychain, log redaction, filesystem rename)    | v0.9.10 |
| 29f       | 1       | Server hardening (rate limit + 401 logging)                                          | v0.9.10 |

**All 7 high-severity findings closed:**

| #   | OWASP   | Finding                                                                                                                                                                                                                                                                                                                                                                                                          | Commit                                                                           |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | A05     | `--mdns` fail-closed without `LIBRECODE_SERVER_PASSWORD`                                                                                                                                                                                                                                                                                                                                                         | `922d50c` (29c.1)                                                                |
| 2   | A04/A02 | `auth.json` exfiltration via bash/read + OS keychain storage                                                                                                                                                                                                                                                                                                                                                     | `e4598ca` (29e.1) + `3bcae9c` (29e.2)                                            |
| 3   | A08     | SHA256SUMS covers all installer artifacts                                                                                                                                                                                                                                                                                                                                                                        | `362b9cd` (29a.1)                                                                |
| 4   | A05     | Production Tauri CSP + narrow capabilities + `withGlobalTauri: false`. **CSP reverted in v0.9.26** — Tauri 2.9's runtime-injected IPC scripts need nonces that the flat-string CSP form doesn't receive; Tauri only auto-amends structured (object-form) CSPs. Capabilities + `withGlobalTauri: false` still in place. Follow-up: re-introduce CSP as structured object so Tauri can add nonces to `script-src`. | `048e876` (29b.1) + `c9a5970` (29b.2) — **CSP regressed; capabilities retained** |
| 5   | A06     | bun audit: 16 → 7 highs (remainder are transitive, pinned to latest)                                                                                                                                                                                                                                                                                                                                             | `0479b86` (29d.1)                                                                |
| 6   | A10     | webfetch SSRF: scheme + userinfo + IP range + DNS resolve checks                                                                                                                                                                                                                                                                                                                                                 | `fbe66c9` (29c.2)                                                                |
| 7   | A06     | cargo-audit in CI + `cargo update` for Rust advisories                                                                                                                                                                                                                                                                                                                                                           | `e292192` (29a.2) + `80a7bc1`                                                    |

**All 7 medium-severity findings closed:**

| #   | OWASP | Finding                                                                     | Commit            |
| --- | ----- | --------------------------------------------------------------------------- | ----------------- |
| 8   | A01   | `Filesystem.contains` → `containsLexical` (unsafe variant must be explicit) | `e90b6f3` (29e.4) |
| 9   | A02   | Log redaction layer (strip secret key/value patterns pre-write)             | `f6e84ae` (29e.3) |
| 10  | A05   | CORS exact port match (1420, 3000) instead of `localhost:*` wildcard        | `4f4dcd0` (29a.3) |
| 11  | A05   | Error handler redacts stack trace in prod; `LIBRECODE_DEV=1` opt-in         | `fcbdd86` (29a.4) |
| 12  | A07   | Basic-auth rate limit (10/5min per IP) + 429 with Retry-After               | `794b15f` (29f.1) |
| 13  | A04   | `/log` payload schema: service charset, message ≤8 KB, extra ≤16 KB         | `6f33b55` (29a.5) |
| 14  | A08   | CycloneDX SBOMs (sbom-npm.json + sbom-rust.json) per release                | `65cd2e2` (29b.3) |

**Regression prevention** — each OWASP fix ships with tests:

- `test/server/cors-origin.test.ts` (11 cases)
- `test/server/error-handler.test.ts` (2 cases)
- `test/server/log-endpoint.test.ts` (11 cases)
- `test/server/rate-limit.test.ts` (8 cases)
- `test/cli/network-fail-closed.test.ts` (11 cases)
- `test/util/ssrf.test.ts` (20 cases)
- `test/util/redact.test.ts` (13 cases)
- `test/file/credentials-guard.test.ts` (19 cases)
- `test/auth/storage.test.ts` (5 cases)

+100 new security-focused assertions. Suite: 1616 → 1715 pass.

**Existing strengths retained:** `Instance.containsPath` symlink-safe, `/provider/scan` SSRF patched, MCP iframe null-origin sandbox + CSP, OAuth state CSRF via `crypto.getRandomValues(32)`, npm OIDC + sigstore provenance, permission audit log, Drizzle-only SQL.

---

## v0.9.x Continued — Phases 30 through 35 ✅ SHIPPED

After Phase 29 closed all OWASP findings, six more phases shipped between v0.9.20 and v0.9.77 (122 commits, 58 patch versions).

### Phase 30: Tauri/Desktop Hardening (v0.9.21–.34)

| Item                                                     | Versions | Status |
| -------------------------------------------------------- | -------- | ------ |
| RPM `librecode-desktop` declares `Requires: librecode`   | v0.9.21  | ✅     |
| Zero-drama CLI availability across all install paths     | v0.9.21  | ✅     |
| Linux-focused beta CI (disable macOS/Win desktop)        | v0.9.22  | ✅     |
| KDE 6 `qtpaths: command not found` silenced              | v0.9.23  | ✅     |
| CSP allow `127.0.0.1:*` + `::1:*`; DevTools enabled      | v0.9.24  | ✅     |
| Revert strict CSP that broke Tauri IPC in prod           | v0.9.25  | ✅     |
| Drop `_csp_note` from Tauri config (schema violation)    | v0.9.26  | ✅     |
| Rate limiter no longer blocks local UI                   | v0.9.27  | ✅     |
| Typecheck fix: drop out-of-scope `rl.count`              | v0.9.28  | ✅     |
| Drop IPv6 bracket URL Tauri can't parse                  | v0.9.29  | ✅     |
| MCP apps auth + tab switching + auto-nav on pin          | v0.9.30  | ✅     |
| Remove dead i18n waiters from release workflows          | v0.9.31  | ✅     |
| MCP UX cleanup: dedup tabs, theme sync, no forced Review | v0.9.31  | ✅     |
| MCP apps data seeding + pinned-tab persistence           | v0.9.32  | ✅     |
| MCP tab flicker + Review tab restore                     | v0.9.33  | ✅     |
| MCP iframe flash on tab switch                           | v0.9.34  | ✅     |

### Phase 31: MCP Apps Full Host (v0.9.35–.53) — ADR-005

Built out the full MCP Apps protocol host beyond Phase 15's protocol layer.

| Item                                                             | Versions | Status |
| ---------------------------------------------------------------- | -------- | ------ |
| Test fixtures: external MCP servers exposing `ui://` resources   | v0.9.36  | ✅     |
| Lock in MCP app event forwarding + snapshot seeding tests        | v0.9.35  | ✅     |
| `AppBridge tools/call` → server tool proxying (ADR-005)          | v0.9.37  | ✅     |
| Host context push + open-link + logging handlers + docs          | v0.9.38  | ✅     |
| Read-only proxies (`resources/list/read/templates` + `prompts`)  | v0.9.40  | ✅     |
| Per-call permission gate with 3-tier scope-aware grants          | v0.9.41  | ✅     |
| `ui/download-file` with confirm dialog                           | v0.9.42  | ✅     |
| Per-app Disconnect action + bridge running indicator             | v0.9.43  | ✅     |
| `ui/request-display-mode` (fullscreen support)                   | v0.9.44  | ✅     |
| `ui/message` with permission gate + char limit + origin metadata | v0.9.45  | ✅     |
| `ui/update-model-context` with caps + fork-forward               | v0.9.46  | ✅     |
| Settings → MCP Apps pane with per-app char-limit override        | v0.9.47  | ✅     |
| `sampling/createMessage` policy + per-app cost cap               | v0.9.48  | ✅     |
| "Posted by `<app>`" badge on MCP-app-origin messages             | v0.9.49  | ✅     |
| Per-session usage telemetry in Settings                          | v0.9.50  | ✅     |
| Persistent rule editor + "Always allow" DB writeback             | v0.9.51  | ✅     |
| `sampling/createMessage` LLM inference enabled                   | v0.9.52  | ✅     |

### Phase 32: UX Polish Wave (v0.9.54–.71) — ADR-006

Activity Graph + Session Stats live, persistent, polished. Suspense-flash class of bug codified in ADR-006 after four incidents.

| Item                                                                                  | Versions | Status |
| ------------------------------------------------------------------------------------- | -------- | ------ |
| Stop full-page flash when switching review tabs (ADR-006)                             | v0.9.54  | ✅     |
| Session Stats + Activity Graph data collection fix                                    | v0.9.55  | ✅     |
| `rust-audit` decoupled from release path; `rustls-webpki` bump                        | v0.9.56  | ✅     |
| Always-visible streaming indicator + pin-flash fix (ADR-006)                          | v0.9.57  | ✅     |
| Activity Graph nodes show tool's color (not grey)                                     | v0.9.58  | ✅     |
| Live draw loop + pulse on fresh and active nodes                                      | v0.9.59  | ✅     |
| Persistent pinned apps across restarts + crash guard on unreachable server            | v0.9.60  | ✅     |
| Portal dropdown + re-seed stats on history hydration                                  | v0.9.61  | ✅     |
| Per-app persistent state at `~/.local/librecode-mcp-apps/`                            | v0.9.62  | ✅     |
| Marketplace scaffold (mcpapps.vip) + relabel Apps→Start                               | v0.9.63  | ✅     |
| Marketplace pivot: `mcpapps.vip` → `mcpappfoundry.app`                                | v0.9.64  | ✅     |
| Activity Graph stops pulsing after agent reaches "completed"                          | v0.9.65  | ✅     |
| Reconstruct session activity from DB on first access                                  | v0.9.66  | ✅     |
| Server-side seed endpoint for Session Stats reload persistence                        | v0.9.67  | ✅     |
| Start-menu: dropdown transparency fix                                                 | v0.9.68  | ✅     |
| Start-menu: `startTransition` (insufficient on its own)                               | v0.9.69  | ✅     |
| Start-menu: prefetch app list — root cause was resource→interaction coupling          | v0.9.70  | ✅     |
| Pre-commit prettier hook (`.githooks/pre-commit` + postinstall sets `core.hooksPath`) | v0.9.71  | ✅     |

### Phase 33: Native MCP CLI (v0.9.72)

Non-interactive `librecode mcp add/remove/enable/disable` so upstream tools (e.g. openwebgoggles) can shell out cleanly without a TTY prompt. Small effort, high external-integration value.

### Phase 34: Agentic Control Panel (v0.9.73–.74) — ADR-007

| Item                                                                                     | Status |
| ---------------------------------------------------------------------------------------- | ------ |
| Settings dialog: Agents / Skills / Plugins / Tools tabs                                  | ✅     |
| Import from curated git-repo catalog (Superpowers, Superpowers-Chrome, Anthropic skills) | ✅     |
| Markdown-defined agents at `~/.config/librecode/agents/*.md` (`loadMarkdownAgents`)      | ✅     |
| Per-tab REST endpoints under `/control-panel/*`                                          | ✅     |
| Hot-fix: Settings dialog opens at app-shell scope → `useGlobalSDK()` not `useSDK()`      | ✅     |

### Phase 35: Multica + Phoenix Arize Telemetry (v0.9.75–.77) — ADR-008

| Item                                                                                      | Status |
| ----------------------------------------------------------------------------------------- | ------ |
| Self-contained Multica MCP server at `mcpapps/multica/` (`@librecode/multica-mcp-app`)    | ✅     |
| 3 tools: `multica_create_issue`, `multica_update_status`, `multica_add_comment`           | ✅     |
| Sandboxed iframe board wrapper (HTML-escaped meta tags, configurable workspace)           | ✅     |
| `MulticaClient` REST wrapper + `MulticaError` (preserves status + endpoint)               | ✅     |
| 30 unit tests with fake `fetchFn`                                                         | ✅     |
| Phoenix Arize NodeTracerProvider + OpenInference span processor + OTLP exporter           | ✅     |
| Vercel AI SDK `experimental_telemetry` flipped on when `telemetry.phoenix.enabled`        | ✅     |
| Lazy-imported (~50–80MB OTel deps don't load unless Phoenix is enabled)                   | ✅     |
| Settings → Telemetry tab: status badge, endpoint/project rows, Test connection button     | ✅     |
| `GET /control-panel/telemetry` (read-only, never echoes apiKey) + `POST .../health-check` | ✅     |
| 11 Phoenix unit tests (`healthzUrlFor`, `checkPhoenixHealth` w/ fake fetch + abort)       | ✅     |
| **Release-pipeline hardening**: `models.dev` fetch retries 5× with exponential backoff    | ✅     |

---

## 📋 Best-Practices Audit (snapshot 2026-04-27)

| Check                     | Target        | Actual                                                          | Status |
| ------------------------- | ------------- | --------------------------------------------------------------- | ------ |
| Tests pass                | all green     | 1,915 pass, 9 skip, 3 flaky-on-full-suite (pass in isolation)   | ⚠️     |
| Typecheck                 | 0 errors      | 0 errors                                                        | ✅     |
| Lint warnings             | 0 net-new     | ~38 (legacy TUI `any`; no new code)                             | ⚠️     |
| Files over 1000 lines     | 0 unexpected  | 6 over-budget — 3 documented exceptions, 3 deferred (Phase 36D) | ⚠️     |
| `export namespace` usages | 0 in new code | 5 remain (ACP, Provider, Session, ServerConnection, Identifier) | ⚠️     |
| Complexity > 12           | 0             | 0                                                               | ✅     |

### Files over 1000 lines

| File                                                                                       | Lines               | Status                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------- |
| ~~`packages/app/src/components/mcp-app-panel.tsx`~~                                        | ~~1,516~~ → **923** | ✅ Phase 36A — split into 7 modules in `mcp-app-panel/`                                |
| `packages/librecode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts` | 1,785               | ✅ Exempt — vendored upstream code (CLAUDE.md category 2)                              |
| `packages/librecode/src/mcp/index.ts`                                                      | 1,168               | ✅ Exempt — tightly-shared private state (CLAUDE.md category 3)                        |
| `packages/ui/src/components/file-icons/types.ts`                                           | 1,102               | ✅ Exempt — codegen output (CLAUDE.md category 1)                                      |
| `packages/app/src/components/prompt-input.tsx`                                             | 1,051               | Phase 36D — deferred until next real touch (extract `<VoiceInputButton>` etc.)         |
| `packages/app/src/pages/session.tsx`                                                       | 1,024               | Phase 36D — deferred until next real touch (promote scroll/anchor + followup to hooks) |
| `packages/app/src/pages/layout.tsx`                                                        | 1,020               | Phase 36D — deferred until next real touch (extract nav, command palette, settings)    |

### Integration test isolation ✅ Phase 36B (commit `090c438`)

The 3 tests under `test/mcp-integration/` are now gated on `LIBRECODE_RUN_INTEGRATION=1`. Root cause: bun's `mock.module()` permanently mutates the test process's module registry (`mock.restore()` doesn't unwind it), and sibling tests in `test/mcp/` stub the SDK transport modules. Architectural fix is process isolation, which `package.json`'s `test:unit && test:integration` chain already provides — `bun test` (no script) now cleanly skips them with a printed reason instead of failing.

### Remaining namespace migrations (Playbook 1)

Apply barrel-export pattern, one PR each (per Playbook 1 rules):

1. `packages/librecode/src/acp/agent.ts` — `export namespace ACP`
2. `packages/librecode/src/provider/provider.ts` — `export namespace Provider` (partial migration already)
3. `packages/librecode/src/session/index.ts` — `export namespace Session`
4. `packages/app/src/context/server.tsx` — `export namespace ServerConnection`
5. `packages/app/src/utils/id.ts` — `export namespace Identifier`

---

## 📦 Deferred Items (from earlier phases, still valid)

| Item                                                                                                                                                                                                                                                                                                           | Source             | Priority | Status   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- | -------- |
| Flathub submission (public listing; manifest already builds in CI)                                                                                                                                                                                                                                             | Phase 22           | Low      | Deferred |
| **Re-introduce Tauri CSP in object form** so Tauri auto-amends script-src with IPC nonces. Flat-string form (what we tried in Phase 29) breaks Tauri's runtime IPC bridge — user-visible as a blank app window. Re-test with `"csp": { "default-src": [...], "script-src": [...], ... }` per-directive object. | Phase 29 follow-up | Medium   | TODO     |
| AppImage end-to-end verification (`APPIMAGE_EXTRACT_AND_RUN=1` wired but not validated on fresh system)                                                                                                                                                                                                        | Phase 22           | Low      | Deferred |
| Desktop locale parity: human-review `th.ts`/`tr.ts` translations                                                                                                                                                                                                                                               | Phase 22           | Low      | Deferred |
| Design-debt TODOs in `session/prompt-builder.ts:374, 503`                                                                                                                                                                                                                                                      | Phase 22           | Low      | Deferred |
| Design-debt TODOs in `plugin/copilot.ts:192-193`                                                                                                                                                                                                                                                               | Phase 22           | Low      | Deferred |
| Coverage gap in `processor.ts`, `prompt.ts`, `prompt-builder.ts`, `compaction.ts` (<20% each; needs BDD/E2E with running agent, not unit tests)                                                                                                                                                                | Phase 20           | Medium   | Deferred |
| Update Homebrew formula sha256s to current `SHA256SUMS` (still references v1.0.0-preview.1)                                                                                                                                                                                                                    | Phase 22           | Small    | TODO     |
| **Decompose `mcp-app-panel.tsx`** (1,516 lines after Phase 31 — every MCP-Apps bug touches this file)                                                                                                                                                                                                          | Phase 31 follow-up | Medium   | TODO     |
| **Diagnose 3 flaky `mcp-integration` tests** (pass in isolation, fail in full suite — likely a global state leak)                                                                                                                                                                                              | Phase 31 follow-up | Medium   | TODO     |
| **Static lint rule for ADR-006 pattern**: forbid `createResource` source functions reading signals written by event handlers in the same component (under `pages/session/*`)                                                                                                                                   | Phase 32 follow-up | Medium   | TODO     |

---

## 🗺️ Net-New Roadmap (continuing 0.9.x series)

No GitHub issues currently open. These are candidate workstreams we've discussed; pick based on user priority.

**Release policy:** Staying on `0.9.x` patch tags. No `1.0.0-preview.x` until real beta testing validates the product end-to-end. Every "Phase 3X" below ships as a 0.9.y patch.

### Phase 36: File-Size + Test-Isolation Cleanup ✅

- **A: Decompose `mcp-app-panel.tsx`** ✅ (commit `a8cbdc7`) — 1,516 → 923 lines, 7 focused modules in `mcp-app-panel/{csp,theme,fetch,seed,state-relay,events,handlers,types}.ts`. Backward compat preserved via re-exports.
- **B: Diagnose flaky integration tests** ✅ (commit `090c438`) — root cause: bun's `mock.module()` permanently mutates the test process's module registry. Fix: gate on `LIBRECODE_RUN_INTEGRATION=1`. `bun test` now cleanly skips them with a printed reason.
- **C: Formalize file-size exceptions** ✅ — codified three exception categories in CLAUDE.md (codegen, vendored upstream, tightly-shared private state) and refreshed the header comments on `file-icons/types.ts`, `openai-responses-language-model.ts`, and `mcp/index.ts` to reference the new categories. The remaining over-budget files (`prompt-input.tsx` 1,051, `pages/session.tsx` 1,024, `pages/layout.tsx` 1,020) are barely over and have deeply intertwined Solid state — splitting now is high effort with marginal benefit. Deferred to Phase 36D (split when next touched).

### Phase 36D: Deferred Component Splits (when next touched)

Three Solid `Page()` / `Component` files at 1.02–1.05× the file-size budget:

- `packages/app/src/components/prompt-input.tsx` (1,051) — extract `<VoiceInputButton>`, `<AttachmentTray>`, `<SuggestionPopover>`, `<ProviderAgentPicker>` (the header already lists these planned extractions).
- `packages/app/src/pages/session.tsx` (1,024) — promote scroll/anchor + followup queue + composer wiring into hooks; extract `SessionMobileTabs`.
- `packages/app/src/pages/layout.tsx` (1,020) — extract nav, command palette, and settings-modal wiring.

Each is a tractable but tangled refactor. The right time to do them is when the next real change to that component lands — refactor + feature in the same PR keeps the diff tractable.

### Phase 37: BDD/E2E Coverage Push

Close the unit-test gap on `processor.ts`, `prompt.ts`, `prompt-builder.ts`, `compaction.ts` (<20% each — needs a running agent + mock LLM). pytest-bdd scaffolding already in place at `tests/features/` + `tests/steps/`. Add a mock-LLM provider so behavior specs can drive the full agent loop. **Unblocks 80% line coverage target without faking unit tests.**

### Phase 38: ADR-006 Static Enforcement

Land a custom biome/eslint rule: in components under `pages/session/*`, `createResource` source functions MUST NOT read signals written by event handlers in the same component. ADR-006 codified the rule after four Suspense-flash incidents (v0.9.54, .58, .70, .71) — each cost 2-3 patch versions to land. **Static enforcement catches the next instance before it ships.**

### Phase 39: Plugin Marketplace (mcpappfoundry.app)

Natural follow-on to the marketplace pivot (v0.9.64) + the new git-repo catalog import in Control Panel (Phase 34). Pieces in place: `@librecode/sdk`, `@librecode/plugin`, npm OIDC provenance, Control Panel import flow. Need: hosted index file, search UI, one-click install + uninstall, signing/verification story. Large effort.

### Phase 40: Remaining Namespace Migrations (Playbook 1)

5 `export namespace` declarations remain. Apply barrel-export pattern, one PR each. Mechanical, low-risk, but adds review noise.

### Phase 41: MCP Co-editing App (deferred from Phase 28 per ADR-005)

CRDT/OT implementation for collaborative real-time editing of shared documents in MCP apps. Design-only as ADR-005 today. Large effort.

### Phase 42: App Dock Prototype ✅

Detail: `docs/plans/phase-42-spec.md`
Roadmap context: `docs/plans/mcp-apps-overhaul-roadmap.md`
ADR: `docs/adr/009-app-dock.md`

Shipped v0.9.82. Feature-flagged right-side App Dock that hosts one MCP app at a time
as a sibling to the session side panel. Key deliverables: `app-dock/` component tree,
`experimental.app_dock` config flag, Ctrl+\\ keyboard shortcut, workspace-scoped
localStorage persistence, iframe-preservation via CSS `display:none`, Session Stats
as the prototype built-in. +18 new unit tests (534 total in packages/app).
Deviations from spec: `dock.test.tsx` tests component behaviour via `createRoot` rather
than DOM render (Bun resolves solid-js/web to server build in the test environment;
DOM assertions covered by Playwright e2e). See phase-42-spec.md §Verification checklist.

### Phase 43: Multi-pane Dock + Reorder + Collapse ✅

Detail: `docs/plans/phase-43-spec.md`
ADR: `docs/adr/009-app-dock.md` (status updated to Multi-pane in-place)

Shipped v0.9.83. Extends the App Dock from one app to N apps stacked vertically.
Key deliverables: multi-pane `<For>` loop keyed on stable URIs (iframe-safe reorder),
`PaneHeader` with drag-to-reorder (`createDraggable`), `PaneDivider` for height
redistribution, `AddAppPopover` (Kobalte Popover outside `DragDropProvider` per
Pitfall #3), per-pane collapse with `display:none` iframe preservation, `reorder.ts`
and `sizing.ts` pure helpers, Phase 43 BDD E2E scenarios. +45 new unit tests
(120 total in app-dock/).
PLAN.md numbering: legacy Phase 42b/43/44/45 renumbered to 60/61/62/63 to free
42–51 for the MCP-Apps overhaul arc.
Deviations from spec: (1) `AddAppPopover` always rendered (not gated on
`entries.length > 0`) so the first app can be added via popover without the "Try it"
CTA; (2) used `createDraggable` + `createDroppable` pair instead of `createSortable`
for cleaner separation of drag handle vs. drop target.

### Phase 52: Testing Architecture Overhaul (v0.9.98 → v0.10.0) ✅

Detail: `docs/plans/phase-52-spec.md`
ADR: `docs/adr/0010-test-architecture.md`

Three-layer testing stack established after a series of fix-forwards
(v0.9.91→.94 dock invisible, v0.9.94 Timeline auth bypass, v0.9.95 dock
off-screen) revealed a systemic gap: unit tests passed but real Tauri behavior
was never exercised. Phase 52 closes the gap, adds a CI gate, and codifies the
architecture in ADR-010.

| Sub-phase                 | Item                                                                                                                       | Version  | Status |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| 52A (regression backfill) | `dock-visibility-upgrade.test.ts`, `fetch-auth-audit.test.ts`, smoke template §10 "Regression coverage"                    | v0.9.98  | ✅     |
| 52B (mockIPC helper)      | `test-utils/tauri-mock.ts` (`createMockPlatform`), docs in `architecture.md`                                               | v0.9.99  | ✅     |
| 52C (Layer 3)             | `tauri-plugin-playwright` under `e2e-testing` feature, 5 E2E specs (4 pass + 1 browser-skip), `playwright.tauri.config.ts` | v0.9.100 | ✅     |
| 52D (CI gate)             | `e2e.yml` workflow, `release.yml` `needs: [e2e]` on build jobs, security check                                             | v0.10.0  | ✅     |
| 52E (docs)                | ADR-010 accepted, CLAUDE.md/architecture.md/development.md updated                                                         | v0.10.0  | ✅     |

**New pitfall documented (Phase 52C)**: `@srsholmes/tauri-playwright`'s
`createTauriTest` fixture calls `waitForLoadState("networkidle")` in setup,
which never fires because LibreCode holds a live SSE connection to the
backend. Solution: import `generateIpcMockScript` directly and build a
custom fixture with `waitForLoadState("load")`.

Tests: 861 (Sub-A baseline) → 867 → 872 → 872 (Sub-C adds 5 E2E specs outside
`bun test` count) → 872 (Sub-D/E are CI + docs).

### Phase 50b: Lazy iframe mount + iframe pool (v0.9.93) ✅

Detail: `docs/plans/phase-50b-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 50b row appended in-place)

Sub-A (keep-alive decision + lazy mount) and Sub-B (iframe pool foundation) both shipped.

**Sub-A — three-signal keep-alive and lazy mount:**

Non-keep-alive apps now unmount their iframe when collapsed instead of hiding it with
`display:none`. Keep-alive is determined by: (1) built-in server, (2) observed
`mcp-app-state:save` traffic, or (3) user-set `alwaysLoaded` config flag. This removes
idle iframe memory/CPU for apps that don't need live state. A one-shot toast on first
collapse of an unknown app guides users to the "Always keep loaded" toggle in the ⋮ menu.

**Sub-B — iframe pool (park side):**

`IframePool` (max-3 LRU, 5-min TTL) parks iframes when `dock.remove()` fires.
Off-screen host div keeps the iframe alive across SolidJS cleanup. Pool claim path
(fast re-pin without cold-start handshake) deferred to Phase 50c.

| Item                                                                                                                           | Status |
| ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `keep-alive.ts`: `shouldKeepIframeAlive` (3-signal) + `buildAlwaysLoadedMap` helpers                                           | ✅     |
| `keep-alive.test.ts`: 20 tests covering all three signals and edge cases                                                       | ✅     |
| `schema.ts`: `mcp_apps: Record<uri, { alwaysLoaded?: boolean }>` Zod field (no `.default()` — Phase 48 lesson)                 | ✅     |
| `mcp-apps-schema.test.ts`: 8 Zod validation tests for mcp_apps field                                                           | ✅     |
| `schema/config.json` + `packages/sdk/openapi.json` + `types.gen.ts`: mcp_apps propagated through SDK chain                     | ✅     |
| `state-relay.ts`: `onSaveObserved?: () => void` callback fires via `queueMicrotask` on `mcp-app-state:save`                    | ✅     |
| `state-relay.test.ts`: 5 new tests for onSaveObserved (added to existing 6)                                                    | ✅     |
| `use-dock-state.tsx`: `observedRelaySet` signal + `markRelayObserved(uri)` + `observedRelay()` in context                      | ✅     |
| `use-dock-state.test.tsx`: 5 new tests for relay observation tracking                                                          | ✅     |
| `mcp-app-panel.tsx`: DockContext import + `onSaveObserved` wiring + `onIframeReady` prop                                       | ✅     |
| `dock.tsx`: `keepAlive` createMemo + `alwaysLoadedMap` + lazy-mount `<Show>` pattern + `PaneIframeBody` subcomponent           | ✅     |
| `dock.tsx`: `onToggleAlwaysLoaded` — optimistic config update via `globalSync.set` + `updateConfig` with rollback              | ✅     |
| `dock.tsx`: one-shot toast on first unknown-app collapse (gates on `sessionToastShown` set)                                    | ✅     |
| `pane-menu.tsx`: "Always keep loaded" `role=menuitemcheckbox` item (non-builtin only)                                          | ✅     |
| `pane-menu.test.tsx`: 8 new tests for Phase 50b toggle visibility + handler wiring                                             | ✅     |
| `pane-header.tsx`: `canAlwaysKeepLoaded` / `alwaysLoaded` / `onToggleAlwaysLoaded` prop chain                                  | ✅     |
| `dock.test.tsx`: 7 new tests — lazy-mount decision logic mirror (Phase 50b block)                                              | ✅     |
| **Sub-B** `iframe-pool.ts`: `IframePool` factory + `getIframePool()` singleton, LRU-3, 5-min TTL, off-screen host, cleanup cbs | ✅     |
| **Sub-B** `iframe-pool.test.ts`: 14 tests (park/claim/has, LRU, cleanup cbs, TTL with fake now, dispose, singleton)            | ✅     |
| **Sub-B** `telemetry.ts`: `iframe_pool_park` / `iframe_pool_hit` / `iframe_pool_miss` event types                              | ✅     |
| **Sub-B** `dock.tsx`: `onIframeReady` callback chain (DockPane → PaneIframeBody → McpAppPanel) + pool park on `onCleanup`      | ✅     |
| Tests: 777 → 836 (app) — 59 new; 1995 librecode, 0 failures                                                                    | ✅     |
| Preview smoke: all 7 checks (including Sub-B pool park) passed via mcp\_\_Claude_Preview tools                                 | ✅     |
| **Pool claim path (fast re-pin)** — deferred to Phase 50c                                                                      | ✅     |

### Phase 50c: Iframe pool claim side — fast re-pin (v0.9.93) ✅

Completes the iframe pool round-trip begun in Phase 50b Sub-B. When a user re-pins
an app within 5 minutes of removing it, `PaneIframeBody` now claims the parked
iframe from the pool instead of doing a cold-start `fetchAppHtml` + full iframe
reload + AppBridge handshake.

**How it works:**

- `PaneIframeBody` checks `getIframePool().has(poolKey)` synchronously at render
  time (before `onMount`). If hit, `claim()` returns the iframe element.
- The `cachedIframe` prop is passed to `McpAppPanel`, which skips `createResource`
  (source returns `undefined` → no fetch) and inserts the claimed iframe via
  `appendChild` (DOM move, not clone — keeps content intact).
- `useAppBridge` detects `readyState === "complete"` and calls `bridge.connect()`
  immediately rather than waiting for the `load` event (which won't re-fire since
  the iframe's srcdoc hasn't changed).
- `claim()` does NOT call `entry.cleanup()` — the old bridge was already closed by
  `McpAppPanel.onCleanup` (Solid disposes children before parents), so calling it
  again would wrongly drop the app's session permission grants.
- Telemetry: `iframe_pool_hit` / `iframe_pool_miss` emitted from `onMount` for
  non-builtin apps.

| Item                                                                                                | Status |
| --------------------------------------------------------------------------------------------------- | ------ |
| `dock.tsx PaneIframeBody`: synchronous pool check + `cachedIframe` prop wiring                      | ✅     |
| `dock.tsx PaneIframeBody`: `iframe_pool_hit` / `iframe_pool_miss` telemetry in `onMount`            | ✅     |
| `mcp-app-panel.tsx`: `cachedIframe?: HTMLIFrameElement` prop on `McpAppPanelProps`                  | ✅     |
| `mcp-app-panel.tsx`: `createResource` source returns `undefined` for pool hits (no fetch)           | ✅     |
| `mcp-app-panel.tsx`: pool-hit render path (container `<div>` + `ref` → `appendChild`)               | ✅     |
| `mcp-app-panel.tsx`: header `<Show>` covers both srcdoc and pool-hit cases                          | ✅     |
| `mcp-app-panel.tsx useAppBridge`: immediate `bridge.connect()` when `readyState === "complete"`     | ✅     |
| `iframe-pool.ts claim()`: comment documents why cleanup is NOT called (session-grant safety)        | ✅     |
| `iframe-pool.test.ts`: +4 Phase 50c claim-side tests (no-cleanup invariant, one-shot, cross-server) | ✅     |
| `dock.test.tsx`: +5 PaneIframeBody pool-hit/miss decision logic tests                               | ✅     |
| Tests: 836 → 846 (app) — +10 new; all pass                                                          | ✅     |

### Phase 50: Keyboard + a11y + Phoenix telemetry polish (v0.9.92) ✅

Detail: `docs/plans/phase-50-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 50 changelog appended in-place)

Keyboard power users can now jump to any dock pane (Ctrl+Shift+1..9), return to the
main session area (Ctrl+Shift+0), or detach the focused pane (Ctrl+Shift+D). Screen
readers see the dock as a "complementary" landmark, panes as named regions, and get
polite announcements on collapse/expand/detach/reattach. Resize handles and pane
dividers are now keyboard-operable (arrow keys, 16px steps). Phoenix telemetry hooks
fire for dock-pane lifecycle events when `telemetry.phoenix.enabled = true`.

| Item                                                                                                    | Status |
| ------------------------------------------------------------------------------------------------------- | ------ |
| `telemetry.ts`: OTel-based dock-pane lifecycle emitter, gated on phoenix.enabled                        | ✅     |
| `a11y-live.ts`: polite live-region announcer (clear-then-set cycle for re-announcements)                | ✅     |
| `keyboard.ts`: `makePaneFocusKeyHandler` (Ctrl+Shift+1..9/0) + `makeDetachKeyHandler` (Ctrl+Shift+D)    | ✅     |
| `keyboard.ts`: `useDockPaneKeyboardShortcuts` hook wires all three handlers via window.addEventListener | ✅     |
| `session.tsx`: `DockKeyboard()` calls `useDockPaneKeyboardShortcuts()` alongside existing toggle        | ✅     |
| `dock.tsx`: `<aside role="complementary">` landmark + `aria-label="App dock"`                           | ✅     |
| `dock.tsx`: `aria-live="polite" aria-atomic="true"` hidden live region                                  | ✅     |
| `dock.tsx`: resize handle — `role=separator`, `aria-orientation=vertical`, `tabindex=0`, arrow keys     | ✅     |
| `dock.tsx`: each pane body → `<section role="region" aria-label={appName}>`                             | ✅     |
| `divider.tsx`: `role=separator`, `aria-orientation=horizontal`, `tabindex=0`, ArrowUp/Down handlers     | ✅     |
| `pane-header.tsx`: `tabindex=0` + `data-pane-index` + `focus-visible:ring-2` focus ring                 | ✅     |
| Telemetry: mounted/unmounted/collapsed/expanded/detached/reattached events with ms_since_dock_open      | ✅     |
| Tests: 749 → 777 (app) — 28 new (telemetry gate×8, a11y live×3, keyboard×12, dock a11y mirror×5)        | ✅     |
| Preview smoke: 7-check §8 run via mcp\_\_Claude_Preview tools (see trip report)                         | ✅     |
| Defers lazy iframe mount + iframe pool → Phase 50b                                                      | ✅     |

### Phase 49: Detachable Tauri windows (v0.9.89) ✅

Detail: `docs/plans/phase-49-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 49 changelog appended in-place)

Each dock pane can now be popped out into its own native Tauri window. ⤢ button in
the pane header opens a new window carrying the MCP app. Windows persist position,
size, and monitor across restarts via `tauri-plugin-window-state`. The detached route
provides `SDKProvider + SyncProvider` via `?dir=` query param. Re-attach works from
the detached window header or the dock placeholder. Built-in apps deferred to Phase 50.

| Item                                                                                                                 | Status |
| -------------------------------------------------------------------------------------------------------------------- | ------ |
| `app_window.rs`: DetachedAppWindow struct + `uri_hash` + `window_label`                                              | ✅     |
| Three Tauri commands: `open_detached_app_window`, `close_detached_app_window`, `is_detached_app_window_open`         | ✅     |
| Main-window close hook: closes all `detached-*` windows                                                              | ✅     |
| `capabilities/default.json`: `core:webview:allow-create-webview-window`                                              | ✅     |
| `DockEntry.detached?: boolean` + `detachEntry`/`reattachEntry` pure helpers                                          | ✅     |
| `AppDockProvider`: `detach(uri)` / `reattach(uri)` actions                                                           | ✅     |
| `/detached/:server/:uri` route + `DetachedAppShell` with SDKProvider + SyncProvider                                  | ✅     |
| `pane-detached-placeholder.tsx` + dock branching on `entry.detached`                                                 | ✅     |
| `PaneHeader`: ⤢ Detach button (hidden on web, hidden for `__builtin__`)                                              | ✅     |
| Platform: `openDetachedWindow`, `closeDetachedWindow`, `focusDetachedWindow`, `invokeTauriEvent`, `listenTauriEvent` | ✅     |
| `dock.reattach` Tauri IPC listener in dock.tsx                                                                       | ✅     |
| `DANGER_ZONE_GLOBS`: `pages/detached/**` added to ADR-006 lint check                                                 | ✅     |
| Unit tests: 734 → 749 (app) + 0 → 29 (cargo, 3 new app_window tests)                                                 | ✅     |
| Manual smoke (11 steps): ⚠️ requires human verification — automated agent                                            | 🔲     |

### Phase 48: Tab strip cleanup + drop legacy MCP code (v0.9.88) ✅

Detail: `docs/plans/phase-48-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 48 changelog appended in-place)

After the dock proved stable through Phases 42–47, Phase 48 flips the
default and retires the legacy in-tab-strip MCP rendering. The dock is
now the only MCP surface unless the user explicitly disables it.

| Item                                                                             | Status |
| -------------------------------------------------------------------------------- | ------ |
| `experimental.app_dock` schema default → `true` (was implicit undefined → false) | ✅     |
| Apps tab + pinned-app `<Tabs.Trigger>`s deleted from session-side-panel.tsx      | ✅     |
| `forceMount + opacity:0 + position:absolute` pinned-pane overlay hack deleted    | ✅     |
| `mcpTabValue` helper, legacy MCP tab prefix handling, stale-tab redirect effect  | ✅     |
| Dead `tabs().open("mcp-app:...")` after `pinnedApps.pin(...)` in session-header  | ✅     |
| Right-side file-tree panel extracted → `session-file-tree-panel.tsx`             | ✅     |
| `session-side-panel.tsx`: 669 → 448 lines                                        | ✅     |
| Migration note in CHANGELOG: opting out of dock = no MCP apps in workspace       | ✅     |

### Phase 47: App Lifecycle UX ✅

Detail: `docs/plans/phase-47-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 47 changelog appended in-place)

Shipped v0.9.87. Each dock pane now shows a colored status dot (green/yellow-pulse/
amber/red/gray) and a ⋮ menu button. The menu exposes: **Reconnect** (when status is
failed/needs_auth), **View error** (when failed with error text — replaces iframe
content via display:none toggle preserving the bridge), **Remove from dock** (always).
Built-in apps (`server === "__builtin__"`) always show green; missing `sync.data.mcp`
entry shows yellow/connecting. Backend: `MCP.reconnect(name)` added to `mcp/index.ts`,
new `POST /mcp/reconnect/:server` route (operationId `mcp.reconnect`), SDK regenerated
so `sdk.client.mcp.reconnect({ server })` is available.
New files: `pane-status.ts`, `pane-status.test.ts`, `pane-status-dot.tsx`,
`pane-menu.tsx`, `pane-menu.test.tsx`, `test/mcp/reconnect.test.ts`.
Modified: `pane-header.tsx` (prop rename `name`→`appName`, new props),
`pane-header.test.tsx`, `dock.tsx`, `dock.test.tsx`, `mcp/index.ts`, `routes/mcp.ts`,
SDK (`sdk.gen.ts`, `types.gen.ts`), `e2e/app-dock.spec.ts` (+3 BDD scenarios).
Tests: +45 total (705 app unit, 1984 librecode unit).
Deferred to Phase 47b: Update available notifications, Open in settings deep-link, View logs.

### Phase 46: Activity Duplication Resolution ✅

Detail: `docs/plans/phase-46-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 46 changelog appended in-place)

Shipped v0.9.86. The session tab strip's "Activity" label is now "Timeline"
(display-only rename: `session.tab.activity` value changed in
`@librecode/i18n@0.9.33`; internal identifier and Phase 45's redirect
effect are unchanged). The Timeline tab gains a "View as graph →" button
(dock-enabled only) that adds the Activity Graph built-in app to the dock;
if the dock is hidden it auto-opens. Button reads "In dock" + disabled when
the graph is already present.
New files: `activity-grid.test.tsx` (+13 unit tests). Modified:
`activity-grid.tsx` (ViewAsGraphButton sub-component + openActivityGraph
helper), `e2e/app-dock.spec.ts` (+2 BDD E2E scenarios). Cross-repo:
`librecode-i18n` v0.9.33 published (c6b788e).
Deviations from spec: (1) App package.json dep updated from `^1.0.0-preview.1`
(not `^0.9.32` as spec assumed) to `^0.9.33` — the preview track was an
orphan side branch; all three packages (app, desktop, ui) updated. (2) Unit
tests use mirror-function pattern (no component imports) per server-side test
env constraint, matching Phases 43–45 style.

### Phase 45: Discovery Consolidation ✅

Detail: `docs/plans/phase-45-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 45 changelog appended in-place)

Shipped v0.9.85. When `experimental.app_dock = true`, the Start menu
becomes the single canonical entry point for adding apps: the session
strip's "Apps" tab is hidden (Trigger + Content both under
`<Show when={!dockEnabled()}>`), and Start-menu launches route to
`dock.add()` instead of `pinnedApps.pin() + tabs.open()`. Added "in dock"
badges + disabled state for apps already present in the dock. A redirect
effect in `session-side-panel.tsx` handles the edge case where the active
tab was "apps" when the flag first enabled. Flag-off users see zero change
from v0.9.84.
New files: `start-menu.test.tsx` (+16 unit tests). Modified: `start-menu.tsx`,
`session-header.tsx`, `session-side-panel.tsx`, `app-dock/index.ts` (barrel),
`e2e/app-dock.spec.ts` (+4 BDD E2E scenarios). Net: +20 tests.
Deviations from spec: (1) "Browse marketplace" link was already present
(v0.9.64's `MarketplaceDialog` button); no second link added. (2) Unit tests
are pure-logic style (mirrors Phase 43/44 patterns) rather than mocked-context
renders — DOM interaction covered by E2E.

### Phase 44: Legacy Pinned-Apps Migration ✅

Detail: `docs/plans/phase-44-spec.md`
ADR: `docs/adr/009-app-dock.md` (Phase 44 changelog appended in-place)

Shipped v0.9.84. One-shot migration from the legacy tab-strip pinned-apps
system to the App Dock. On first `AppDockProvider` mount per workspace,
legacy pins are read (via `untrack`) and seeded into the dock in pin order;
the dock auto-opens and a toast confirms: "Restored N apps from your tab
pins". Migration is keyed on `DockState.migratedFromPinnedAt?: number` —
once set, never re-runs. Manual dock entries are preserved (user wins). The
legacy `pinned-apps` storage is read-only in this phase; both systems
coexist until Phase 48.
New files: `migration.ts` (pure planner), `migration.test.ts` (+23 tests),
`use-dock-state.test.tsx` (+5 tests). Modified: `types.ts`, `state.ts`,
`state.test.ts` (+3 tests), `use-dock-state.tsx`, `e2e/app-dock.spec.ts`
(+2 BDD E2E scenarios). Net: +31 unit tests.
Deviations from spec: none.

### Phase 55: Agent HUD — overlay mode + telemetry channels 🎯 IN PROGRESS (H0)

North star: `docs/plans/agentic-hud-vision.md`
ADR: `docs/adr/0011-agent-hud-telemetry-channels.md`
Spec: `docs/plans/phase-55-agent-hud-spec.md`

Turn MCP apps into real-time **renderers of the agentic platform's state** —
where it's focusing, what's cleared/gained/remaining — as a HUD, pipeline map,
RTS minimap, or ARPG world. Platform ships the contract + one reference HUD;
the community writes the creative views as ordinary sandboxed MCP apps. Two
data sources: **derived** telemetry (auto, from the bus) + **agent-authored**
scene state (a `scene` tool the agent/plugins drive). Every UI-visible
sub-phase is verified in the real WebKitGTK webview (Phase-54 harness).

**Posture (planning session 2026-05-30): prove-then-invest.** Only **H0** is
committed; H1/H2 are contingent on the H0 gate ("does the overlay HUD feel
good — do you leave it open?").

| Horizon | Sub-phase | Scope                                                               | Status |
| ------- | --------- | ------------------------------------------------------------------- | ------ |
| **H0**  | 55A       | `overlay` display mode (translucent HUD over session, click-thru)   | 🚧     |
| **H0**  | 55B-lite  | Telemetry broker + 3 channels (tasks/agents/cost), opt-in           | ⬜     |
| **H0**  | 55C       | Mission HUD reference app — the slice we validate the feel on       | ⬜     |
| H1      | 55B-full  | All 5 derived channels + contract versioning (`seq`/`version`)      | ⬜     |
| H1      | 55D       | Agent-authored `scene` channel (`scene` tool, opt-in; persistence)  | ⬜     |
| H1      | 55E       | Author SDK (`@librecode/sdk/hud`) + starter template + docs         | ⬜     |
| H2      | —         | Marketplace tie-in + first-party showcase HUDs (pipeline map, RTS)  | ⬜     |
| H3      | —         | Speculative/community: ARPG worlds, command center, streamed/replay | ⬜     |
| —       | 55F       | `skills` channel — DEFERRED (needs backend skill-invocation events) | ⬜     |

Naming note: "telemetry channels" (not "provider" — collides with LLM
`Provider`; not "signal" — collides with Solid `createSignal`). One sub-phase
per PR. H0 (55A→55C) ships as a unit (overlay has nothing to show without the
Mission HUD); validate, then decide on H1.

### Phase 60: Windows Code-Signing + Store Submission

_(Previously Phase 42b — renumbered to free 42–51 for the MCP-Apps overhaul arc.)_

Sign the `.exe` installer with an EV certificate, submit to Microsoft Store (or partner channels) to avoid SmartScreen warnings. Medium effort + cert-procurement cost.

### Phase 61: Linux AppImage Auto-Update

_(Previously Phase 43 — renumbered.)_

The Tauri updater currently disabled on Linux. Once AppImage is validated (deferred item above), wire up zsync-based delta updates via the AppImage updater framework. Small effort.

### Phase 62: Release Preflight Verification

_(Previously Phase 44 — renumbered.)_

Cheap-but-high-value: a `scripts/preflight-release.sh` that runs `bun run build` for the current platform + smoke-imports the npm tarball before tagging. Would have caught the v0.9.76 darwin-arm64 ConnectionRefused failure. Small effort.

### Phase 63: Enterprise Features (post-1.0)

_(Previously Phase 45 — renumbered.)_

Deferred per local-first charter but listed for completeness: SSO/SAML, audit-log forwarding to SIEM, multi-tenant config, secrets management integration. Out-of-scope for 0.9.x / 1.0 stable.

---

## Project Stats

| Metric                       | Value                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total commits                | ~377                                                                                                                                                |
| Tests passing                | 1,915                                                                                                                                               |
| Tests failing                | 0 (3 flaky on full-suite run; pass in isolation — tracked Phase 36B)                                                                                |
| Tests skipped                | 9                                                                                                                                                   |
| Test files                   | 155                                                                                                                                                 |
| Current version              | **v0.9.77** (Phase 35 — Multica + Phoenix telemetry — shipped)                                                                                      |
| Complexity violations        | 0                                                                                                                                                   |
| Source files over 1000 lines | 7 (one new — `mcp-app-panel.tsx` 1,516 lines; tracked Phase 36A)                                                                                    |
| Lint warnings total          | ~38 (legacy TUI `any`; down from 1,933)                                                                                                             |
| Remaining `export namespace` | 5 (Playbook 1, Phase 40)                                                                                                                            |
| OWASP audit posture          | **STRONG** — 7/7 high + 7/7 medium closed as of v0.9.10; re-audit scheduled before `v1.0.0`                                                         |
| bun audit                    | 7 high, 9 moderate (all transitive; latest available versions of seroval/dompurify/undici)                                                          |
| cargo audit                  | 0 vulnerabilities (15 unmaintained-GTK3 warnings documented in audit.toml)                                                                          |
| ADRs                         | **8** (001 Effect-ts, 002 Storage, 003 Agent Loop, 004 Auth Prompts, 005 MCP Tool Proxying, 006 Suspense, 007 Control Panel, 008 Multica + Phoenix) |
| npm packages                 | 7 published via OIDC (sdk, plugin, provider-{anthropic,openai,openrouter}, provider-bundle, i18n)                                                   |
| MCP apps                     | 2 self-contained (`@librecode/multica-mcp-app`; built-in fs-activity-graph, session-stats)                                                          |
| Telemetry pipelines          | 1 (Phoenix Arize — opt-in via `telemetry.phoenix.enabled`; lazy-imports OTel SDK)                                                                   |
| Sister repos                 | librecode-3rdparty-providers, librecode-i18n (OIDC-synced)                                                                                          |
| Core providers               | LiteLLM, Ollama, Amazon Bedrock, Azure                                                                                                              |
| Release artifacts per tag    | 14 (7 CLI archives, 2 desktop installers, SHA256SUMS, config schema, 2 SBOMs)                                                                       |
| Release pipeline duration    | ~18m end-to-end on v0.9.77 (Lint → npm publish → 7 CLI builds + desktop → GitHub Release → COPR)                                                    |
