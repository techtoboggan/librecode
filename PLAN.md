# LibreCode Refactor Plan

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Establish a proper agentic SDLC pattern, fix packaging, strip vendor cruft.
> Last updated: 2026-04-08 | 20 commits | Tests: 1295 pass, 7 fail (env-dependent)

---

## Phase 0: Foundation — DONE ✅

- [x] **0.1** GitHub Actions: 6 workflows replacing 35+ (ci, build, release, desktop, nix, copr)
- [x] **0.2** Linux packaging: RPM spec for COPR, PKGBUILD for AUR, Nix flake cleaned
- [x] **0.3** Rebrand: 377 files, @opencode-ai → @librecode, binary/config/env/Tauri/Nix/Cargo

---

## Phase 1: Build system & monorepo cleanup — DONE ✅

- [x] **1.1** Dead deps stripped (@babel/core, @actions/artifact, dead catalog entries)
- [x] **1.2** Build script decomposed (fetch-models.ts, load-migrations.ts, --target flag, publish.ts rebranded)
- [x] **1.4** Lock file regenerated clean (bun 1.3.11, 321 packages)
- [x] **1.5** Test infrastructure: 11 new test files for util/plugin, CI expanded to 4 parallel jobs
- [ ] **1.3** Evaluate Turbo vs Bun workspaces alone

---

## Phase 2: Core architecture refactor — DONE (deferred items tracked below)

### Completed ✅

| Item | What was done |
|------|---------------|
| 2.1 Megafile splits | provider.ts 1,453→909 (loaders extracted), prompt.ts 1,970→1,855 (templates extracted) |
| 2.2 Effect-ts removal | **ADR-001 COMPLETE.** All 5 services migrated to plain async. Effect package removed. Zero imports remain. Branded types replaced with pure TS Brand<T,B>. |
| 2.3 Provider plugin API | `ProviderPlugin` interface, `defineProvider()`, loaders extracted to 6 files |
| 2.4 Tool capabilities | `ToolCapabilities`, `ToolDependencies`, `ToolProfiles` + all 23 tools annotated with capability registry |
| 2.5 Storage cleanup | ADR-002 written. json-migration.ts removed (1,400 lines of dead code) |
| Quality framework | CLAUDE.md, biome linter (complexity<12), quality baseline documented |

### Remaining Phase 2 work (completing before Phase 3.1)

**2.1.1 — Namespace → module export migration**

Per CLAUDE.md Playbook 1. Uses barrel pattern (`export const X = { ... } as const`) to keep `X.method()` call syntax so consumers don't change. One namespace per commit.

| Namespace | File | Consumers | Risk | Order |
|-----------|------|-----------|------|-------|
| `MessageV2` | session/message-v2.ts (988 lines) | 31 files | ✅ DONE — barrel + type companion, 0 consumer changes | 1st |
| `Provider` | provider/provider.ts (909 lines) | 26 files | ✅ DONE — barrel + type companion, 0 consumer changes | 2nd |
| `Session` | session/index.ts (893 lines) | ~20 files | ✅ DONE — barrel + type companion, 0 consumer changes | 3rd |
| `SessionPrompt` | session/prompt.ts (1,855 lines) | ~15 files | ✅ DONE — barrel, no type companion needed, 0 consumer changes | 4th |

**Approach**: For each namespace:
1. Keep `export namespace X {}` wrapper but add `// @deprecated` comment
2. Add a barrel `export const X = { ... } as const` below the namespace
3. Add type companion namespace for `z.infer` types
4. Verify all consumers work with barrel pattern
5. In a follow-up PR, remove the namespace wrapper and dedent

This two-step approach (barrel first, then remove namespace) is safer than doing both at once.

**2.3 — Migrate loaders to ProviderPlugin interface** ✅
- `loaders/types.ts` now imports from `plugin-api.ts` — single source of truth
- `CustomLoader` is now `(provider: ProviderInfo) => Promise<ProviderLoadResult>`
- Eliminated `any` types from loader interfaces (replaced with `unknown`)
- Zero behavioral changes, purely type alignment

**2.4 — Tool output standardization + telemetry** ✅
- `tool/telemetry.ts`: `withTelemetry()` wrapper captures timing, input/output size,
  risk level, truncation status for every tool execution
- `ToolExecutionEvent` Bus event for observability dashboards
- `formatDuration()`, `formatSize()` helpers
- 9 new tests covering success/error/metadata passthrough + formatting

---

## Phase 3: Agentic SDLC pattern — IN PROGRESS

| Item | Description | Status |
|------|------------|--------|
| **3.3** Permission hardening | ✅ Audit logging (`permission/audit.ts`), capability-enriched permission requests, `capabilityInfo()` API for UI, integrated at ask/reply/deny decision points | DONE |
| **3.1** Formalize agent loop | ✅ ADR-003 written. `session/agent-loop.ts`: AgentState types, ExitReason, AgentLoopTracker, transition events, VALID_TRANSITIONS table. 13 new tests. | DONE |
| **3.2** Instruction system overhaul | ✅ `session/instruction-compiler.ts`: 6 priority tiers, source tracking, content+source deduplication, per-tier and total token budgets, `formatCompiled()` debug output. 16 new tests. | DONE |
| **3.4** Session improvements | ✅ Export: versioned JSON format with `exportSession()`/`exportSessionJSON()`. Branch: `fork()` with message copying + ID remapping, `branches()` listing, `ancestry()` tree walking. 5 new tests. | DONE |
| **3.5** MCP server management | ✅ Health monitor (`mcp/health.ts`) with auto-reconnect + exponential backoff. Error diagnostics (`mcp/diagnostics.ts`) with categorized errors + actionable suggestions. 19 new tests. | DONE |

---

## Phase 4: Desktop & UI — DONE

- [x] **4.1** Desktop packaging: AppStream metainfo, Flatpak manifest, deb path fix
- [x] **4.2** UI audit: 34MB fonts (intentional), 2 unused components, clean
- [x] **4.3** E2E test stabilization: all test identifiers rebranded
- [x] **4.4** Desktop dev verified: `bun run dev:desktop` builds + launches on Fedora 44. Fixed: install script, desktop script rebrand (153 refs across 66 files), Nix shell GTK3 + LD_LIBRARY_PATH

---

## Phase 5: Documentation & contributor experience — DONE (logo assets pending)

- [x] **5.1** README with branding, badges, install instructions
- [x] **5.2** Architecture docs (`docs/architecture.md`)
- [x] **5.3** CLAUDE.md with coding standards, migration playbooks, quality gates
- [x] **5.4** Brand system: tokens, BRAND.md, DESIGN-SPEC.md, both site scaffolds
- [x] **5.5** Local dev setup: `scripts/dev-setup.sh` (isolated .dev/ dir), `docs/development.md` (3 dev modes, Nix desktop shell, Fedora/Ubuntu dep guides, troubleshooting), `nix develop .#desktop` with full Tauri deps
- [ ] **5.4b** Generate actual logo/mascot assets (DESIGN-SPEC.md has prompts ready)

---

## Phase 6: Provider System — DONE

- [x] **6.1** Removed hosted "librecode" provider: Zen/Go subscriptions, free models, public API key fallback, "big-pickle" model, all UI references (~73 refs across 14 files)
- [x] **6.2** Added LiteLLM as first-class provider: autodiscovery on localhost:4000, `/v1/models` fetch, env var support (`LITELLM_BASE_URL`, `LITELLM_API_KEY`), config support
- [x] **6.3** Updated getting-started UI: "Connect a provider to get started" replaces free model messaging

---

## Execution plan
      ↓
THEN: Phase 4 + remaining Phase 5 in parallel
```

### Low-priority items (do whenever)
- Turbo evaluation (1.3)
- AppImage/Flatpak (0.2)
- Logo/mascot asset generation (5.4)
