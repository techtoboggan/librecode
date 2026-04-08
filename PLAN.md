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

## Phase 2: Core architecture refactor — IN PROGRESS

### Completed ✅

| Item | What was done |
|------|---------------|
| 2.1 Megafile splits | provider.ts 1,453→909 (loaders extracted), prompt.ts 1,970→1,855 (templates extracted) |
| 2.2 Effect-ts ADR | Decision: migrate away. ADR-001 written. QuestionService migrated to plain async. |
| 2.3 Provider plugin API | `ProviderPlugin` interface, `defineProvider()`, loaders extracted to 6 files |
| 2.4 Tool capabilities | `ToolCapabilities`, `ToolDependencies`, `ToolProfiles` + all 23 tools annotated with capability registry |
| 2.5 Storage cleanup | ADR-002 written. json-migration.ts removed (1,400 lines of dead code) |
| Quality framework | CLAUDE.md, biome linter (complexity<12), quality baseline documented |

### Remaining work

| Item | Effort | Risk | Blocked by |
|------|--------|------|-----------|
| **2.2** Migrate PermissionService from Effect | 2-3 hrs | Low | Nothing — QuestionService proved the pattern |
| **2.2** Migrate AuthService from Effect | 2-3 hrs | Medium | PermissionService (dependency) |
| **2.2** Migrate AccountService from Effect | 3-4 hrs | Medium | AuthService (dependency) |
| **2.2** Remove `effect` package entirely | 30 min | Low | All 4 services migrated |
| **2.1.1** Namespace→module migration | 4-6 hrs per namespace | High | Focused session, all tests passing |
| **2.3** Migrate loaders to ProviderPlugin interface | 2 hrs | Low | Nothing |
| **2.4** Tool output format standardization | 2-3 hrs | Medium | Nothing |
| **2.4** Tool execution telemetry | 3-4 hrs | Medium | Nothing |

---

## Phase 3: Agentic SDLC pattern — NOT STARTED

| Item | Description | Depends on |
|------|------------|-----------|
| **3.1** Formalize agent loop | Extract implicit loop from prompt.ts into explicit state machine | 2.1.1 (namespace migration) |
| **3.2** Instruction system overhaul | Priority ordering, source tracking, deduplication, context budgeting | 3.1 |
| **3.3** Permission system hardening | Formal model, persistence, audit logging, tool capability integration | 2.4 (done) |
| **3.4** Session improvements | Branching, export/import, replay, better compaction | 3.1 |
| **3.5** MCP server management | Health checks, lifecycle, discovery, error messages | Nothing |

---

## Phase 4: Desktop & UI — NOT STARTED

- [ ] **4.1** Desktop packaging: Linux .desktop file, Flatpak, auto-update channels
- [ ] **4.2** UI component audit: unused components, bundle size, a11y
- [ ] **4.3** E2E test stabilization: verify 40+ Playwright tests pass

---

## Phase 5: Documentation & contributor experience — PARTIAL

- [x] **5.1** README with branding, badges, install instructions
- [x] **5.3** CLAUDE.md development guide with coding standards, playbooks, quality gates
- [x] **5.4** Brand system: tokens, BRAND.md, DESIGN-SPEC.md, both site scaffolds (Lucide icons)
- [ ] **5.2** Architecture docs (agent loop, provider API, tool system, permission model)
- [ ] **5.4** Generate actual logo/mascot assets, wire into sites

---

## What to do next

The highest-value path forward:

```
NOW:  Continue Effect removal (PermissionService → AuthService → AccountService)
      Each is 2-3 hrs, proven pattern from QuestionService, low risk.
      ↓
THEN: Phase 3.3 — Permission system hardening
      Tool capabilities are ready (2.4 done). Connect them to permissions.
      This is user-facing value: smarter permission prompts, audit logging.
      ↓
THEN: Phase 3.5 — MCP server management
      No dependencies, high user value (health checks, better errors).
      ↓
THEN: Phase 3.1 — Formalize agent loop
      This is the big architectural win but depends on namespace migration (2.1.1).
      Consider doing 2.1.1 first if agent loop work is blocked.
      ↓
PARALLEL: Phase 4 + remaining Phase 5
```

### Deferred items (tech debt, not blocking user value)
- Namespace→module migration (2.1.1) — high effort, documented in CLAUDE.md playbook
- Turbo evaluation (1.3) — low priority
- AppImage/Flatpak (0.2) — nice-to-have
- Tool telemetry (2.4) — nice-to-have
