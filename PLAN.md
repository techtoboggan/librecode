# LibreCode Refactor Plan

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Establish a proper agentic SDLC pattern, fix packaging, strip vendor cruft.

---

## Phase 0: Foundation (repo hygiene, CI, packaging) — DONE

### 0.1 — GitHub Actions from scratch ✅
Replaced 35+ upstream workflows with 6 focused ones:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push/PR to `main` | Typecheck, lint, 4 parallel test jobs (core, util, plugin, app) |
| `build.yml` | push to `main` | Multi-platform CLI builds via `--target` flag |
| `release.yml` | tag `v*` | Full release: build all targets, checksums, GitHub Release |
| `desktop.yml` | tag `v*-desktop` | Tauri build for Linux/macOS/Windows |
| `nix.yml` | push (nix paths) | `nix flake check`, eval packages |
| `copr.yml` | release | Submit RPM to Fedora COPR |

### 0.2 — Linux packaging ✅
- **COPR**: RPM `.spec` template (`packaging/librecode.spec.in`)
- **AUR**: PKGBUILD (`packaging/PKGBUILD`)
- **Nix**: flake.nix cleaned up, derivations renamed
- **AppImage/Flatpak**: TODO — evaluate for desktop app distribution

### 0.3 — Rebrand ✅
377 files changed: `@opencode-ai/*` → `@librecode/*`, binary/config/env vars/deep links/Tauri/Nix/Cargo all renamed.

---

## Phase 1: Build system & monorepo cleanup — DONE

### 1.1 — Audit workspace dependencies ✅
Stripped: `@babel/core`, `@types/babel__core`, `@actions/artifact`, `@cloudflare/workers-types`, `@solidjs/start`, `electron` from trustedDependencies.

### 1.2 — Build script decomposition ✅
Split monolithic `build.ts` into:
- `fetch-models.ts` — standalone, cacheable models.dev snapshot fetch
- `load-migrations.ts` — reusable migration loader module
- `release-upload.ts` — archive + GitHub Release upload
- `build.ts` — orchestrator with new `--target`, `--skip-models` flags
- `publish.ts` — rebranded NPM/Docker/AUR/Homebrew distribution

### 1.3 — Evaluate Turbo vs alternatives
- [ ] Consider if Turbo is still needed with only 8 packages
- [ ] Bun workspaces alone may suffice — measure build time difference

### 1.4 — Lock file hygiene ✅ (deferred)
Lockfile regen deferred to first `bun install` — no bun runtime on dev machine.

### 1.5 — Test infrastructure ✅
- 11 new test files (~60 cases) for `util` and `plugin` packages
- CI expanded to 4 parallel test jobs (was 1)
- App unit tests now run in CI (were previously local-only)

---

## Phase 2: Core architecture refactor — DESIGN DONE, implementation needs bun runtime

### 2.1 — Tame the megafiles ⚠️ PARTIAL

Actual file sizes (the original plan had inflated counts):

| File | Original | Current | Status |
|------|----------|---------|--------|
| `src/provider/provider.ts` | 1,453 | 909 | ✅ Loaders extracted to `provider/loaders/` (6 files) |
| `src/session/prompt.ts` | 1,970 | 1,855 | ✅ Templates extracted; deeper split blocked by namespace pattern |
| `src/provider/transform.ts` | 1,012 | 1,012 | ⬜ Under 1K lines — acceptable size, leave as-is |
| `src/session/message-v2.ts` | 988 | 988 | ⬜ Under 1K lines — acceptable size, leave as-is |
| `src/session/index.ts` | 893 | 893 | ⬜ Under 1K lines — acceptable size, leave as-is |

**Blocker: TypeScript namespace pattern.** All these files use `export namespace X { ... }` which:
- Prevents splitting into multiple files (namespaces can't span files)
- Requires updating 200+ import sites to convert to module exports
- Is the single biggest architectural debt in the codebase

### 2.1.1 — Namespace → module export migration ⬜ BLOCKED on bun runtime
- [ ] Convert `Provider` namespace to regular exports
- [ ] Convert `SessionPrompt` namespace to regular exports
- [ ] Convert `Session` namespace to regular exports
- [ ] Convert `MessageV2` namespace to regular exports
- [ ] Update all import sites (estimate: 200+ files)
- **Risk:** High — touches every consumer. Should be done as a dedicated PR with thorough testing.
- **Prerequisite:** `bun install` + `bun test` must pass first

### 2.2 — Effect-ts strategy ✅
- [x] Audited: 23 of 332 files use Effect (7%). 6 core services, 5 facade wrappers, 98% of tests are plain async.
- [x] Decision: **Migrate away** from Effect toward plain async/await with manual DI.
- [x] ADR: `docs/adr/001-effect-ts-strategy.md`
- [ ] Execute migration Phase A: Replace facades with plain classes (BLOCKED on bun)
- [ ] Execute migration Phase B: Replace InstanceState with Promise-based cache (BLOCKED on bun)
- [ ] Execute migration Phase C: Remove `effect` dependency (BLOCKED on bun)

### 2.3 — Provider system refactor ✅ DESIGN DONE
- [x] Extract each provider's custom loader into its own module (`provider/loaders/`)
- [x] Models.dev snapshot is now a separate cacheable build step (`fetch-models.ts`)
- [x] Formal provider plugin API defined (`provider/plugin-api.ts`)
  - `ProviderPlugin` interface with typed `ProviderInfo`, `ProviderLoadResult`
  - `defineProvider()` helper for external plugin authors
  - Documented lifecycle: discovery → loading → SDK creation → model resolution
- [ ] Migrate existing loaders to use new `ProviderPlugin` interface (BLOCKED on bun)
- [ ] Standardize auth patterns across providers
- [ ] Provider interface documentation for plugin authors

### 2.4 — Tool system formalization ✅ DESIGN DONE
- [x] Tool capability declarations (`tool/capabilities.ts`)
  - `ToolCapabilities`: reads/writes resource categories, sideEffects, executesCode, risk level
  - `ToolDependencies`: required binaries, env vars, tools, runtime capabilities
  - `declareCapabilities()` with automatic risk derivation
  - Pre-defined `ToolProfiles`: fileReader, fileWriter, shellExecutor, networkReader, pure
- [ ] Annotate each existing tool with capabilities (BLOCKED on bun — need to test)
- [ ] Standardize output format across all tools
- [ ] Add tool execution telemetry/tracing
- [ ] Integration with permission system (Phase 3.3)

### 2.5 — Storage layer cleanup ✅ DESIGN DONE
- [x] ADR: `docs/adr/002-storage-layer-cleanup.md`
- [ ] Add `_schema_version` table as a new migration (BLOCKED on bun + drizzle-kit)
- [ ] Remove `json-migration.ts` and startup check
- [ ] Document new migration naming convention

---

## Phase 3: Agentic SDLC pattern

### 3.1 — Define the agent loop formally ⬜
Currently the session/processor is an implicit agent loop buried in prompt.ts. Make it explicit:

```
Agent Loop:
  1. Receive user input or event
  2. Compile context (system prompt + instructions + history + tool results)
  3. Call LLM with available tools
  4. Process response:
     a. Text → stream to user
     b. Tool call → validate permissions → execute → goto 2
     c. Done → persist session state
  5. Handle errors, retries, compaction
```

### 3.2 — Instruction system overhaul ⬜
`prompt.ts` compiles instructions from multiple sources (CLAUDE.md-style files, project config, user prefs, tool descriptions). This needs:
- [ ] Clear instruction priority/ordering
- [ ] Instruction source tracking (which file contributed what)
- [ ] Instruction deduplication
- [ ] Max-context budget management with explicit truncation strategy

### 3.3 — Permission system hardening ⬜
- [ ] Formal permission model (what can an agent do without asking)
- [ ] Permission persistence across sessions
- [ ] Audit logging of all permission decisions
- [ ] Integration with tool capability declarations from 2.4

### 3.4 — Session management improvements ⬜
- [ ] Session branching/forking (try different approaches without losing context)
- [ ] Session export/import in a standard format
- [ ] Session replay for debugging
- [ ] Better compaction strategy (current one is basic)

### 3.5 — MCP server management ⬜
- [ ] Health checks and auto-reconnect
- [ ] MCP server lifecycle management (start/stop/restart)
- [ ] MCP server discovery (scan for available servers)
- [ ] Better error messages when MCP servers fail

---

## Phase 4: Desktop & UI

### 4.1 — Desktop packaging ⬜
- [ ] Fix Tauri build for Linux (proper .desktop file, icon installation, XDG compliance)
- [ ] Flatpak manifest for sandboxed distribution
- [ ] Auto-update channel configuration (stable/beta)

### 4.2 — UI component audit ⬜
`packages/ui` is 43MB — the largest package. Audit for:
- [ ] Unused components (removed packages may have been the only consumers)
- [ ] Bundle size optimization
- [ ] Accessibility compliance

### 4.3 — E2E test stabilization ⬜
- [ ] Verify 40+ Playwright tests pass with stripped monorepo
- [ ] Fix any that reference removed packages

---

## Phase 5: Documentation & contributor experience

### 5.1 — README ✅
Replaced upstream README with branded version (logo, mascot, badges, install instructions).

### 5.2 — Architecture docs ⬜
- [ ] Document the agent loop, provider plugin API, tool system, permission model
- [ ] Contributor onboarding guide

### 5.3 — Development setup ⬜
- [ ] Ensure `nix develop` just works
- [ ] Document the non-Nix path (bun install, build, test)
- [ ] Add a `CLAUDE.md` / `LIBRECODE.md` for AI-assisted development

### 5.4 — Brand & websites ⚠️ PARTIAL
- [x] Design tokens (`assets/brand/tokens.css`)
- [x] Brand guide (`assets/brand/BRAND.md`)
- [x] Design spec for asset generation (`assets/brand/DESIGN-SPEC.md`)
- [x] librecode.app scaffold (download hub with Lucide icons)
- [x] librecode.io scaffold (mission/vision site with Lucide icons)
- [ ] Generate actual logo/mascot assets (see DESIGN-SPEC.md)
- [ ] Wire final assets into sites, README, Tauri configs, favicons

---

## Execution order

```
Phase 0 ✅ → Phase 1 ✅ → Phase 2 (in progress)
                              ↓
                         2.1.1 namespace migration (blocker for deeper 2.1)
                              ↓
                         2.2 Effect decision → 2.3 provider API → 2.4 tools → 2.5 storage
                              ↓
                         Phase 3 (agent loop, instructions, permissions)
                              ↓
                         Phase 4 + 5 in parallel
```

Each phase should be a milestone with its own tracking issue. Each sub-item is a PR.
