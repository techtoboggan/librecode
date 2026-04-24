# LibreCode Development Guide

> This file is read by AI coding agents (Claude Code, Cursor, etc.) when working on
> this repository. It defines coding standards, architectural constraints, and migration
> playbooks that MUST be followed.

## Project Overview

LibreCode is a fork of opencode v1.2.27 — an AI-powered terminal coding agent. TypeScript
monorepo using Bun runtime, Solid.js UI, Tauri desktop. Effect-ts has been fully removed.

**Key files:**

- `PLAN.md` — master roadmap with phase tracking
- `docs/adr/` — architecture decision records
- `docs/architecture.md` — system architecture reference
- `docs/development.md` — full local dev guide
- `docs/releasing.md` — release process across all three repos (use `scripts/release.sh`)
- `assets/brand/DESIGN-SPEC.md` — brand asset generation guide

## Local Development

```bash
# One-time: install system dependencies (auto-detects distro)
scripts/dev-setup.sh --deps

# Enter dev shell + isolated data environment
nix develop                              # CLI dev (bun, node, ripgrep)
nix develop .#desktop                    # Desktop dev (+ Rust, GTK, WebKit)
source scripts/dev-setup.sh              # Isolate dev data to .dev/
bun install
bun run dev                              # CLI
bun run dev:desktop                      # Desktop (Tauri)

# See docs/development.md for full guide
```

## Commands

```bash
bun install                              # install deps
bun run dev                              # run CLI in dev mode
bun run dev:desktop                      # run desktop app (Tauri)
bun run dev:web                          # run web UI only
bun run typecheck                        # typecheck all packages
bun run lint                             # biome linter (complexity, namespaces, any)
bun test                                 # run all tests (from packages/librecode)
bun test --timeout 30000                 # with timeout for slow tests
bun test --coverage                      # with line coverage
cd packages/util && bun test             # test a single package
cd packages/librecode && bun test test/config/  # test a directory
```

## Coding Standards

### Complexity

- **Cyclomatic complexity**: Maximum 12 per function. If a function exceeds this, decompose it.
- **Function length**: Maximum 60 lines. Prefer 20-40. Extract helpers liberally.
- **File length**: Maximum 1,000 lines. Files over 500 should be evaluated for splitting.
- **Nesting depth**: Maximum 4 levels. Use early returns, guard clauses, and extracted helpers.

### Style

- **No semicolons** (prettier config: `semi: false`)
- **120 char line width**
- **Named exports only** — no `export default`
- **Explicit return types** on exported functions
- **Zod schemas** for all external data validation (configs, API responses, user input)
- **`NamedError`** pattern for all error types (see `@librecode/util/error`)

### TypeScript

- **Strict mode** — no `any` in new code. Use `unknown` + type narrowing.
- **Path aliases**: `@/` maps to `packages/librecode/src/` — use it for internal imports.
- **No `export namespace`** in new code. Use regular module exports. Existing namespaces
  are being migrated (see Migration Playbook 1).

### Testing

- **Test runner**: `bun test` (built-in, not vitest/jest)
- **File pattern**: `*.test.ts` colocated with source or in `test/` directory
- **Coverage baseline** (as of 2026-04-08):
  - packages/librecode: 72% lines, 62% functions
  - packages/util: 99% lines, 97% functions
- **Coverage targets** (for new and modified code):
  - New files: minimum 80% line coverage
  - Modified files: coverage must not decrease
  - Utility/pure functions: target 95%+
- **Test isolation**: Tests use temp dirs via `test/preload.ts` — never touch real user data
- **No network calls** in unit tests. Mock external APIs.

### Git

- Atomic commits — one logical change per commit
- Commit messages: imperative mood, explain WHY not just WHAT
- Always include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` when AI-assisted

## Architecture Constraints

### Effect-ts (ADR-001: COMPLETED)

- Effect-ts has been **fully removed** from the codebase.
- All services use plain async/await. The `effect` package is not a dependency.
- Branded types use `util/brand.ts` (pure TypeScript, no Effect Schema).

### Namespace Pattern (COMPLETED)

- All 4 namespaces (MessageV2, Provider, Session, SessionPrompt) have been
  converted to barrel exports with type companion namespaces.
- **Do NOT use `export namespace` in new code.** Use regular module exports.

### Provider System

- New providers MUST implement the `ProviderPlugin` interface (`src/provider/plugin-api.ts`).
- New provider loaders go in `src/provider/loaders/` — NOT inline in `provider.ts`.

### Tool System

- New tools MUST declare capabilities using `ToolCapabilities` (`src/tool/capabilities.ts`).
- Use `ToolProfiles` presets where applicable (fileReader, fileWriter, shellExecutor, etc.).

### Storage

- All schema changes via Drizzle migrations in `migration/` directory.
- Migration naming: `YYYYMMDDHHMMSS_description/migration.sql`
- No direct SQLite queries outside `src/storage/` — use Drizzle ORM.

### SolidJS: Suspense-safe state changes (MANDATORY inside the session route)

Four incidents so far: v0.9.54 tab switches, v0.9.58 first app pin, v0.9.70
Start menu open (partial — `startTransition` alone didn't fix it), v0.9.71
Start menu open (actual fix — removed the resource/interaction coupling).
Codifying so we stop paying the tax.

**The smell.** A user interaction flips a signal, and downstream a
`createResource` (anywhere in the subtree) either (a) gets that signal as
part of its source key, or (b) gets *remounted* by a conditional render.
The resource enters `loading`, and because the session route has a
`<Suspense fallback={<Loading />}>` wrapper around `<Session />` in
`app.tsx` (and `Loading` is an empty `div`), the whole session pane goes
blank for the duration of the load → visible white/black flash, text
reflow, iframe remounts.

**The preferred fix: don't couple interactions to resource loading.** If
opening a menu, switching a tab, or pinning an app doesn't *need* new
data to fetch, don't key a resource on that state. Fetch at mount
against a stable source, then let the UI state toggle pure presentation.

```typescript
// WRONG — flipping `open` changes the resource source → loading → fallback
const [open, setOpen] = createSignal(false)
const [apps] = createResource(() => (open() ? baseUrl() : undefined), fetcher)

// RIGHT — resource is keyed on a stable mount-time value, UI toggle is free
const [open, setOpen] = createSignal(false)
const [apps] = createResource(() => baseUrl(), fetcher) // fires at mount
```

**Second line of defense: `startTransition` around setters that genuinely
must trigger a load.** Sometimes the fetch depends on user input (search
box, selected session, etc.) and can't be prefetched. For those,
`startTransition` asks Solid to hold the current UI while the resource
settles. Wrap the setter once so every call site benefits:

```typescript
import { startTransition } from "solid-js"
const [value, setRawValue] = createSignal("")
const setValue = (next: string) => void startTransition(() => setRawValue(next))
```

**Important caveat — `startTransition` is not bulletproof.** When the
trigger is a cheap synchronous flip that causes a *downstream* resource to
enter `loading` (the Start menu shape: `open` flips → source function
returns a different value → resource loads), the Suspense fallback can
commit before the transition settles. Solid's transition tracking is
strongest when the resource is DIRECTLY read inside the transition
callback, not reached through a chain of reactive dependencies.

If your first `startTransition` fix didn't work on visual testing, the
answer is the "preferred fix" above — break the coupling, don't try to
patch the transition harder.

**Known hot surfaces (already fixed — don't regress):**

- `packages/app/src/pages/session/session-side-panel.tsx` — tab switches (v0.9.54, `startTransition`)
- `packages/app/src/context/pinned-apps.tsx` — `pin()` action (v0.9.58, `startTransition`)
- `packages/app/src/components/start-menu.tsx` — open/close toggle (v0.9.71, resource un-gated from `open()`)

**Detection for new code.** Before shipping any new component that
introduces a `createResource` under a session route:

1. Read the fetcher's source function. For every signal it reads, trace
   where that value is written. If any writer is an event handler and
   the data doesn't depend on the interaction, key the resource
   differently so the fetch happens at mount.
2. If the data genuinely depends on the interaction, wrap the setter in
   `startTransition` AND manually test — open the feature and watch the
   surrounding panes for any visible re-render. If you see a flash, the
   transition isn't catching it and you need to redesign the coupling.

The Suspense boundary itself is at `packages/app/src/app.tsx`
(`<Suspense>` around the lazy-loaded `<Session />`). Don't move or
remove it — the fallback is what shows on legitimately slow route
transitions (session first-load, provider reconnect). The fix is always
on the feature side, never the boundary.

## Migration Playbooks

### Playbook 1: Namespace → Module Export Migration

**Goal**: Convert `export namespace X { ... }` to regular module exports.

**Why**: Namespaces can't span multiple files, block decomposition, and are a TypeScript antipattern.

**Procedure for each namespace** (e.g., `Provider`):

1. **Verify tests pass first**: `bun test --timeout 30000` — all 1284+ must pass.

2. **Identify all exports** from the namespace:

   ```bash
   grep -n 'export ' src/provider/provider.ts | grep -v 'import'
   ```

3. **Identify all consumers** (files that import `Provider.X`):

   ```bash
   grep -rl 'Provider\.' src/ test/ | grep -v node_modules
   ```

4. **Convert the namespace** — change:

   ```typescript
   // Before
   export namespace Provider {
     export const Model = z.object({ ... })
     export type Model = z.infer<typeof Model>
     export async function list() { ... }
   }
   ```

   To:

   ```typescript
   // After — same file, no namespace wrapper
   export const ProviderModel = z.object({ ... })
   export type ProviderModel = z.infer<typeof ProviderModel>
   export async function providerList() { ... }

   // OR use a barrel pattern:
   export const Provider = {
     Model: ProviderModel,
     list: providerList,
     // ... keeps the Provider.X call syntax for consumers
   } as const
   ```

5. **Update all consumers** — the barrel pattern minimizes changes:

   ```typescript
   // Consumer code stays the same if using barrel:
   import { Provider } from "../provider/provider"
   Provider.list() // still works
   ```

6. **Run tests**: `bun test --timeout 30000` — verify zero regressions.

7. **Measure complexity**: Ensure no function exceeds cyclomatic complexity 12.

**Order of migration** (by risk, lowest first):

1. `MessageV2` — mostly type definitions, lowest consumer count
2. `Provider` — already partially decomposed
3. `Session` — medium complexity
4. `SessionPrompt` — highest complexity, do last

**One namespace per PR. Never combine.**

### Playbook 2: Effect-ts Service → Plain Async Migration

**Goal**: Remove Effect dependency per ADR-001.

**Procedure for each service** (e.g., `AccountService`):

1. **Map the service interface**:

   ```bash
   grep 'Effect.Effect' src/account/service.ts
   ```

2. **Create replacement class**:

   ```typescript
   // Before: Effect service
   const login = Effect.fn("AccountService.login")(
     (accountID: AccountID) => Effect.tryPromise({ ... })
   )

   // After: Plain class
   class AccountServiceImpl {
     async login(accountID: AccountID): Promise<Account> { ... }
   }
   ```

3. **Update the facade** (`src/account/index.ts`):
   - Remove `runtime.runPromise()` wrappers
   - Call the plain class directly
   - Keep the same public API (consumers don't change)

4. **Update tests**: Replace `testEffect` patterns with plain `async test`.

5. **Run tests**: Verify zero regressions.

**Order** (by dependency, leaves first):

1. `QuestionService` — simplest, no dependencies on other services
2. `PermissionService` — depends on config only
3. `AuthService` — HTTP client usage
4. `AccountService` — most complex, depends on Auth
5. Remove `src/effect/runtime.ts` and `effect` from package.json

**One service per PR.**

### Playbook 3: Tool Capability Annotation

**Goal**: Annotate all tools with `ToolCapabilities` declarations.

**Procedure**:

1. **List all tool definitions**:

   ```bash
   grep -rn 'Tool.define(' src/tool/
   ```

2. **For each tool**, add capabilities using the pre-defined profiles:

   ```typescript
   import { ToolProfiles, declareCapabilities } from "./capabilities"

   export const GrepTool = Tool.define("grep", {
     capabilities: ToolProfiles.fileReader,
     dependencies: { binaries: ["rg"] },
     // ... existing init/execute
   })
   ```

3. **Profile mapping**:
   | Tool | Profile | Dependencies |
   |------|---------|-------------|
   | grep, glob, ls, read | `fileReader` | `rg` (grep only) |
   | edit, write, patch, multiedit | `fileWriter` | — |
   | bash | `shellExecutor` | shell binary |
   | webfetch, websearch | `networkReader` | — |
   | plan, question, skill, task | `pure` | — |

4. **Run tests**: Verify zero regressions.

5. **Add a test** that verifies every registered tool has capabilities declared.

**Can be done in a single PR** since it's additive (no behavior changes).

## Development Methodology

### TDD/BDD Approach (MANDATORY)

All UI-visible changes MUST follow this process:

1. **Write a failing test FIRST** that defines the expected behavior
2. **Run the test** — confirm it fails (proves the test is valid)
3. **Fix the code** to make the test pass
4. **Run the test again** — confirm it passes
5. **Never claim something works without automated test validation**

### BDD Test Framework (Python pytest-bdd)

Behavior specs are in `tests/features/*.feature` (Gherkin format).
Step implementations in `tests/steps/*.py` using Playwright for Python.

```bash
# Install deps (one-time)
pip install -r tests/requirements.txt
playwright install chromium

# Run all BDD tests (requires app running on localhost:1420)
pytest tests/ -v

# Run smoke tests only
pytest tests/ -m smoke

# Run by domain
pytest tests/ -m provider
pytest tests/ -m desktop
pytest tests/ -m models
```

### Playwright E2E BDD Helpers (TypeScript)

BDD-style helpers in `packages/app/e2e/bdd/`:

- `given.ts` — Setup helpers (app state, provider config)
- `when.ts` — User action helpers (click, search, navigate)
- `then.ts` — Assertion helpers (see text, not see text, dialog visible)

### Test Layers

| Layer        | Framework  | Location                   | Validates             |
| ------------ | ---------- | -------------------------- | --------------------- |
| Unit         | bun test   | `packages/librecode/test/` | Logic, pure functions |
| Integration  | bun test   | `packages/librecode/test/` | Service interactions  |
| E2E (TS)     | Playwright | `packages/app/e2e/`        | UI flows              |
| BDD (Python) | pytest-bdd | `tests/`                   | User behavior specs   |

### When to Write Tests

- **New feature**: BDD feature file + implementation tests
- **Bug fix**: Failing test that reproduces the bug, then fix
- **UI change**: Playwright E2E test verifying visual correctness
- **Refactor**: Run existing tests before and after, add any missing coverage

### Validation Rules

- **NEVER say "it works" without running automated tests**
- **NEVER commit UI changes without E2E test coverage**
- **ALWAYS run `bun test` before committing**
- **ALWAYS update PLAN.md after completing work items**

## Quality Gates

Before any PR is merged:

1. **Tests pass**: `bun test --timeout 30000` — no new failures
2. **Coverage check**: `bun test --coverage` — no decrease in line coverage
3. **Type check**: `bun run typecheck` — zero errors
4. **Lint**: `bunx prettier --check .` — zero formatting issues
5. **Complexity**: No function with cyclomatic complexity > 12
6. **File size**: No file over 1,000 lines (flag for review if unavoidable)

## Package Structure

```
packages/
  librecode/    Core CLI agent (TypeScript, Bun, Effect-ts → migrating away)
    src/
      agent/      Agent definitions and registry
      cli/        CLI commands (yargs)
      config/     Configuration loading and paths
      mcp/        MCP server client
      permission/ Permission system
      provider/   LLM provider integration
        loaders/  Per-provider initialization (extracted)
      session/    Session state, messages, prompts
        prompt/   Extracted prompt templates
      storage/    SQLite + Drizzle ORM
      tool/       Tool definitions and registry
    test/         Unit tests (mirrors src/ structure)
    script/       Build and publish scripts
    migration/    Drizzle SQL migrations
  desktop/      Tauri desktop app (Rust + Solid.js)
  app/          Shared UI application (Solid.js)
  ui/           Component library
  sdk/          TypeScript SDK
  util/         Shared utilities (pure functions)
  plugin/       Plugin system types + tool factory
  script/       Monorepo build tooling
```
