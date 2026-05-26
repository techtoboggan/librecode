# ADR-010: Three-Layer Test Architecture

**Status**: Accepted (Phase 52, v0.9.98 → v0.10.0)

---

## Context

Through Phases 42–52 the LibreCode UI grew significantly: App Dock, MCP
apps, detachable Tauri windows, telemetry, a11y. Testing kept pace via
800+ unit tests but each major release surfaced bugs unit tests missed:

| Version     | Bug                                      | Why automated tests missed it                                                                                                                                                |
| ----------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.9.91→.94 | Dock invisible after Phase 48 fix        | Unit tests asserted `defaultDockState().visibility === "visible"` but the migration honored persisted `"hidden"`. No test simulated the upgrade path with real localStorage. |
| v0.9.94     | Timeline "TypeError: Load failed"        | `fetchActivity` used raw `fetch()` not `globalSDK.fetch`. No test ran with `LIBRECODE_SERVER_PASSWORD` set — the production desktop configuration.                           |
| v0.9.95     | Dock off-screen (x:1279, w:320, vp:1280) | Smoke ran at 710px viewport (mobile codepath). Dock eval returned `display: "flex"` (passed). Never screenshotted at desktop viewport where overflow is visible.             |
| v0.9.95     | 4 raw fetch sites silently broken        | Auth bypass class of bug. No systematic test for "every API call through the authed fetch wrapper."                                                                          |
| Phase 49    | Detach unverifiable                      | No automation path reaches the real Tauri webview. Manual smoke gets skipped.                                                                                                |

**The pattern**: every bug followed the same shape — unit tests passed
(isolation), web preview missed it (wrong viewport or no Tauri path), CI
passed (doesn't run the real product against a real user flow). User
reports it. Days of fix-forward.

**The fix**: don't add more unit tests. Add a layer that catches the class
of bugs unit tests can't reach, and make running that layer non-negotiable.

---

## Decision

Adopt a three-layer testing architecture. Each layer has a clear scope
and clear ownership of which bug class it catches.

### Layer 1 — Component / Unit Tests (`bun test`)

- **Scope**: pure functions, predicates, reducers, type guards, component
  logic.
- **Speed**: <2s for the full suite.
- **Tauri API mocking**: when a component branches on Tauri state, use
  the `Platform` context mock helper (`packages/app/src/test-utils/tauri-mock.ts`).
  This wraps all Tauri calls through the Platform abstraction rather than
  calling `@tauri-apps/api` directly (see ADR-010 §Layer 1 note).
- **Isolation**: tests use `test/preload.ts` temp dirs; never touch real
  user data or real network.
- **Catches**: logic regressions, state machine bugs, pure helper bugs,
  Zod schema parsing, migration edge cases.
- **Misses**: real CSS layout, real Tauri runtime, multi-window flows,
  native auth paths.

### Layer 2 — Web Preview Smoke (`Claude_Preview` MCP)

- **Scope**: real Solid.js app served by `bun run dev:web` + librecode
  CLI backend, driven by the `Claude_Preview` MCP tools.
- **Speed**: 15–30 seconds per smoke run.
- **Mandatory rules** (v0.9.97+):
  - `preview_resize` to desktop viewport (1280×800) before any assertion.
  - At least one `preview_screenshot` per visible state change.
  - Follow `docs/plans/preview-smoke-template.md` exactly.
- **Catches**: layout overflow (the v0.9.95 dock overflow bug), render
  bugs, real route flows, auth errors in web mode.
- **Misses**: Tauri IPC commands, native multi-window, native rendering
  artifacts, production auth path (requires Tauri desktop with
  `LIBRECODE_SERVER_PASSWORD` set).

### Layer 3 — Tauri E2E (`tauri-playwright`)

- **Scope**: real Tauri build with `e2e-testing` cargo feature enabled,
  Playwright driving the real native webview via socket bridge.
- **Speed**: ~30s for browser mode (CI gate); ~3–5min for tauri mode
  (real webview, pre-release).
- **Security constraint**: `tauri-plugin-playwright` MUST be
  `optional = true` in `Cargo.toml` and MUST NOT appear in `[features]
default`. The CI security gate in `e2e.yml` verifies this on every run.
- **Catches**: Tauri IPC correctness, multi-window, CSP enforcement,
  native rendering artifacts, real auth in Tauri mode.
- **Misses**: cross-platform visual differences (Linux-only initially).

---

## Implementation

### Layer 1 helper

```
packages/app/src/test-utils/tauri-mock.ts
```

`createMockPlatform(overrides)` returns a Platform object with all
Tauri-specific methods as no-ops. Tests that need specific IPC behaviour
pass overrides:

```typescript
import { createMockPlatform } from "@/test-utils/tauri-mock"
const platform = createMockPlatform({
  openDetachedWindow: vi.fn().mockResolvedValue(undefined),
})
```

### Layer 3 fixture

```
packages/app/e2e/fixtures/tauri.ts
```

Exports a `tauriPage` Playwright fixture backed by a raw `Page` with
Tauri IPC mocks injected via `addInitScript` (using
`generateIpcMockScript` from `@srsholmes/tauri-playwright`). The fixture
does NOT navigate during setup — each test calls `goto()` itself.

Key deviation from `createTauriTest` (the library's built-in factory):
the built-in fixture calls `waitForLoadState("networkidle")` during
setup, which never fires because LibreCode maintains a live SSE connection
to the backend. Our custom fixture avoids this by not navigating in setup
and using `waitForLoadState("load")` in individual tests.

### tauri-plugin-playwright version pin

```toml
tauri-plugin-playwright = { version = "=0.2.2", optional = true }
```

Pinned to exact version (not `^0.2`) because the plugin is community-
maintained (0.2.x) and minor-version API breaks have occurred.

### Security rules (all five must be verifiable in every PR)

1. `Cargo.toml`: `optional = true` — plugin cannot compile into production
   binary unless explicitly requested.
2. `lib.rs`: plugin init wrapped in `#[cfg(feature = "e2e-testing")]`.
3. Capability file (`e2e-testing-capability.json`) lives OUTSIDE
   `capabilities/` so `tauri_build` does not auto-discover it on
   non-feature builds.
4. `build.rs`: copies the capability file into `capabilities/` only when
   `CARGO_FEATURE_E2E_TESTING` is set; removes it otherwise.
5. CI (`e2e.yml`): verifies `optional = true` and no `default` feature
   listing on every release run.

---

## Test placement decision tree

```
New code → does it call a Tauri API?
├─ No → does it have a visible UI surface?
│  ├─ No  → Layer 1 unit test only
│  └─ Yes → Layer 1 unit test + Layer 2 smoke
└─ Yes → Layer 1 (with tauri-mock) + Layer 3 E2E
```

## Regression rule

Every bug fix MUST land with a regression test in the appropriate layer.
The PR description must explicitly say:

> "This regression would have been caught by Layer N if the test had
> existed pre-fix."

---

## Consequences

### Positive

- **Systematic bug coverage**: each layer has a clear scope with no gaps.
- **Early detection**: failed releases caught at smoke time, not by users.
- **Tauri-specific flows testable**: detach, IPC, native auth for the
  first time.
- **Clear contract**: the decision tree answers "where does this test go?"

### Negative

- **CI cost**: +4 minutes on the release critical path (browser mode
  gate only; tauri mode is non-blocking until Phase 53).
- **Maintenance**: 3 test rigs instead of 1.
- **`tauri-plugin-playwright` is community-maintained**: 0.2.x; pinned to
  exact version to avoid API breaks.
- **Linux-only Layer 3 initially**: cross-platform deferred to Phase 53.
- **Tauri mode not yet wired in CI**: the socket bridge fixture
  (`TauriProcessManager`) is Phase 53 scope; browser mode is the current
  gate.

---

## Alternatives considered

| Option                                | Why not                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Official `tauri-driver` + WebdriverIO | WebKit driver flaky, WebdriverIO API less familiar than Playwright, no good macOS support on Linux CI |
| Skip Layer 3, rely on Layer 2         | Misses Tauri-specific bugs that already shipped (the v0.9.94 auth bypass, Phase 49 detach)            |
| Visual regression / screenshot diff   | Useful but separate scope; can layer on later without changing the architecture                       |
| `tauri-pilot` CLI                     | a11y-tree based; good for record-replay debug but not a CI primary (no structured assertions)         |

---

## References

- Phase 52 spec: `docs/plans/phase-52-spec.md`
- Smoke template: `docs/plans/preview-smoke-template.md`
- Tauri WebDriver docs: https://v2.tauri.app/develop/tests/webdriver/
- tauri-playwright: https://github.com/srsholmes/tauri-playwright
- Related: ADR-006 (Suspense/startTransition), ADR-009 (App Dock)
