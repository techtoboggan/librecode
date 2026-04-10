# LibreCode Roadmap

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Local-first AI coding agent with clean architecture and community provider ecosystem.
> Last updated: 2026-04-10 | 91 commits | Tests: 1358 pass, 1 fail (env-dependent cowsay)

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
- `@librecode/sdk@0.1.0` published to npm
- `@librecode/plugin@0.1.0` published to npm
- npm org `@librecode` created (techtoboggan)
- `~/Projects/librecode-3rdparty-providers` monorepo scaffolded (provider-anthropic, provider-openai, provider-openrouter, provider-bundle)
- GitHub Actions npm-publish.yml with OIDC provenance (both repos)
- `docs/providers.md` — comprehensive guide for adding new providers
- `.claude/skills/add-provider` — Claude Code skill for adding providers

---

## What's Left for MVP

### Must Have (blocks v0.1.0 release)

| Item | Description | Effort |
|------|-------------|--------|
| **Remove stale "librecode" provider refs** | `use-providers.ts` still references `librecode`/`librecode-go` in various places. Provider list route injects them. Clean sweep. | Small |
| **Fix the 1 failing test** | `cowsay` external dependency test — either mock it or skip it properly | Small |
| **First-run experience** | When no providers connected AND no local servers found, the onboarding should guide clearly: "Install Ollama" or "Connect to LiteLLM" with links | Medium |
| **Model selector "No results"** | Reported but unverified — may be fixed by recent provider work. Needs manual validation. | Small |
| **Stale i18n strings** | Various `dialog.provider.librecode.*`, `dialog.provider.librecodeGo.*`, Zen references still in i18n files | Small |
| **README update** | Current README references old architecture. Needs: local-first positioning, provider ecosystem, install guide for Ollama/LiteLLM users | Medium |

### Should Have (v0.1.x fast-follows)

| Item | Description | Effort |
|------|-------------|--------|
| **Provider extraction Phase 3-4** | Move cloud providers (Anthropic, OpenAI, Copilot, etc.) to `librecode-3rdparty-providers`. Add to BUILTIN array as npm packages. | Large |
| **Trusted publishers CI** | Configure npm OIDC trusted publishers for automated releases | Small |
| **OllamaAuthPlugin** | Proper auth plugin for Ollama (like LiteLLM) with prompts for URL | Medium |
| **Provider icon for Ollama** | Need an Ollama icon in the provider-icon sprite | Small |
| **Delete litellm-wizard.tsx** | Once the standard provider auth flow handles everything, the wizard can be replaced by the prompts system | Medium |

### Code Quality Cleanup (v0.1.x)

Target: 0 complexity violations, 0 files over 1000 lines.
Current: 20 violations, 12 oversized files. See `docs/quality-baseline.md`.

**Phase A — CLI command decomposition (kills 12 violations):**

| # | File | Score | Split into | Violations killed |
|---|------|------:|------------|------------------:|
| A1 | `cli/cmd/providers.ts` | 82 | `providers/` dir (5 files) | 5 |
| A2 | `cli/cmd/github.ts` | — | `github/` dir (4 files) | 0 (size only) |
| A3 | `cli/cmd/stats.ts` | 43 | `stats/` dir (3 files) | 3 |
| A4 | `cli/cmd/mcp.ts` | 32 | `mcp/` dir (3 files) | 2 |
| A5 | `cli/cmd/agent.ts` | 40 | `agent/` dir (3 files) | 1 |
| A6 | `cli/cmd/pr.ts` | 44 | `pr/` dir (3 files) | 1 |
| A7 | `cli/cmd/import.ts` | 27 | extract helpers | 1 |
| A8 | `cli/cmd/export.ts` | 16 | extract helpers | 1 |
| A9 | `cli/cmd/account.ts` | 13 | extract helper | 1 |

**Phase B — TUI splits (kills 7 violations + biggest file):**

| # | File | Score/Lines | Split into |
|---|------|-------------|------------|
| B1 | `tui/routes/session/index.tsx` | 2,281 lines | messages.tsx + parts.tsx + tools/ dir |
| B2 | `tui/component/dialog-provider.tsx` | 27 | sub-components |
| B3 | `tui/component/dialog-status.tsx` | 16 | sub-components |
| B4 | `tui/component/dialog-model.tsx` | 15 | sub-components |
| B5 | `tui/component/dialog-command.tsx` | 13 | extract helpers |
| B6 | `tui/component/dialog-workspace-list.tsx` | 13 | extract helpers |
| B7 | `tui/component/logo.tsx` | 13 | extract helpers |
| B8 | `tui/component/prompt/index.tsx` | 1,171 lines | sub-components |
| B9 | `tui/context/theme.tsx` | 1,152 lines | tokens.ts + index.tsx |

**Phase C — Core engine splits (0 violations, size only):**

| # | File | Lines | Split into |
|---|------|------:|------------|
| C1 | `config/config.ts` | 1,459 | schema.ts + sources.ts + config.ts |
| C2 | `session/prompt.ts` | 1,869 | prompt-builder.ts + prompt-tools.ts + prompt.ts |
| C3 | `server/routes/session.ts` | 1,023 | session/ dir (crud, messages, actions) |
| C4 | `provider/transform.ts` | 1,004 | transform-input.ts + transform-output.ts |
| C5 | `acp/agent.ts` | 1,729 | handlers.ts + types.ts + agent.ts |
| C6 | `lsp/server.ts` | 2,097 | handlers/ dir by LSP method |
| C7 | `session/message-v2.ts` | 1,062 | message-v2-parts.ts |
| C8 | `bun/index.ts` | 13 (score) | extract helper |

**Phase D — Vendor code (leaves with provider extraction):**
- `provider/sdk/copilot/responses/...` — 1,732 lines. Skip, moves to `@librecode/provider-github-copilot`.

### Nice to Have (v0.2+)

| Item | Description | Effort |
|------|-------------|--------|
| **Logo/mascot assets** | DESIGN-SPEC.md has prompts ready, need actual generation | Small |
| **Turbo evaluation** | 1.3 from Phase 1 — Turbo vs Bun workspaces alone | Small |
| **AppImage/Flatpak** | Additional Linux packaging formats | Medium |
| **Provider capability detection** | During discovery, probe what models support (vision, tools, streaming) | Large |
| **Structured credential storage** | Separate URL from API key in auth storage (currently encoded as `url\|key`) | Medium |
| **i18n extraction** | Move locale files from core to `@librecode/i18n` (repo scaffolded) | Medium |

---

## Project Stats

| Metric | Value |
|--------|-------|
| Total commits | 95 |
| Tests passing | 1,358 |
| Tests failing | 0 |
| Test files | 111 |
| Complexity violations | 20 (all CLI/TUI, 0 core) |
| Files over 1000 lines | 12 |
| Lint warnings total | ~40 (down from 1,244) |
| ADRs | 4 (Effect-ts, Storage, Agent Loop, Auth Prompts) |
| npm packages | 2 published (@librecode/sdk, @librecode/plugin) |
| Sister repos | librecode-3rdparty-providers, librecode-i18n |
| Core providers | LiteLLM, Ollama, Amazon Bedrock, Azure |
