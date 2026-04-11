# LibreCode Roadmap

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Local-first AI coding agent with clean architecture and community provider ecosystem.
> Last updated: 2026-04-10 | 92 commits | Tests: 1358 pass, 0 fail

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
- `@librecode/plugin@0.1.0` published to npm (has broken `zod: "catalog:"` dep — needs 0.1.1)
- npm org `@librecode` created (techtoboggan)
- `~/Projects/librecode-3rdparty-providers` monorepo scaffolded (provider-anthropic, provider-openai, provider-openrouter, provider-bundle)
- GitHub Actions npm-publish.yml with OIDC provenance (both repos) — fixed catalog: dep resolution, fixed workflow ordering
- `docs/providers.md` — comprehensive guide for adding new providers
- `.claude/skills/add-provider` — Claude Code skill for adding providers
- 3rdparty repo pushed to `github.com/techtoboggan/librecode-3rdparty-providers` (v0.1.0 tag)

### Phase 8: Provider System Cleanup ✅
- `BUILTIN = []` — removed broken `librecode-anthropic-auth@0.0.13` npm reference
  - Generic auth fallback in `dialog-connect-provider.tsx` handles all simple API key providers
  - `loadApiKeyProviders()` generically injects stored keys for all providers
  - No BUILTIN npm plugins needed for Anthropic/OpenAI/etc.
- Ollama provider icon added to sprite sheet
- npm-publish.yml in both repos fixed: catalog: dep resolution + workflow job ordering

---

## What's Left for MVP

### Must Have (blocks v0.1.0 release)

| Item | Description | Effort | Status |
|------|-------------|--------|--------|
| **Remove stale "librecode" provider refs** | `isFree()` dead code, `librecode`/`librecode-go` icon sprite entries removed | Small | ✅ Done |
| **Fix the 1 failing test** | `tool.registry` singular dir test timed out due to `bun install` network call. Fixed with `LIBRECODE_SKIP_DEPS_INSTALL` env var | Small | ✅ Done |
| **Stale i18n strings** | Audited — all stale keys were already removed in earlier phases | Small | ✅ Done (clean) |
| **First-run experience** | When no providers connected AND no local servers found, the onboarding should guide clearly: "Install Ollama" or "Connect to LiteLLM" with links | Medium | Pending |
| **Model selector "No results"** | Reported but unverified — may be fixed by recent provider work. Needs manual validation. | Small | Pending |
| **README update** | Current README references old architecture. Needs: local-first positioning, provider ecosystem, install guide for Ollama/LiteLLM users | Medium | Pending |

### Should Have (v0.1.x fast-follows)

| Item | Description | Effort |
|------|-------------|--------|
| **npm auth setup** | Configure npm OIDC trusted publishers OR add NPM_TOKEN secret to both GitHub repos. Needed to publish `@librecode/plugin@0.1.1` (catalog: fix) and `@librecode/provider-*@0.1.0`. CI workflows are correct; only auth is missing. | Small |
| **Provider extraction Phase 3-4** | 3rdparty repo is live on GitHub. Packages ready. Needs npm auth to publish. BUILTIN deliberately empty — generic fallback handles simple API key providers. | Blocked (npm auth) |
| **OllamaAuthPlugin** | Proper auth plugin for Ollama (like LiteLLM) with prompts for URL | Medium |
| **Delete litellm-wizard.tsx** | Once the standard provider auth flow handles everything, the wizard can be replaced by the prompts system | Medium |

### Code Quality Cleanup ✅

**Complexity target achieved:** 0 violations (was 100+, baseline underestimated scope).
Every function in the codebase is now under the max complexity score of 12.

Completed in one commit (92): extracted 300+ module-level helper functions across 128 files.
CLI commands decomposed into subdirectory modules (providers/, stats/, mcp/, agent/, pr/).
1358/1358 tests pass.

**File size target (partially complete):** Several files remain over 1000 lines due to complexity
fixes requiring helper extraction that adds lines. These are tracked below.

| File | Current Lines | Status |
|------|-------------:|--------|
| `provider/provider.ts` | ~1,081 | Over — flagged for future split |
| `session/prompt.ts` | ~1,869 | Over — complex, pending split |
| `lsp/server.ts` | ~2,097 | Over — many LSP servers, pending split |
| `cli/cmd/github.ts` | ~1,647 | Over — pending split into github/ dir |
| `acp/agent.ts` | ~1,729 | Over — pending split |
| `config/config.ts` | ~1,459 | Over — pending split |
| `session/message-v2.ts` | ~1,062 | Over — pending split |
| `server/routes/session.ts` | ~1,023 | Over — pending split |

File-size splits are deferred to post-v0.1.0 (no behavior impact, low urgency).

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
