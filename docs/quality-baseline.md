# Code Quality Baseline

> Snapshot taken 2026-04-08. Used to track improvement over time.
> Run `bun run quality` to get current numbers.

## Test Coverage

| Package | Lines | Functions | Tests | Source Files | Pass Rate |
|---------|-------|-----------|-------|-------------|-----------|
| librecode | 72.4% | 61.9% | 1,284 | 333 | 99.5% (7 env failures) |
| util | 98.5% | 97.1% | 73 | 12 | 100% |
| plugin | — | — | 3 | 4 | 100% |
| app | — | — | 99 (e2e) | 175 | — |

**Targets for new/modified code:**
- New files: 80% line coverage minimum
- Modified files: coverage must not decrease
- Utility/pure functions: 95%+ target

## Lint Violations (biome)

| Rule | Count | Severity | Target |
|------|-------|----------|--------|
| `noExcessiveCognitiveComplexity` (>12) | 229 | warn | Reduce to 0 over time |
| `noNamespace` | 108 | warn | 0 after namespace migration |
| `noExplicitAny` | 366 | warn | Reduce by 50% |
| `noUnusedImports` | ~100 | warn | 0 |
| `noUnusedVariables` | ~50 | warn | 0 |
| Total errors | 143 | error | 0 |
| Total warnings | 1,244 | warn | < 500 |

## Complexity Hotspots

The 229 complexity violations are concentrated in:
- `src/session/prompt.ts` — the main agent loop
- `src/provider/provider.ts` — provider state initialization
- `src/provider/transform.ts` — LLM API transforms
- `src/session/message-v2.ts` — message parsing/serialization
- `src/config/config.ts` — config loading with many fallbacks
- `src/cli/cmd/` — CLI command handlers

## How to Check

```bash
# Full lint
bun run lint

# Quick summary
bun run quality

# Coverage
cd packages/librecode && bun test --timeout 30000 --coverage

# Complexity only
bunx biome lint . --max-diagnostics=5000 2>&1 | grep noExcessiveCognitiveComplexity | wc -l
```

## Tracking Improvement

When completing migration work (namespace removal, Effect removal, tool annotations),
update this file with new baselines. The goal is monotonic improvement:
- Each PR should reduce violations or hold steady
- Never introduce new complexity > 12 violations
- Never introduce new `export namespace` usage
- Never introduce new `any` types without justification
