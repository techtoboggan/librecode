# LibreCode Refactor Plan

> Fork of [anomalyco/opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27)
> Goal: Establish a proper agentic SDLC pattern, fix packaging, strip vendor cruft.

---

## Phase 0: Foundation (repo hygiene, CI, packaging)

### 0.1 — GitHub Actions from scratch
The original had 35+ workflow files (triage bots, discord notifiers, stale-issue closers, stats generators, etc.). Replace with a minimal, purpose-built set:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push/PR to `main` | Typecheck (`tsgo --noEmit`), lint, `bun test` on all packages |
| `build.yml` | push to `main` / release tags | Run `packages/opencode/script/build.ts` for all platform targets, upload artifacts |
| `release.yml` | tag `v*` | Build all targets, create GitHub Release with binaries, generate checksums |
| `desktop.yml` | tag `v*-desktop` | Tauri build for Linux/macOS/Windows, sign, publish |
| `nix.yml` | push to `main` | `nix flake check`, eval packages, update hashes if needed |
| `copr.yml` | release | Build RPM spec, submit to Fedora COPR for proper repo-based distribution |

### 0.2 — Linux packaging (the actual heresy fix)
- **COPR**: Write an RPM `.spec` file, publish to a COPR repo so Fedora/RHEL users get `dnf install librecode`
- **AUR**: PKGBUILD for Arch
- **Nix**: Already have flake.nix — clean it up, rename references from opencode to librecode
- **AppImage/Flatpak**: Evaluate for desktop app distribution
- **Drop**: Static `.deb`/`.rpm` download approach (keep only as fallback in GitHub Releases)

### 0.3 — Rebrand references
- Rename `opencode` → `librecode` across package names, binary names, config paths, user-facing strings
- Update `@opencode-ai/*` workspace package names to `@librecode/*`
- Update Tauri config (`tauri.conf.json`) identifiers and app name
- Update Nix derivation names

---

## Phase 1: Build system & monorepo cleanup

### 1.1 — Audit workspace dependencies
The root `package.json` has cruft: `@aws-sdk/client-s3`, `sst`, `@actions/artifact`, `husky`, `glob`, `semver` — most are leftovers from removed packages. Audit every dependency in every `package.json` and strip what's unused.

### 1.2 — Fix the build script
`packages/opencode/script/build.ts` does too much:
- Fetches models.dev snapshot at build time (should be a separate, cacheable step)
- Bundles migrations as JSON constants (fine, but could be cleaner)
- Cross-compiles for 12+ targets inline
The build should be decomposed into discrete steps that CI can cache independently.

### 1.3 — Evaluate Turbo vs alternatives
Currently using Turbo for monorepo task orchestration. Consider if this is still the right choice given the reduced package count (8 packages vs the original 19+). Bun workspaces alone may suffice.

### 1.4 — Lock file hygiene
The `bun.lock` is from the full monorepo. After stripping packages, regenerate it cleanly.

---

## Phase 2: Core architecture refactor

### 2.1 — Tame the megafiles
Several source files are enormous and do too many things:

| File | Lines | Problem |
|------|-------|---------|
| `src/session/prompt.ts` | ~67K | Instruction compilation, context mgmt, system prompts — all in one |
| `src/provider/provider.ts` | ~52K | Every provider definition inline |
| `src/provider/transform.ts` | ~33K | All LLM API transforms in one file |
| `src/session/message-v2.ts` | ~29K | Message model, parsing, serialization |
| `src/session/index.ts` | ~27K | Session state machine, persistence, everything |

**Strategy**: Decompose each into a directory module with clear single-responsibility files. E.g.:
```
src/provider/
  index.ts          # re-exports
  registry.ts       # provider registration & discovery
  providers/
    anthropic.ts
    openai.ts
    ...
  transform/
    index.ts
    tools.ts
    streaming.ts
    ...
```

### 2.2 — Effect-ts layer audit
The codebase uses Effect-ts for service composition but inconsistently — some parts use raw promises, some use Effect layers. Decide on a consistent strategy:
- **Option A**: Go all-in on Effect for the service layer (sessions, providers, storage) but keep tools and CLI as plain async
- **Option B**: Gradually migrate away from Effect toward simpler DI (the learning curve is steep for contributors)

### 2.3 — Provider system refactor
The provider system needs the most work:
- Extract each provider into its own module with a standard interface
- Make the models.dev snapshot a build artifact, not a runtime fetch
- Standardize auth patterns across providers (currently each has its own approach)
- Create a proper provider plugin API so new providers can be added without touching core

### 2.4 — Tool system formalization
The tool system (`Tool.define()`) is actually well-designed. Enhance it:
- Add tool capability declarations (reads files, writes files, executes code, network access)
- Add tool dependency declarations (e.g., Bash tool needs a shell, Grep needs ripgrep)
- Standardize output format across all tools
- Add tool execution telemetry/tracing

### 2.5 — Storage layer cleanup
- Drizzle + Bun SQLite is fine, keep it
- Clean up the dual migration system (bundled JSON vs filesystem)
- Add proper schema versioning
- Remove the JSON→SQLite one-time migration code (legacy from pre-SQLite era)

---

## Phase 3: Agentic SDLC pattern

### 3.1 — Define the agent loop formally
Currently the session/processor is an implicit agent loop. Make it explicit:

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

### 3.2 — Instruction system overhaul
`prompt.ts` at ~67K lines compiles instructions from multiple sources (CLAUDE.md-style files, project config, user prefs, tool descriptions). This needs:
- Clear instruction priority/ordering
- Instruction source tracking (which file contributed what)
- Instruction deduplication
- Max-context budget management with explicit truncation strategy

### 3.3 — Permission system hardening
The current permission system exists but needs:
- Formal permission model (what can an agent do without asking)
- Permission persistence across sessions
- Audit logging of all permission decisions
- Integration with tool capability declarations from 2.4

### 3.4 — Session management improvements
- Session branching/forking (try different approaches without losing context)
- Session export/import in a standard format
- Session replay for debugging
- Better compaction strategy (current one is basic)

### 3.5 — MCP server management
The MCP integration is solid but needs:
- Health checks and auto-reconnect
- MCP server lifecycle management (start/stop/restart)
- MCP server discovery (scan for available servers)
- Better error messages when MCP servers fail

---

## Phase 4: Desktop & UI

### 4.1 — Desktop packaging
- Fix Tauri build for Linux (proper .desktop file, icon installation, XDG compliance)
- Flatpak manifest for sandboxed distribution
- Auto-update channel configuration (stable/beta)

### 4.2 — UI component audit
`packages/ui` is 43MB — the largest package. Audit for:
- Unused components (removed packages may have been the only consumers)
- Bundle size optimization
- Accessibility compliance

### 4.3 — E2E test stabilization
40+ Playwright tests in `packages/app/e2e/` — verify they all pass with the stripped monorepo, fix any that reference removed packages.

---

## Phase 5: Documentation & contributor experience

### 5.1 — README rewrite
Replace the upstream README with one focused on LibreCode's goals, installation (including the new COPR/AUR repos), and contribution guide.

### 5.2 — Architecture docs
Document the agent loop, provider plugin API, tool system, and permission model so contributors can onboard quickly.

### 5.3 — Development setup
- `nix develop` should just work
- Document the non-Nix path (bun install, build, test)
- Add a `CLAUDE.md` / `LIBRECODE.md` for AI-assisted development on this repo

---

## Execution order

```
Phase 0.3 → 0.1 → 0.2    (rebrand, CI, packaging — unblocks everything)
      ↓
Phase 1.1 → 1.4 → 1.2    (clean deps, regen lockfile, fix build)
      ↓
Phase 2.1 → 2.3 → 2.2    (split megafiles, refactor providers, decide on Effect)
      ↓
Phase 3.1 → 3.2 → 3.3    (formalize agent loop, instructions, permissions)
      ↓
Phase 4 + 5 in parallel
```

Each phase should be a milestone with its own tracking issue. Each sub-item is a PR.
