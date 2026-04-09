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
| **3.1** Formalize agent loop | Extract implicit loop from prompt.ts into explicit state machine | ⬜ Depends on 2.1.1 |
| **3.2** Instruction system overhaul | Priority ordering, source tracking, deduplication, context budgeting | ⬜ Depends on 3.1 |
| **3.4** Session improvements | Branching, export/import, replay, better compaction | ⬜ Depends on 3.1 |
| **3.5** MCP server management | ✅ Health monitor (`mcp/health.ts`) with auto-reconnect + exponential backoff. Error diagnostics (`mcp/diagnostics.ts`) with categorized errors + actionable suggestions. 19 new tests. | DONE |

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

## Execution plan

```
NOW:  Phase 2.1.1 — Namespace migration (MessageV2 → Provider → Session → SessionPrompt)
      ↓
THEN: Phase 2.3 — Migrate loaders to ProviderPlugin interface
      ↓
THEN: Phase 2.4 — Tool output standardization + telemetry
      ↓
THEN: Phase 3.1 — Formalize agent loop (unblocked by namespace migration)
      ↓
THEN: Phase 3.2 — Instruction system overhaul
      ↓
THEN: Phase 3.4 — Session improvements
      ↓
THEN: Phase 4 + remaining Phase 5 in parallel
```

### Low-priority items (do whenever)
- Turbo evaluation (1.3)
- AppImage/Flatpak (0.2)
- Logo/mascot asset generation (5.4)
