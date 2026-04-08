# ADR-001: Effect-ts Strategy

**Status:** Accepted
**Date:** 2026-04-07
**Decision:** Migrate away from Effect-ts toward plain async/await with manual DI

---

## Context

The codebase inherited from opencode v1.2.27 uses Effect-ts in a narrow, hybrid pattern:

| Metric | Value |
|--------|-------|
| Total src files | 332 |
| Files using Effect patterns | 23 (7%) |
| Core Effect service definitions | 6 |
| Facade wrapper files (Effect→Promise bridge) | 5 |
| Tests using Effect | 3 of 109 (3%) |
| Lines in Effect service files | ~1,066 (~2% of src) |
| `InstanceState` usages (scoped cache) | 27 |

Effect is used as a **DI container** for 4 services (Account, Auth, Permission, Question) and for **scoped resource caching** (`InstanceState`). It is NOT used for:
- Core data flow (sessions, providers, tools all use plain async)
- Error handling strategy (Zod + NamedError pattern is dominant)
- Streaming/reactive patterns
- Testing (98% of tests are plain async)

## Problem

The hybrid approach creates friction:

1. **Facade tax**: 5 files exist solely to convert `Promise → Effect → Promise`. Every service call crosses two abstraction barriers for zero observable benefit at the call site.

2. **Dual testing paradigm**: 3 test files need `testEffect` + layer setup; 107 use plain `async/test`. Contributors must learn two patterns.

3. **Knowledge tax**: Developers must understand Effect generators, layers, services, and scoped resources to modify 6 files, while 99% of the codebase uses standard TypeScript.

4. **Limited ecosystem leverage**: Only the core `effect` package is imported. No `@effect/platform`, `@effect/schema`, etc. Effect's major value proposition (a complete functional runtime) is unused.

## Decision

**Migrate away from Effect-ts.** Replace with plain async/await + constructor-based DI.

### Rationale

- Effect provides genuine value for **two** things in this codebase: scoped caching (`InstanceState`) and HTTP client composition. Both can be replicated with simpler abstractions.
- The 98% of code that doesn't use Effect shouldn't pay the cognitive cost of the 2% that does.
- New contributors should be able to understand any file with standard TypeScript knowledge.
- The facade boilerplate is a code smell — if every Effect service immediately wraps back into Promises, Effect isn't earning its keep.

### What we're NOT saying

- Effect-ts is a bad library. It's excellent for Effect-heavy codebases.
- This codebase should never have used it. The original authors had valid reasons.
- We're removing it immediately. This is a gradual migration.

## Migration Plan

### Phase A: Replace facades with plain classes

Convert each service from:
```typescript
// Effect pattern (current)
const AccountService = ServiceMap.Service<typeof AccountService, AccountService.Service>()
export const defaultLayer = Layer.effect(AccountService, Effect.gen(function* () { ... }))

// Facade (current)
export namespace Account {
  export async function get(id: string) {
    return runtime.runPromise(AccountService.use(s => s.get(id)))
  }
}
```

To:
```typescript
// Plain class
class AccountServiceImpl {
  constructor(private repo: AccountRepo, private http: HttpClient) {}
  async get(id: string): Promise<Account | undefined> { ... }
}

// Singleton with lazy init
export const Account = {
  async get(id: string) {
    return getService().get(id)
  }
}
```

**Files affected:** 6 services + 5 facades = 11 files

### Phase B: Replace InstanceState with Promise-based cache

Create a simple `ScopedCache<K, V>` utility:
```typescript
class ScopedCache<K, V> {
  private cache = new Map<K, V>()
  async get(key: K, init: () => Promise<V>): Promise<V> { ... }
  invalidate(key: K): void { ... }
  dispose(): void { ... }
}
```

**Files affected:** ~27 usages of `Instance.state()`

### Phase C: Remove Effect dependency

- Remove `effect` from package.json
- Remove `@effect/language-service` from devDependencies
- Remove `src/effect/runtime.ts`
- Update 3 test files to use plain async

### Ordering

Phase A → Phase B → Phase C, each as a separate PR. Phase A is safe to do first since facades already expose Promise-based APIs — consumers don't change.

## Consequences

### Positive
- Single async paradigm across the entire codebase
- No facade boilerplate (5 files removed)
- Lower barrier for contributors
- Simpler testing (one pattern)
- Reduced bundle size (effect package removed)

### Negative
- Lose Effect's tracing/span names (low impact — not used in production monitoring)
- Lose typed error channels (mitigated by existing NamedError pattern)
- Must manually handle scoped resource cleanup (mitigated by ScopedCache utility)
- Migration effort (~27 InstanceState usages + 11 service/facade files)

### Neutral
- HTTP client composition moves to a thin wrapper or uses fetch directly
- DI becomes constructor injection (already the pattern in 99% of code)
