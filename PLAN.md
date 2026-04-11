# LibreCode Roadmap

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Local-first AI coding agent with clean architecture and community provider ecosystem.
> Last updated: 2026-04-11 | 118 commits | Tests: 1358 pass, 0 fail

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

| Item | Status |
|------|--------|
| Remove stale "librecode" provider refs | ✅ |
| Fix failing test (bun install timeout) | ✅ |
| Stale i18n strings | ✅ clean |
| First-run experience (empty state hints) | ✅ |
| Model selector context-sensitive empty state | ✅ |
| npm auth + all 6 packages published | ✅ |
| README update | ✅ |

---

## v0.1.x Fast-follows

### Phase 9: Ollama Auth + Wizard Cleanup

| Item | Description | Effort | Status |
|------|-------------|--------|--------|
| **OllamaAuthPlugin** | Already exists and complete in `packages/librecode/src/plugin/ollama.ts` — URL prompt, connection validation, model injection. | Medium | ✅ Done (was already done) |
| **Rename litellm-wizard → local-server-wizard** | `LiteLLMWizard` misnamed; handles ALL local servers (Ollama, vLLM, llama.cpp, LocalAI) with network scan + selective model import. Renamed to `LocalServerWizard`, shim left for any stragglers. Provider IDs changed from `litellm-<url>` → `local-<url>`. | Small | ✅ Done |

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
| Total commits | 118 |
| Tests passing | 1,358 |
| Tests failing | 0 |
| Test files | 111 |
| Complexity violations | 20 (all CLI/TUI, 0 core) |
| Files over 1000 lines | 12 |
| Lint warnings total | ~40 (down from 1,244) |
| ADRs | 4 (Effect-ts, Storage, Agent Loop, Auth Prompts) |
| npm packages | 6 published (sdk, plugin, provider-anthropic, provider-openai, provider-openrouter, provider-bundle) |
| Sister repos | librecode-3rdparty-providers, librecode-i18n |
| Core providers | LiteLLM, Ollama, Amazon Bedrock, Azure |
