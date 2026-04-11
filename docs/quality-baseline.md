# Code Quality Baseline

> Snapshot: 2026-04-10 | 94 commits | Biome 2.4.10
> Previous: 2026-04-08 (229 complexity violations, 1,244 warnings, 7 test failures)

---

## Test Health

| Metric         | Current | Previous | Delta  |
| -------------- | ------- | -------- | ------ |
| Passing        | 1,358   | 1,284    | +74    |
| Failing        | **0**   | 7        | **-7** |
| Skipped        | 9       | 0        | +9     |
| Test files     | 111     | ~100     | +11    |
| expect() calls | 2,926   | —        | —      |

---

## Lint Violations

| Rule                             | Current |   Previous |    Delta |
| -------------------------------- | ------: | ---------: | -------: |
| `noExcessiveCognitiveComplexity` |  **20** |        229 | **-209** |
| `noNamespace`                    |   **5** |        108 | **-103** |
| `noExplicitAny`                  |   **3** |        366 | **-363** |
| `noUnusedImports`                |   **0** |       ~100 | **-100** |
| `noUnusedVariables`              |   **1** |        ~50 |  **-49** |
| Other                            |      11 |       ~400 |        — |
| **Total**                        | **~40** | **~1,244** | **-97%** |

---

## Cognitive Complexity (max: 12)

20 functions exceed the limit. **All are in CLI commands and TUI components — the core engine has 1 violation** (bun/index.ts at 13).

### Critical (score >= 25)

| Score | File                                           | Category                |
| ----: | ---------------------------------------------- | ----------------------- |
|    82 | `cli/cmd/providers.ts:19`                      | CLI interactive command |
|    44 | `cli/cmd/pr.ts:19`                             | CLI PR command          |
|    43 | `cli/cmd/stats.ts:169`                         | CLI stats               |
|    40 | `cli/cmd/agent.ts:61`                          | CLI agent command       |
|    39 | `cli/cmd/providers.ts:272`                     | CLI provider OAuth      |
|    27 | `cli/cmd/import.ts:87`                         | CLI session import      |
|    27 | `cli/cmd/stats.ts:95`                          | CLI stats format        |
|    27 | `cli/cmd/tui/component/dialog-provider.tsx:40` | TUI dialog              |

### Moderate (score 13-24)

| Score | File                                         | Category                   |
| ----: | -------------------------------------------- | -------------------------- |
|    18 | `cli/cmd/stats.ts:309`                       | CLI                        |
|    16 | `cli/cmd/export.ts:20`                       | CLI                        |
|    16 | `cli/cmd/tui/component/dialog-status.tsx:19` | TUI                        |
|    15 | `cli/cmd/providers.ts:208`                   | CLI                        |
|    15 | `cli/cmd/tui/component/dialog-model.tsx:76`  | TUI                        |
|    13 | `bun/index.ts:53`                            | Core (only core violation) |
|    13 | 5 more CLI/TUI files                         | CLI/TUI                    |

### By Area

| Area           | Violations | Worst | Notes                     |
| -------------- | ---------- | ----: | ------------------------- |
| CLI commands   | 12         |    82 | Interactive prompts/menus |
| TUI components | 7          |    27 | Ink UI components         |
| Core engine    | 1          |    13 | bun package installer     |

---

## Oversized Files (>1000 lines)

| Lines | File                                     | Category | Action                          |
| ----: | ---------------------------------------- | -------- | ------------------------------- |
| 2,281 | `cli/cmd/tui/routes/session/index.tsx`   | TUI      | Split view sections             |
| 2,097 | `lsp/server.ts`                          | Core     | Protocol impl, hard to split    |
| 1,869 | `session/prompt.ts`                      | Core     | Already split once              |
| 1,732 | `provider/sdk/copilot/responses/...`     | Vendor   | Leaves with provider extraction |
| 1,729 | `acp/agent.ts`                           | Core     | Split by concern                |
| 1,647 | `cli/cmd/github.ts`                      | CLI      | Split subcommands               |
| 1,459 | `config/config.ts`                       | Core     | Split schema vs loader          |
| 1,171 | `cli/cmd/tui/component/prompt/index.tsx` | TUI      | Split by section                |
| 1,152 | `cli/cmd/tui/context/theme.tsx`          | TUI      | Data file, low priority         |
| 1,062 | `session/message-v2.ts`                  | Core     | Type defs, low priority         |
| 1,023 | `server/routes/session.ts`               | Core     | Split route handlers            |
| 1,004 | `provider/transform.ts`                  | Core     | Split by transform type         |

---

## Run These Checks

```bash
# Complexity violations
bunx biome lint --only=complexity/noExcessiveCognitiveComplexity

# All lint issues
bunx biome lint

# Full test suite
cd packages/librecode && bun test --timeout 30000

# Type checking
bun run typecheck

# File sizes over 1000 lines
find packages/librecode/src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | awk '$1 > 1000'
```
