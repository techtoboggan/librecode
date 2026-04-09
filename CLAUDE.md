# LibreCode Development Guide

> This file is read by AI coding agents (Claude Code, Cursor, etc.) when working on
> this repository. It defines coding standards, architectural constraints, and migration
> playbooks that MUST be followed.

## Project Overview

LibreCode is a fork of opencode v1.2.27 — an AI-powered terminal coding agent. TypeScript
monorepo using Bun runtime, Effect-ts (being migrated away), Solid.js UI, Tauri desktop.

**Key files:**
- `PLAN.md` — master roadmap with phase tracking
- `docs/adr/` — architecture decision records
- `docs/architecture.md` — system architecture reference
- `docs/development.md` — full local dev guide
- `assets/brand/DESIGN-SPEC.md` — brand asset generation guide

## Local Development

```bash
# Set up isolated dev environment (all data in .dev/, not ~/.local/share)
source scripts/dev-setup.sh

# CLI dev
bun install
bun run dev                              # run CLI in dev mode

# Desktop dev (needs Rust + GTK + WebKit)
nix develop .#desktop                    # provides all Tauri deps
bun run dev:desktop                      # builds CLI sidecar + Tauri window

# See docs/development.md for full guide including Fedora/Ubuntu deps
```

## Commands

```bash
bun install                              # install deps
bun run dev                              # run CLI in dev mode
bun run dev:desktop                      # run desktop app (Tauri)
bun run dev:web                          # run web UI only
bun run typecheck                        # typecheck all packages
bun run lint                             # biome linter (complexity, namespaces, any)
bun test                                 # run all tests (from packages/opencode)
bun test --timeout 30000                 # with timeout for slow tests
bun test --coverage                      # with line coverage
cd packages/util && bun test             # test a single package
cd packages/opencode && bun test test/config/  # test a directory
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
- **Path aliases**: `@/` maps to `packages/opencode/src/` — use it for internal imports.
- **No `export namespace`** in new code. Use regular module exports. Existing namespaces
  are being migrated (see Migration Playbook 1).

### Testing

- **Test runner**: `bun test` (built-in, not vitest/jest)
- **File pattern**: `*.test.ts` colocated with source or in `test/` directory
- **Coverage baseline** (as of 2026-04-08):
  - packages/opencode: 72% lines, 62% functions
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

### Effect-ts (ADR-001: migrating away)
- **Do NOT add new Effect usage.** All new services must use plain async/await.
- **Do NOT import from `effect` in new files.**
- Existing Effect services (Account, Auth, Permission, Question) will be migrated
  to plain classes per ADR-001. See Migration Playbook 2.

### Namespace Pattern (migrating away)
- **Do NOT use `export namespace` in new code.** Use regular module exports.
- Existing namespaces (Provider, SessionPrompt, Session, MessageV2) will be converted.
  See Migration Playbook 1.

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
   Provider.list()  // still works
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
  opencode/     Core CLI agent (TypeScript, Bun, Effect-ts → migrating away)
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
