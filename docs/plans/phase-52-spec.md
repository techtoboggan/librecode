# Phase 52 — Testing Architecture Overhaul

> Self-contained execution spec for the next Sonnet worker.
> Phase 52 of the LibreCode evolution — **inserted BEFORE Phase 51**
> because the overhaul wrap-up docs (Phase 51) need to reflect the
> final test architecture this phase establishes.
> Spans **v0.9.98 → v0.10.0** (4 sub-phases, each shipping an
> independent usable patch).
>
> **Why this exists as a phase**: Tristan reported on v0.9.95 that
> the dock was rendering off-screen, the Timeline tab crashed with
> "TypeError: Load failed", and the edge handle "just disappeared"
> when clicked. Investigation revealed those weren't isolated bugs
> — they were the consequence of a systemic gap in how we verify
> changes:
>
> - Unit tests asserted DOM properties without running real layout
> - Smoke tests ran in a 710×710 viewport that hit the mobile
>   codepath (different from production)
> - No automated path could reach native Tauri behavior (multi-
>   window, real WebKit rendering, CSP enforcement)
> - Auth-header bugs lurked in 5 separate places (Phase 17's
>   activity-grid plus 4 others) because we never tested with
>   `LIBRECODE_SERVER_PASSWORD` set, which is the production
>   desktop configuration
>
> The result: real bugs shipping to a real user, fix-forwards
> consuming days, and trust in the release pipeline degraded.
> Phase 52 closes the gap by establishing a **three-layer testing
> stack** with a clear contract for which layer catches which
> class of bugs.

---

## 0. Why this phase exists (in detail)

The bugs that proved the testing gap is real:

| Version     | Bug                                                                                   | Why automated tests missed it                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.9.91→.94 | Dock invisible despite Phase 48 fix                                                   | Unit tests asserted `defaultDockState().visibility === "visible"` but migration honored persisted `"hidden"`. No test simulated the upgrade path with real localStorage.                                        |
| v0.9.94     | Timeline "TypeError: Load failed"                                                     | `fetchActivity` used raw `fetch()` not `globalSDK.fetch`. No test ran with `LIBRECODE_SERVER_PASSWORD` set — desktop production config.                                                                         |
| v0.9.95     | Edge handle click → dock off-screen                                                   | Smoke ran at 710px viewport (mobile codepath). Dock-visibility eval returned `display: "flex"` (passed). Never screenshotted at desktop viewport (1280×800) where the dock+side-panel overflow becomes visible. |
| v0.9.95     | 4 other raw fetch sites silently broken                                               | Class of bug: auth path bypass. No systematic test for "every API call goes through the authed fetch wrapper."                                                                                                  |
| Pre-v0.9.91 | mcp_apps `experimental.app_dock` default flip didn't surface dock for upgrading users | Same root: no upgrade-path test with prior persisted state.                                                                                                                                                     |
| Phase 49    | Tauri detach unverifiable                                                             | No automation path reaches real Tauri webview. Manual smoke gets skipped.                                                                                                                                       |

**The pattern**: every bug followed the same shape — unit tests passed (because they tested the unit in isolation), web preview missed it (because it ran in wrong viewport or didn't use real Tauri), CI passed (because it doesn't run the real product against a real user flow). User reports it. Days of fix-forward.

**The fix**: don't add more unit tests. Add a layer that catches the class of bugs unit tests can't reach, and make running that layer non-negotiable.

---

## 1. Done-state walkthrough

After Phase 52 ships (across v0.9.98–v0.10.0):

### 1.1 Three-layer testing stack

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Component / unit tests (bun test, 861 today)           │
│ • Pure helpers, predicates, reducers                            │
│ • + Tauri mockIPC for components that branch on Tauri APIs (NEW)│
│ • Fast (~1s suite), runs on every PR                            │
│ • Catches: logic bugs, regression of fixed helpers              │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: Web preview smoke (Claude_Preview, EXISTING + HARDENED)│
│ • Real SolidJS app served via dev:web + librecode-cli backend   │
│ • Desktop viewport (1280×800) MANDATORY                         │
│ • Screenshots MANDATORY at baseline + after each state change   │
│ • Catches: layout overflow, render bugs, real route flows       │
│ • Speed: ~15-30s per smoke                                      │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: Tauri E2E via tauri-playwright (NEW)                   │
│ • Real native webview (WebKitGTK / WebView2 / WKWebView)        │
│ • Plugin embedded behind `e2e-testing` cargo feature only       │
│ • Single Playwright API; three execution modes                  │
│ • Catches: Tauri IPC, multi-window, CSP, native rendering       │
│ • Speed: ~3-5 min per suite                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Layer 3 specifically — what's possible after Phase 52

The Playwright test file:

```ts
// e2e/tauri/dock.spec.ts
import { test, expect } from "../fixtures/tauri"

test("dock fits inside viewport on desktop", async ({ tauriPage }) => {
  await tauriPage.goto("/session/test-session")
  const dock = tauriPage.locator('[data-testid="app-dock"]')
  await expect(dock).toBeVisible()
  const box = await dock.boundingBox()
  const viewport = tauriPage.viewportSize()!
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
})

test("detach button opens second Tauri window (Phase 49)", async ({ tauriContext, tauriPage }) => {
  await tauriPage.goto("/session/test-session")
  await tauriPage.click('[data-testid="pane-detach-ui://multica/board"]')
  await tauriContext.waitForEvent("page", { timeout: 5000 })
  const pages = tauriContext.pages()
  expect(pages.length).toBe(2)
  await expect(pages[1].locator('[data-testid="detached-app-shell"]')).toBeVisible()
})
```

Three execution modes from the same file:

| Mode      | Command                           | What it runs                          | When to use                   |
| --------- | --------------------------------- | ------------------------------------- | ----------------------------- |
| `browser` | `bun run test:e2e --mode browser` | Chromium headless + mocked Tauri IPC  | Every PR in CI (fast)         |
| `tauri`   | `bun run test:e2e --mode tauri`   | Real native webview via socket bridge | Pre-release in CI on Linux    |
| `cdp`     | `bun run test:e2e --mode cdp`     | WebView2 direct CDP                   | Windows manual smoke (future) |

### 1.3 CI integration

New GitHub Actions workflow (`e2e.yml`) added to the master release orchestrator:

- Runs on Linux only initially (Windows + macOS deferred to Phase 53).
- Installs `webkit2gtk-driver`, `libwebkit2gtk-4.1-dev`, `xvfb` (per Tauri's official CI guide).
- Builds the desktop app with `--features e2e-testing` enabled.
- Runs the Playwright suite under `xvfb-run`.
- Uploads screenshots + traces on failure as artifacts.

The existing `release.yml` orchestrator gains a new gate: **the e2e job must pass before binaries get built**. This adds ~4 minutes to the critical path but eliminates the "shipped a bug a screenshot would've caught" class.

### 1.4 Smoke template alignment

The preview-smoke template (`docs/plans/preview-smoke-template.md`) now references all three layers and documents which class each catches. The "MANDATORY screenshot" rule established in v0.9.97 stays; new rules added: "MANDATORY mockIPC test for components calling Tauri APIs" and "MANDATORY Layer-3 test for any multi-window or platform-specific flow."

### 1.5 ADR-010 ratified

New ADR documenting the test architecture: layer boundaries, what belongs where, when to skip a layer, how to add a new app/feature. Replaces the implicit "just write a unit test" pattern.

---

## 2. Scope

### Sub-A: Layer 2 hardening + regression backfill (PRIMARY — ship first)

The fastest-value piece. Codifies what we've already done ad-hoc and adds tests for the 5 production bugs we hit so they can never silently regress.

**In scope:**

- Extend `docs/plans/preview-smoke-template.md` (already updated in v0.9.97; add a "regression coverage" section listing the bugs Layer 2 must catch).
- Add explicit regression tests for the 5 fixed bugs (mock-IPC + DOM, runnable in `bun test`):
  - `dock-visibility-upgrade.test.ts` — covers the v0.9.91→.94 stale-hidden migration upgrade.
  - `fetch-auth-audit.test.ts` — covers every `globalSDK.fetch` call site with a "401 → throws" assertion.
  - `dock-layout-fits.test.ts` — render dock + side panel at JSDOM-faked 1280×800, assert no rect extends past the viewport.
  - `dock-edge-handle.test.ts` — predicate already tested; add an integration test that clicks the handle and verifies dock state updates.
  - `narrow-viewport-gate.test.ts` — verifies `<Show when={isDesktop()}>` correctly hides AppDock when `isDesktop()` returns false.
- Document the regression test pattern in CLAUDE.md ("for every fixed bug, add a regression test in the same PR — see Phase 52 §Sub-A for examples").
- Version: v0.9.98.

**Out of scope:**

- Cross-platform regression tests (we only run Linux in CI today).
- E2E regression in Layer 3 — those land in Sub-C.

### Sub-B: Layer 1 mockIPC additions

Add `@tauri-apps/api/mocks` to existing unit tests for components that have Tauri-specific branches.

**In scope:**

- New helper: `packages/app/src/test-utils/tauri-mock.ts` — wraps `mockIPC` + `mockWindows` + `clearMocks` with sensible defaults for librecode's command set (e.g. preconfigured no-op responses for `await_initialization`, `get_default_server_url`).
- Adopt the helper in 5+ existing tests that currently mock-Solid-context Tauri calls manually:
  - `app-dock/use-dock-state.test.tsx` — verify `dock.detach(uri)` invokes the right Tauri command.
  - `pages/detached/detached-app.pure.test.ts` — `onReattach` invokes `dock.reattach` IPC event.
  - `mcp-app-panel.handlers.test.ts` — state-relay save observation triggers callback.
  - Two more identified during execution.
- Document `tauri-mock` helper in `docs/architecture.md` under "Testing layers."
- Version: v0.9.99.

**Out of scope:**

- Real Tauri runtime — that's Layer 3.

### Sub-C: Layer 3 — tauri-playwright integration (BIG — half-day)

Embed the plugin, wire the npm side, write the first 5 E2E tests covering the most-critical user flows.

**In scope:**

- Cargo: `tauri-plugin-playwright = { version = "0.2", optional = true }` + `e2e-testing` feature.
- Rust: plugin initialization gated on `#[cfg(feature = "e2e-testing")]` in `packages/desktop/src-tauri/src/lib.rs`.
- Capabilities: new `playwright:default` permission in `capabilities/default.json` ONLY when the feature is active (use a separate `e2e-testing-capabilities.json` that's conditionally included).
- npm: `@srsholmes/tauri-playwright` + `@playwright/test` as dev dependencies of `packages/app` (not `packages/librecode` — keep desktop-only deps there).
- Test fixtures: `packages/app/e2e/fixtures/tauri.ts` with `createTauriTest` configured for librecode's `devUrl` + standard ipcMocks for unauth-state.
- 5 initial tests in `packages/app/e2e/tauri/`:
  - `dock-fits.spec.ts` — viewport overflow regression (the v0.9.95 bug, in Tauri now).
  - `dock-toggle-cycle.spec.ts` — open → hide → edge-handle → re-open round trip.
  - `timeline-auth.spec.ts` — Timeline tab loads without "TypeError: Load failed" with `LIBRECODE_SERVER_PASSWORD` set.
  - `detach-flow.spec.ts` — Phase 49 multi-window detach + re-attach end-to-end.
  - `provider-scan-auth.spec.ts` — verify all 5 raw-fetch-audited endpoints work with auth.
- npm script: `"test:e2e": "playwright test --config=e2e/playwright.config.ts"` in `packages/app/package.json`.
- `playwright.config.ts` configured for the three modes; default mode is `browser` for fast local iteration, `tauri` for pre-release.
- Version: v0.9.100 (or skip to v0.10.0 if user wants).

**Out of scope:**

- CI integration — that's Sub-D.
- macOS testing — no good Linux→macOS automation path; deferred.
- Visual regression / screenshot diffing — separate phase if needed.

### Sub-D: CI integration

Wire Layer 3 into the master release orchestrator.

**In scope:**

- New workflow: `.github/workflows/e2e.yml` triggered as `workflow_call` from `release.yml`.
- Linux ubuntu-latest runner.
- Install apt deps: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev webkit2gtk-driver xvfb`.
- Cache cargo + bun deps.
- Build desktop with `bun --cwd packages/desktop run tauri build -- --features e2e-testing --no-bundle`.
- Run `xvfb-run bun --cwd packages/app run test:e2e --mode tauri`.
- Upload `playwright-report/` and `test-results/` as artifacts on failure.
- Modify `release.yml` to gate binary builds on the e2e job (`needs: [e2e]`).
- Version: v0.10.0 (the major bump reflects the foundational CI change).

**Out of scope:**

- Cross-platform matrix (Windows + macOS) — Phase 53.
- Parallel sharding — single shard is enough for the initial test count.

### Sub-E: Documentation + ADR

Permanent documentation of the architecture so future contributors don't have to reverse-engineer it.

**In scope:**

- New: `docs/adr/0010-test-architecture.md` — three-layer model, what belongs where, when to add a new layer.
- Update: `docs/architecture.md` — testing section rewritten around the three layers.
- Update: `CLAUDE.md` — testing section under "Coding Standards" rewritten to reference the layers and require regression tests for bug fixes.
- Update: `docs/development.md` — section on running each layer locally.
- Update: `docs/plans/preview-smoke-template.md` — final pass to align with the three-layer terminology.
- Update: `PLAN.md` — Phase 52 entry under "v0.9.x Continued."
- Ships in the same commit as Sub-D's CI integration.

---

## 3. Constraints

### CLAUDE.md non-negotiables

- No semicolons (TS), 120-char width, named exports, explicit return types.
- TypeScript strict — no `any`. Test fixtures use proper Playwright types.
- Rust: follow existing `windows.rs` / `app_window.rs` style.
- File length ≤ 500. The new test files should each be focused on one user flow.
- TDD applies: for each regression test, demonstrate it FAILS against the pre-fix commit before showing it passes against current main. (You don't need to actually check out the old commit; reason about it in the commit message.)

### Security: don't ship the playwright plugin in production

The `tauri-plugin-playwright` exposes a debug interface that runs arbitrary JavaScript inside the webview. **It MUST NOT be present in production builds.**

Hard rules:

1. The plugin dependency in `Cargo.toml` MUST be `optional = true` and gated under the `e2e-testing` feature.
2. The plugin init in `lib.rs` MUST be wrapped in `#[cfg(feature = "e2e-testing")]`.
3. Capabilities for the plugin MUST live in a separate file that's only included via build script when the feature is active.
4. Release CI MUST verify that production builds (`bun run release:desktop` or whatever the prod path is) do NOT pass `--features e2e-testing`. Add a grep-based check in CI.
5. The README / ADR-010 MUST explicitly document this constraint.

If you can't see all 5 of these in the diff at PR review time, the PR doesn't ship.

### CI cost budget

The e2e job adds ~4 minutes to release pipeline. Acceptable. If it ever exceeds 8 minutes, split into a separate pre-release job that runs against the merge queue, not every push.

### Existing test suite must keep passing

861 tests today. Sub-A's regression backfill ADDS to this; nothing in this phase changes existing assertions. If any existing test breaks, that's a regression — fix the regression, don't update the assertion.

### Carry-forward from previous phases

- **Zod v4 `.default()` makes optional required** (Phase 48). Not directly relevant here, but the test config might add Zod schemas — be aware.
- **Specta bindings regenerate broken** (Phase 49). Don't run `cargo test` without `LIBRECODE_REGEN_BINDINGS=0`. The gate is in place.
- **Root-level typecheck is the gate** (Phase 49). Run from repo root, not package-scoped.
- **SDK version must be bumped in sync with everything else** (carried forward from Phase 50b — Sonnet shipped a `chore: fix sdk version` commit because the SDK was missed in the previous bump). Add explicit check.
- **MANDATORY screenshot at every layer-2 smoke state change** (v0.9.97).

---

## 4. Files to create

### 4a. `packages/app/src/test-utils/tauri-mock.ts` — NEW (Sub-B)

```ts
import { mockIPC, mockWindows, clearMocks } from "@tauri-apps/api/mocks"

/**
 * Sensible default mock-IPC setup for librecode unit tests.
 *
 * Provides no-op responses for the Tauri commands librecode mounts at
 * startup (await_initialization, get_default_server_url, etc.) so tests
 * don't have to enumerate them. Per-test specific commands can be
 * layered on via the `commands` map.
 *
 * Usage:
 *   import { setupTauriMock, teardownTauriMock } from "@/test-utils/tauri-mock"
 *
 *   beforeEach(() => setupTauriMock({
 *     open_detached_app_window: () => ({ ok: true }),
 *   }))
 *   afterEach(() => teardownTauriMock())
 */
export interface TauriMockOptions {
  /** Per-command handlers. Overrides defaults. */
  commands?: Record<string, (args: unknown) => unknown>
  /** Window labels to simulate. Defaults to ["main"]. */
  windows?: string[]
}

const DEFAULT_COMMANDS: Record<string, (args: unknown) => unknown> = {
  await_initialization: () => null,
  get_default_server_url: () => null,
  get_wsl_config: () => ({ enabled: false }),
  get_display_backend: () => "auto",
  check_app_exists: () => false,
  resolve_app_path: () => null,
}

export function setupTauriMock(options: TauriMockOptions = {}): void {
  const commands = { ...DEFAULT_COMMANDS, ...(options.commands ?? {}) }
  mockIPC((cmd, args) => {
    const handler = commands[cmd]
    if (!handler) {
      throw new Error(`[tauri-mock] no handler registered for "${cmd}"`)
    }
    return handler(args)
  })
  mockWindows(...(options.windows ?? ["main"]))
}

export function teardownTauriMock(): void {
  clearMocks()
}
```

### 4b. `packages/app/src/components/app-dock/dock-visibility-upgrade.test.ts` — NEW (Sub-A)

Regression test for v0.9.91→.94. Uses pure-state functions; no DOM needed.

```ts
import { describe, expect, test } from "bun:test"
import { migrateDockState } from "./state"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

const SAMPLE: McpAppResource = { server: "__builtin__", name: "Stats", uri: "ui://x" }
const entry = { uri: SAMPLE.uri, addedAt: 1, app: SAMPLE }

describe("v0.9.91→.94 dock-visibility upgrade regression", () => {
  test("user upgrading from <v0.9.91 with hidden+entries sees dock automatically", () => {
    const persisted = { visibility: "hidden", width: 320, entries: [entry] }
    const migrated = migrateDockState(persisted)
    expect(migrated.visibility).toBe("visible")
    expect(migrated.visibilityUpgradedTo).toBe("v0.9.94")
  })

  test("upgrade is one-shot — re-loading already-upgraded state keeps user's later choice", () => {
    const persisted = {
      visibility: "hidden",
      width: 320,
      entries: [entry],
      visibilityUpgradedTo: "v0.9.94",
    }
    const migrated = migrateDockState(persisted)
    expect(migrated.visibility).toBe("hidden") // user re-hid; honored
  })

  test("empty hidden dock stays hidden (no entries to surface)", () => {
    const persisted = { visibility: "hidden", width: 320, entries: [] }
    const migrated = migrateDockState(persisted)
    expect(migrated.visibility).toBe("hidden")
    expect(migrated.visibilityUpgradedTo).toBeUndefined()
  })
})
```

### 4c. `packages/app/src/components/fetch-auth-audit.test.ts` — NEW (Sub-A)

Source-grep-based regression. Lists every site that should be using `globalSDK.fetch` and verifies via static analysis.

```ts
import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Phase 52 Sub-A regression coverage for the v0.9.94→.95 raw-fetch audit.
 *
 * Walks packages/app/src/ and finds every `fetch(...)` call. Each call
 * must either:
 *  - target a literal URL that's clearly external (matches an allow-list
 *    of external-API patterns), OR
 *  - use `globalSDK.fetch(...)` / `sdk.fetch(...)` / `platform.fetch(...)`
 *
 * Raw `fetch(\`${baseUrl}/...\`)` or `fetch(\`${sdk.url}/...\`)` is a bug.
 */

const SRC_ROOT = join(import.meta.dir, "..")
const AUTHED_PREFIXES = ["globalSDK.fetch", "sdk.fetch", "platform.fetch", "fetchFn", "tauriPage.request"]
const KNOWN_EXTERNAL_PATTERNS = [
  /fetch\(endpoint,/, // local-server-wizard.tsx fetchModels — probes user URLs
  /fetch\(input, init\)/, // global-sdk.tsx makeAuthedFetch internal
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full)
  }
  return out
}

describe("v0.9.94→.95 raw-fetch auth audit", () => {
  const files = walk(SRC_ROOT).filter((f) => !f.includes(".test."))

  test("no raw fetch(\\`${baseUrl}/...\\`) anywhere in packages/app/src", () => {
    const violations: Array<{ file: string; line: number; text: string }> = []
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (!/\bfetch\(/.test(line)) continue
        if (AUTHED_PREFIXES.some((p) => line.includes(p))) continue
        if (KNOWN_EXTERNAL_PATTERNS.some((p) => p.test(line))) continue
        // raw fetch with a template string starting with baseUrl/sdk.url
        if (/fetch\(`\$\{(baseUrl|sdk\.url|globalSDK\.url)/.test(line)) {
          violations.push({ file: file.replace(SRC_ROOT, ""), line: i + 1, text: line.trim() })
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Raw fetch() against the librecode API (will 401 on Tauri prod):\n${violations
          .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
          .join("\n")}`,
      )
    }
  })
})
```

### 4d. `packages/app/e2e/playwright.config.ts` — NEW (Sub-C)

```ts
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tauri",
  fullyParallel: false, // single Tauri instance per test for now
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Browser mode runs with mocked Tauri IPC. Tauri mode uses the real
  // socket bridge. CDP mode (Windows-only) reserved for future.
  projects: [
    {
      name: "browser",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "tauri",
      use: { viewport: { width: 1280, height: 800 } },
      // Tauri-specific config comes from the tauri-playwright fixture.
    },
  ],
})
```

### 4e. `packages/app/e2e/fixtures/tauri.ts` — NEW (Sub-C)

```ts
import { createTauriTest } from "@srsholmes/tauri-playwright"

/**
 * Phase 52 Sub-C — Tauri E2E test fixture.
 *
 * Exports a Playwright `test` + `expect` configured for librecode's
 * dev URL and the default IPC mocks needed to bring the app to a
 * navigable state without a real backend.
 *
 * Three modes (selected by Playwright project at runtime):
 *  - browser: headless Chromium + mocked Tauri IPC (CI default)
 *  - tauri:   real native webview via socket bridge (pre-release)
 *  - cdp:     direct Chrome DevTools Protocol to WebView2 (Windows)
 */
export const { test, expect } = createTauriTest({
  devUrl: "http://localhost:1420",
  ipcMocks: {
    await_initialization: () => null,
    get_default_server_url: () => "http://127.0.0.1:4096",
    get_display_backend: () => "auto",
    get_wsl_config: () => ({ enabled: false }),
    is_detached_app_window_open: () => false,
    open_detached_app_window: () => null,
    close_detached_app_window: () => null,
  },
})
```

### 4f. `packages/app/e2e/tauri/dock-fits.spec.ts` — NEW (Sub-C)

```ts
import { test, expect } from "../fixtures/tauri"

/**
 * v0.9.95 regression: dock rendered at x:1279 with w:320 in a 1280px
 * viewport — 319px past the right edge. Caught only by visual smoke
 * after Tristan reported it. This test enforces "dock fits inside
 * the viewport" via Playwright bounding-box assertions.
 */
test("dock fits inside 1280×800 viewport — no horizontal overflow (v0.9.95)", async ({ tauriPage }) => {
  await tauriPage.goto("/L2hvbWUvdHJpc3Rhbi9Qcm9qZWN0cy9saWJyZWNvZGU/session")
  await tauriPage.waitForLoadState("networkidle")

  const dock = tauriPage.locator('[data-testid="app-dock"]')
  await expect(dock).toBeVisible({ timeout: 5000 })

  const box = await dock.boundingBox()
  expect(box).not.toBeNull()
  const viewport = tauriPage.viewportSize()!
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  expect(box!.x).toBeGreaterThanOrEqual(0)
})
```

(Similar pattern for `dock-toggle-cycle.spec.ts`, `timeline-auth.spec.ts`,
`detach-flow.spec.ts`, `provider-scan-auth.spec.ts` — full skeletons in
Appendix A.)

### 4g. `.github/workflows/e2e.yml` — NEW (Sub-D)

```yaml
name: E2E (Tauri)
on:
  workflow_call:
    inputs:
      ref:
        required: false
        type: string

jobs:
  e2e-linux:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref }}
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Tauri system deps + WebKit driver
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libayatana-appindicator3-dev \
            webkit2gtk-driver \
            librsvg2-dev \
            xvfb
      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            packages/desktop/src-tauri/target
          key: e2e-cargo-${{ hashFiles('packages/desktop/src-tauri/Cargo.lock') }}
      - run: bun install
      - run: bun --cwd packages/app x playwright install --with-deps chromium
      - name: Build desktop with e2e feature
        run: |
          cd packages/desktop/src-tauri
          cargo build --features e2e-testing
      - name: Run E2E (browser mode, fast)
        run: bun --cwd packages/app run test:e2e -- --project=browser
      - name: Run E2E (tauri mode, real webview)
        run: xvfb-run bun --cwd packages/app run test:e2e -- --project=tauri
      - name: Verify production build does NOT include e2e plugin
        run: |
          ! grep -r "tauri-plugin-playwright" packages/desktop/src-tauri/target/release/ \
            || { echo "ERROR: e2e plugin found in release artifacts" ; exit 1 ; }
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            packages/app/playwright-report/
            packages/app/test-results/
          retention-days: 7
```

### 4h. `docs/adr/0010-test-architecture.md` — NEW (Sub-E)

(Full ADR text in Appendix B.)

---

## 5. Files to modify

### 5a. `packages/desktop/src-tauri/Cargo.toml` (Sub-C)

```toml
[features]
e2e-testing = ["tauri-plugin-playwright"]

[dependencies]
tauri-plugin-playwright = { version = "0.2", optional = true }
```

### 5b. `packages/desktop/src-tauri/src/lib.rs` (Sub-C)

```rust
fn make_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    // ... existing
}

pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "e2e-testing")]
    let builder = builder.plugin(tauri_plugin_playwright::init());

    // ... existing
}
```

### 5c. `packages/desktop/src-tauri/capabilities/e2e-testing.json` — NEW conditional

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "e2e-testing",
  "description": "Capabilities enabled only when built with the e2e-testing feature flag. MUST NOT ship to production.",
  "windows": ["main", "detached-*"],
  "permissions": ["playwright:default"]
}
```

Build script in `build.rs` (extend existing) to only copy this file into the active capabilities directory when `cargo:rustc-cfg=feature="e2e-testing"` is set.

### 5d. `packages/app/package.json` (Sub-C)

Add to `devDependencies`:

```json
{
  "@playwright/test": "^1.50.0",
  "@srsholmes/tauri-playwright": "^0.2.2"
}
```

Add to `scripts`:

```json
{
  "test:e2e": "playwright test --config=e2e/playwright.config.ts",
  "test:e2e:browser": "playwright test --config=e2e/playwright.config.ts --project=browser",
  "test:e2e:tauri": "playwright test --config=e2e/playwright.config.ts --project=tauri"
}
```

### 5e. `.github/workflows/release.yml` (Sub-D)

Add e2e as a required step before binary builds:

```yaml
jobs:
  e2e:
    uses: ./.github/workflows/e2e.yml

  build-cli:
    needs: [quality-gate, e2e]
    # ... existing
```

### 5f. `CLAUDE.md` (Sub-E) — Testing section rewrite

(Full text in Appendix C — replaces the existing "### Testing" section under "## Coding Standards".)

### 5g. `docs/architecture.md` (Sub-E)

Replace the existing testing paragraph with a three-layer model description and pointer to ADR-010.

### 5h. `docs/development.md` (Sub-E)

Add a new "Running tests" section with per-layer instructions:

```bash
# Layer 1: unit tests (fast)
bun test

# Layer 2: web preview smoke (manual via Claude_Preview MCP)
# See docs/plans/preview-smoke-template.md

# Layer 3: Tauri E2E
bun --cwd packages/app run test:e2e:browser  # fast iteration
bun --cwd packages/app run test:e2e:tauri    # pre-release
```

### 5i. `PLAN.md` (Sub-E)

Add Phase 52 entry under "v0.9.x Continued":

```markdown
### Phase 52: Testing Architecture Overhaul (v0.9.98 → v0.10.0)

Three-layer testing stack established after a series of fix-forwards
revealed systemic gaps in how UI changes get verified. ADR-010
ratifies the architecture; CLAUDE.md updated to require regression
tests for every bug fix.

| Sub-phase      | Item                                                                 | Status |
| -------------- | -------------------------------------------------------------------- | ------ |
| 52A (v0.9.98)  | Regression backfill for 5 production bugs + smoke template hardening | ✅     |
| 52B (v0.9.99)  | Layer 1 mockIPC helper + 5 adopted unit tests                        | ✅     |
| 52C (v0.9.100) | Layer 3 tauri-playwright integration + 5 initial E2E tests           | ✅     |
| 52D (v0.10.0)  | CI integration (e2e.yml + release.yml gate)                          | ✅     |
| 52E (v0.10.0)  | ADR-010 + CLAUDE.md / architecture.md / development.md updates       | ✅     |
```

### 5j. `docs/plans/preview-smoke-template.md` (Sub-E)

Final pass: rename references from "preview-smoke" to "Layer 2 smoke," add cross-references to Layer 1 and Layer 3, document which layer to use for which bug class.

---

## 6. Tests required

### 6a. Sub-A: regression tests (the new files in §4b, §4c — these ARE the tests)

Plus extend existing test files:

- `app-dock/state.test.ts` — add 1 test that `addEntry` preserves the
  `visibilityUpgradedTo` marker (carry-forward stability).
- `app-dock/edge-handle.test.ts` — add 1 test exercising the click
  handler with a mocked `dock.toggle`.

### 6b. Sub-B: mockIPC adoption

Each test that adopts the new helper gets an assertion that the
expected Tauri command was called:

```ts
test("dock.detach invokes open_detached_app_window with correct args", async () => {
  const calls: Array<{ cmd: string; args: unknown }> = []
  setupTauriMock({
    open_detached_app_window: (args) => {
      calls.push({ cmd: "open_detached_app_window", args })
      return null
    },
  })
  // ... drive the action
  expect(calls).toHaveLength(1)
  expect(calls[0].args).toMatchObject({ server: "multica", uri: "ui://multica/board" })
  teardownTauriMock()
})
```

### 6c. Sub-C: 5 initial E2E tests (already enumerated in §4f and Appendix A)

### 6d. Sub-D: CI workflow test

Add a workflow-syntax-only check (no actual run) to verify the e2e.yml is callable:

```bash
gh workflow run e2e.yml --ref test-branch --dry-run
```

(If `gh` doesn't support `--dry-run`, skip — it's confirmed manually
during the first real run.)

---

## 7. Step-by-step execution order

Each sub-phase is its own commit + version bump, shippable
independently.

### Phase 52A — v0.9.98 (regression backfill + smoke template)

1. Baseline: `bun test` from `packages/app` = 861 tests passing.
2. Create `dock-visibility-upgrade.test.ts` (§4b) → run → +3 tests.
3. Create `fetch-auth-audit.test.ts` (§4c) → run → +1 test (proves the
   audit catches future raw-fetch regressions).
4. Add 2 tests per §6a to existing files → +2.
5. Final: 861 → 867 (+6).
6. Run root `bun run typecheck` (Phase 49 lesson).
7. Run `bunx prettier --check .` clean.
8. Update `docs/plans/preview-smoke-template.md` with a §9 "regression
   coverage" section listing the bugs Layer 2 catches.
9. **Commit**: `test(app): regression backfill for v0.9.91→.95 production bugs (Phase 52A)`
10. **Commit**: `docs(plan): smoke template references regression-coverage layer (Phase 52A)`
11. Bump versions to 0.9.98 (incl SDK!) → commit.
12. Push + tag + watch.

### Phase 52B — v0.9.99 (mockIPC helper + adoption)

1. Baseline ≥ 867 tests.
2. Create `src/test-utils/tauri-mock.ts` (§4a).
3. Adopt in 5 existing tests; replace inline `Object.defineProperty` /
   manual mocks with the helper.
4. Verify per-command assertions per §6b.
5. App tests pass; root typecheck clean.
6. **Commit**: `test(app): tauri-mock helper + adopt in 5 unit tests (Phase 52B)`
7. Bump versions to 0.9.99 → commit.
8. Push + tag + watch.

### Phase 52C — v0.9.100 (Layer 3 tauri-playwright)

**This is the big one. Half-day timebox. Pivot rules per Phase 49
pattern**: if the plugin embedding doesn't compile after ~2 hours of
debugging, STOP and report blocked.

1. Baseline.
2. Cargo: add `tauri-plugin-playwright` optional dependency + feature.
   Run `cargo build` without the feature to confirm baseline still
   compiles.
3. Run `cargo build --features e2e-testing` to confirm the feature
   activates cleanly. **If this fails, that's the spike outcome —
   STOP.**
4. Add `lib.rs` plugin init under `#[cfg(feature = "e2e-testing")]`.
   Build again.
5. Create `capabilities/e2e-testing.json` and wire into `build.rs`
   conditional copy.
6. npm: add `@playwright/test` + `@srsholmes/tauri-playwright` to
   `packages/app/devDependencies`. Run `bun install`. Run
   `bun --cwd packages/app x playwright install chromium`.
7. Create `e2e/playwright.config.ts` (§4d).
8. Create `e2e/fixtures/tauri.ts` (§4e).
9. Create `e2e/tauri/dock-fits.spec.ts` (§4f). Run in browser mode:
   `bun --cwd packages/app run test:e2e:browser`. Verify it passes
   against the dev server.
10. Create the other 4 specs per Appendix A.
11. Verify all 5 pass in browser mode.
12. Spin up the Tauri build with the feature flag (manual smoke):
    `bun run dev:desktop -- --features e2e-testing` (or equivalent).
    Run `bun --cwd packages/app run test:e2e:tauri` against the
    running app. Verify at least 1 test passes against the real webview.
13. App tests still pass.
14. Root typecheck clean.
15. **Commit**: `feat(desktop): tauri-plugin-playwright embedded under e2e-testing feature (Phase 52C)`
16. **Commit**: `feat(e2e): 5 initial Tauri-mode E2E tests (Phase 52C)`
17. Bump to 0.9.100 → commit.
18. Push + tag + watch.

### Phase 52D — v0.10.0 (CI integration)

1. Create `.github/workflows/e2e.yml` (§4g).
2. Modify `release.yml` to add e2e as a `needs:` for the binary build
   jobs (§5e).
3. Push to a test branch + open a PR to trigger the workflow once
   without merging. Verify it completes successfully.
4. If it passes, merge.
5. **Commit**: `ci(e2e): tauri E2E job gated as required for release (Phase 52D)`
6. Bump to 0.10.0 (the major bump signals the architectural change).
7. Push + tag + watch.

### Phase 52E — v0.10.0 (docs, batched with 52D's commit)

1. Create `docs/adr/0010-test-architecture.md` (§4h, Appendix B).
2. Rewrite `CLAUDE.md` testing section (Appendix C).
3. Update `docs/architecture.md` testing section.
4. Update `docs/development.md` with per-layer commands.
5. Final pass on `docs/plans/preview-smoke-template.md`.
6. Update `PLAN.md` with the Phase 52 entry.
7. **Commit**: `docs(test-arch): ADR-010 three-layer test architecture (Phase 52E)`
8. Push (already at v0.10.0 from Sub-D).

---

## 8. Preview smoke (MANDATORY — yes, this phase too)

Run the standard Layer 2 smoke per
`docs/plans/preview-smoke-template.md`. The phase-specific checks:

### Check 1 — Sub-A regression tests run cleanly

```ts
// Local-only check: run from a fresh terminal
preview_eval({
  serverId: WEB_ID,
  expression: `
  (async () => {
    const res = await fetch('/healthz').catch(() => null)
    return { backendReachable: !!res }
  })()
`,
})
```

Then in a separate terminal: `bun --cwd packages/app test src/components/app-dock/dock-visibility-upgrade.test.ts` and confirm 3 passes.

### Check 2 — Sub-B mockIPC helper works

```ts
preview_eval({
  serverId: WEB_ID,
  expression: `
  (() => {
    // Verify the helper is exported (doesn't fail import)
    return { hasMocks: typeof window.__TAURI__ === 'undefined' ? 'web-mode' : 'tauri-mode' }
  })()
`,
})
```

### Check 3 — Sub-C playwright config valid

Local-only: `bun --cwd packages/app x playwright list-projects` should show `browser` and `tauri`. No preview check needed.

### Check 4 — Sub-D production build excludes the plugin

Local-only:

```bash
cd packages/desktop/src-tauri
cargo build --release  # NO --features e2e-testing
nm target/release/librecode-desktop 2>&1 | grep -i playwright | head -1
# Expected: nothing. If grep finds matches, the gate failed.
```

### Check 5 — Screenshot baseline

`preview_resize` to desktop + `preview_screenshot` of the session view. Required per v0.9.97 template.

---

## 9. Verification checklist

- [ ] App tests pass at each sub-phase boundary (no regressions).
- [ ] Root `bun run typecheck` clean at each sub-phase boundary.
- [ ] Sub-C: `cargo build --features e2e-testing` succeeds; `cargo build` (without) ALSO succeeds (baseline).
- [ ] Sub-C: at least 1 test passes in `tauri` mode against the real built app.
- [ ] Sub-D: e2e workflow runs green on a test branch before merging.
- [ ] Sub-D: production build verification step in CI confirms no `tauri-plugin-playwright` symbols in release artifacts.
- [ ] All 5 regression tests from Sub-A reference the bug they cover in a doc comment.
- [ ] ADR-010 ratified — moved from "draft" to "accepted" status.
- [ ] CLAUDE.md updated; pre-commit hook still passes (prettier).
- [ ] v0.10.0 released with all 14+ assets.
- [ ] Final manual eyes-on: install v0.10.0 desktop build, click around dock + Timeline + Detach. All work.

---

## 10. Pitfalls

### Pitfall 1 — Feature flag leak

If `tauri-plugin-playwright` ends up in a release build, ALL bets are off. Verify §Constraints rules 1-5 are all in place. The CI grep in §4g is the last line of defense — make sure it actually greps the release artifacts (not just source).

### Pitfall 2 — `tauri-plugin-playwright` API breaking

The plugin is 0.2.x. API may break between minor versions. Pin to exact version (`= "0.2.2"` not `"^0.2"`). Document the pin in ADR-010.

### Pitfall 3 — WebKitGTK 4.0 vs 4.1

Old Tauri docs reference `libwebkit2gtk-4.0-dev`. Current Tauri 2.x uses 4.1. The CI workflow MUST use the `-4.1` packages or the build fails with cryptic linker errors.

### Pitfall 4 — Capability conditional include

Tauri's build script doesn't have native support for "include this capability file only when feature X is active." You need a custom `build.rs` step that copies the file from `capabilities/e2e-testing.json` into the active capabilities directory only when the feature is set. Sketch:

```rust
fn main() {
    tauri_build::build();
    if std::env::var("CARGO_FEATURE_E2E_TESTING").is_ok() {
        std::fs::copy(
            "capabilities/e2e-testing.json",
            "gen/capabilities/e2e-testing.json",
        ).ok();
    }
}
```

(Adapt to where Tauri's codegen places capabilities — verify path.)

### Pitfall 5 — `xvfb-run` flakiness on GH Actions

Some Tauri E2E rigs report `xvfb-run` randomly failing with "could not connect to display." Mitigation: set `DISPLAY=:99` explicitly and start xvfb manually before the test:

```bash
sudo Xvfb :99 -ac -screen 0 1280x800x24 &
export DISPLAY=:99
sleep 1
bun --cwd packages/app run test:e2e:tauri
```

Use only if the simple `xvfb-run` path proves flaky.

### Pitfall 6 — IPC mock collisions across modes

The `ipcMocks` in `e2e/fixtures/tauri.ts` apply ONLY in `browser` mode. In `tauri` mode, the real Tauri backend runs, so mocked commands DON'T fire. Tests that rely on IPC mocks must be marked `test.skip` for `tauri` mode OR rewritten to set up the same state via real backend commands.

### Pitfall 7 — Bun-native fetch in Playwright tests

Playwright tests run under Node, not Bun. If you import from `@/test-utils/tauri-mock` and that module uses Bun-specific APIs, Playwright tests break. Keep `e2e/fixtures/` Bun-free.

### Pitfall 8 — SDK version drift (carry-forward from Phase 50b)

When bumping versions across the 7 packages, MUST include `packages/sdk/js/package.json`. Sonnet missed this in v0.9.93 and had to ship a fix commit. Add to the version-bump script if one doesn't exist.

### Pitfall 9 — `cargo test` regenerating bindings (carry-forward from Phase 49)

The `LIBRECODE_REGEN_BINDINGS` env var gates the regen. If CI runs `cargo test` without the gate, `bindings.ts` gets rewritten to the broken specta output. The CI workflow must NOT set `LIBRECODE_REGEN_BINDINGS=1`.

### Pitfall 10 — Test interleaving

Playwright tests don't share state. But `mockIPC` in Layer 1 unit tests is GLOBAL — `clearMocks()` between tests is required, hence the `teardownTauriMock()` in §4a. Forgetting this causes "command X already has a handler" errors across tests.

### Pitfall 11 — The 401 + CORS error pattern

When debugging E2E auth failures, "CORS error" in the console is misleading — it's USUALLY a 401 underneath whose response lacks ACAO headers. Add an explicit check in the e2e fixture that asserts the response status BEFORE failing on missing CORS headers.

### Pitfall 12 — Initial Tauri build is slow

First `cargo build --features e2e-testing` on a fresh runner can take 15+ minutes due to dependencies. Cache aggressively in CI (see `actions/cache@v4` config in §4g). Without caching, the e2e job blocks every release for an extra quarter-hour.

---

## 11. Pre-drafted atomic commit subjects

| #   | Commit                                                                                  | Sub-phase | Version |
| --- | --------------------------------------------------------------------------------------- | --------- | ------- |
| 1   | `test(app): regression backfill for v0.9.91→.95 production bugs (Phase 52A)`            | A         | 0.9.98  |
| 2   | `docs(plan): smoke template references regression-coverage layer (Phase 52A)`           | A         | 0.9.98  |
| 3   | `chore: bump version to 0.9.98`                                                         | A         | 0.9.98  |
| 4   | `test(app): tauri-mock helper + adopt in 5 unit tests (Phase 52B)`                      | B         | 0.9.99  |
| 5   | `chore: bump version to 0.9.99`                                                         | B         | 0.9.99  |
| 6   | `feat(desktop): tauri-plugin-playwright embedded under e2e-testing feature (Phase 52C)` | C         | 0.9.100 |
| 7   | `feat(e2e): 5 initial Tauri-mode E2E tests (Phase 52C)`                                 | C         | 0.9.100 |
| 8   | `chore: bump version to 0.9.100`                                                        | C         | 0.9.100 |
| 9   | `ci(e2e): tauri E2E job gated as required for release (Phase 52D)`                      | D         | 0.10.0  |
| 10  | `docs(test-arch): ADR-010 three-layer test architecture (Phase 52E)`                    | E         | 0.10.0  |
| 11  | `chore: bump version to 0.10.0`                                                         | D+E       | 0.10.0  |

11 commits across 4 release boundaries. Each sub-phase ships
independently.

---

## 12. When you're done

Trip report format. Each sub-phase has its own row.

```
| Sub-phase | Status | Version | Commits | Test delta | Notes |
|---|---|---|---|---|---|
| 52A regression backfill | ✅ | v0.9.98 | 2 + bump | 861 → 867 (+6) | |
| 52B mockIPC adoption    | ✅ | v0.9.99 | 1 + bump | 867 → 872 (+5) | |
| 52C tauri-playwright    | ✅/blocked | v0.9.100 | 2 + bump | 872 → 877 (+5 e2e) | Sub-C is the spike step — report blocked if cargo build fails after 2h |
| 52D CI integration      | ✅ | v0.10.0 | 1 + bump | no test delta | e2e workflow runs green on test branch X (link) |
| 52E docs                | ✅ | v0.10.0 | 1 | no test delta | ADR-010 ratified |

| Smoke check                          | Result |
|---|---|
| Sub-A regression tests run cleanly   | ✅ |
| Sub-B mockIPC helper exports         | ✅ |
| Sub-C playwright list-projects       | ✅ |
| Sub-D production build excludes plugin | ✅ |
| Screenshot baseline at desktop viewport | ✅ |

| Carry-forward pitfalls hit | (list any) |
| New pitfalls documented    | (list any) |
```

If Sub-C blocks, report:

```
| Sub-C outcome | BLOCKED |
| Compile error / symptom | (paste) |
| Time spent | X hours |
| Recommended pivot | (drop tauri-playwright; investigate alternatives e.g. tauri-driver+WebdriverIO; or abandon Layer 3 and document the gap) |
```

---

## Appendix A — Remaining E2E spec skeletons

### `e2e/tauri/dock-toggle-cycle.spec.ts`

```ts
import { test, expect } from "../fixtures/tauri"

test("dock toggle cycle: open → hide → edge-handle → re-open (v0.9.95)", async ({ tauriPage }) => {
  await tauriPage.goto("/L2hvbWUv.../session")
  const dock = tauriPage.locator('[data-testid="app-dock"]')
  await expect(dock).toBeVisible()
  // Hide via toggle button
  await tauriPage.locator('[aria-label="Hide app dock"]').click()
  await expect(dock).toBeHidden()
  // Edge handle should appear (entries > 0)
  const handle = tauriPage.locator('[data-testid="dock-edge-handle"]')
  await expect(handle).toBeVisible()
  // Click it
  await handle.click()
  // Dock returns
  await expect(dock).toBeVisible()
  await expect(handle).toBeHidden()
})
```

### `e2e/tauri/timeline-auth.spec.ts`

```ts
import { test, expect } from "../fixtures/tauri"

test("Timeline tab loads without TypeError: Load failed (v0.9.94)", async ({ tauriPage }) => {
  // Set up the LIBRECODE_SERVER_PASSWORD env so the auth gate fires.
  // (In tauri mode this requires backend setup — see fixture.)
  await tauriPage.goto("/L2hvbWUv.../session/ses_test")
  const consoleErrors: string[] = []
  tauriPage.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text())
  })
  await tauriPage.click('[role="tab"][value="activity"]')
  await tauriPage.waitForLoadState("networkidle")
  expect(consoleErrors.filter((e) => /TypeError: Load failed/.test(e))).toHaveLength(0)
})
```

### `e2e/tauri/detach-flow.spec.ts`

```ts
import { test, expect } from "../fixtures/tauri"

test("detach button opens a 2nd Tauri window (Phase 49)", async ({ tauriContext, tauriPage }) => {
  await tauriPage.goto("/L2hvbWUv.../session/ses_test")
  // Pre-pin a non-builtin entry so Detach button shows
  await tauriPage.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("app-dock-state"))!
    const state = JSON.parse(localStorage.getItem(key)!)
    state.entries.push({
      uri: "ui://multica/board",
      addedAt: Date.now(),
      app: { server: "multica", uri: "ui://multica/board", name: "Multica" },
    })
    localStorage.setItem(key, JSON.stringify(state))
  })
  await tauriPage.reload()
  // Click detach
  await tauriPage.locator('[data-testid="pane-detach-ui://multica/board"]').click()
  // New page (window) appears
  const newPage = await tauriContext.waitForEvent("page", { timeout: 5000 })
  await expect(newPage.locator('[data-testid="detached-app-shell"]')).toBeVisible()
})
```

### `e2e/tauri/provider-scan-auth.spec.ts`

```ts
import { test, expect } from "../fixtures/tauri"

test("provider scan endpoint accepts auth headers (v0.9.95 audit)", async ({ tauriPage, request }) => {
  // Hit the endpoint directly with no auth → expect 401
  const noAuth = await request.post("http://127.0.0.1:4096/provider/scan", {
    data: { host: "localhost", ports: [11434] },
  })
  expect(noAuth.status()).toBe(401)
  // Then via the in-app flow which uses globalSDK.fetch (authed)
  await tauriPage.goto("/L2hvbWUv.../onboarding/local-compute")
  await tauriPage.locator('[data-testid="lc-detect"]').click()
  // Should NOT error
  const consoleErrors: string[] = []
  tauriPage.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text())
  })
  await tauriPage.waitForTimeout(2000)
  expect(consoleErrors.filter((e) => /401|Load failed/.test(e))).toHaveLength(0)
})
```

---

## Appendix B — ADR-010 full text

```markdown
# ADR-010: Three-Layer Test Architecture

**Status**: Proposed (Phase 52)

## Context

Through Phases 42–51 the LibreCode UI grew significantly: dock, MCP
apps, detachable Tauri windows, telemetry, a11y. Testing kept pace
via 800+ unit tests but each major release surfaced bugs unit tests
missed:

- v0.9.91 dock invisible (migration path not exercised)
- v0.9.94 Timeline 401 (Tauri auth path bypass)
- v0.9.95 dock off-screen (no visual smoke at desktop viewport)
- Phase 49 detach unverifiable (no Tauri E2E coverage)

A systematic gap: no automated path reached the real Tauri webview;
"smoke" tests asserted DOM properties without LOOKING.

## Decision

Adopt a three-layer testing architecture. Each layer has a clear
scope and a clear "this layer's job":

### Layer 1 — Component / Unit Tests (`bun test`)

- Scope: pure functions, predicates, reducers, type guards.
- Speed: <100ms per file.
- Adds Tauri APIs via `@tauri-apps/api/mocks` (`mockIPC`,
  `mockWindows`, `clearMocks`) when a component branches on Tauri
  state.
- Helper: `packages/app/src/test-utils/tauri-mock.ts`.
- Catches: logic regressions, helper bugs, schema parsing.
- Misses: real layout, real Tauri runtime, multi-window flows.

### Layer 2 — Web Preview Smoke (`Claude_Preview` MCP)

- Scope: real SolidJS app served by `bun run dev:web` + librecode
  CLI backend, driven by the Claude_Preview MCP tools.
- Speed: 15-30 seconds per smoke run.
- Mandatory: `preview_resize` to desktop viewport (1280×800) + at
  least one `preview_screenshot` per state change.
- Catches: layout overflow, render bugs, route flows, real auth
  paths in the web mode.
- Misses: Tauri IPC commands, native multi-window, native rendering
  artifacts.

### Layer 3 — Tauri E2E (`tauri-playwright`)

- Scope: real Tauri build with `e2e-testing` cargo feature enabled,
  Playwright driving the real native webview via socket bridge.
- Speed: 3-5 minutes per suite.
- Plugin (`tauri-plugin-playwright`) is feature-gated and MUST NOT
  ship to production.
- Catches: IPC commands, multi-window, CSP, native rendering, real
  auth in Tauri mode.
- Misses: cross-platform visual differences (Linux-only initially).

## Test placement decision tree
```

New code → does it call a Tauri API?
├─ No → does it have a visible UI surface?
│ ├─ No → Layer 1 unit test only
│ └─ Yes → Layer 1 unit test + Layer 2 smoke
└─ Yes → Layer 1 (with tauri-mock) + Layer 3 E2E

```

## Regression rules

Every bug fix MUST land with a regression test in the appropriate
layer. The PR description must identify which layer would have
caught the bug if the test had existed pre-fix.

## Consequences

### Positive

- Bug class coverage: each layer has a clear scope.
- Failed releases caught at smoke time, not by users.
- Tauri-specific flows (detach, IPC, native auth) testable for the
  first time.
- ADR provides a clear contract for "where does this test belong?"

### Negative

- CI cost: +4 minutes on the release path.
- Maintenance: 3 test rigs instead of 1.
- `tauri-plugin-playwright` is community-maintained (0.2.x); API
  may break.
- Linux-only Layer 3 initially; cross-platform deferred.

## Alternatives considered

| Option | Why not |
|---|---|
| Official `tauri-driver` + WebdriverIO | WebKit driver flaky, WebdriverIO API less familiar than Playwright, no mac support |
| Skip Layer 3 entirely, rely on Layer 2 | Misses Tauri-specific bugs that already shipped |
| Visual regression diffing | Useful but separate scope; can layer on later |
| `tauri-pilot` CLI | A11y-tree based; useful for record-replay debug but not CI primary |

## References

- Phase 52 spec: `docs/plans/phase-52-spec.md`
- Smoke template: `docs/plans/preview-smoke-template.md`
- Tauri WebDriver docs: https://v2.tauri.app/develop/tests/webdriver/
- tauri-playwright: https://github.com/srsholmes/tauri-playwright
```

---

## Appendix C — CLAUDE.md testing section rewrite

```markdown
### Testing

LibreCode uses a three-layer test architecture (ADR-010):

**Layer 1 — Unit tests (`bun test`)**

- File pattern: `*.test.ts` / `*.test.tsx` colocated with source.
- Coverage baseline: ≥80% lines on new files, no decrease on
  modified files.
- For Tauri-API-calling components: use
  `@/test-utils/tauri-mock` (NOT raw `@tauri-apps/api/mocks`).
- Test isolation via `test/preload.ts` (temp dirs, no real user data).
- Speed target: full suite <30s.

**Layer 2 — Web preview smoke (`docs/plans/preview-smoke-template.md`)**

- Manual / Claude_Preview MCP driven.
- MANDATORY at desktop viewport (1280×800).
- MANDATORY screenshot at baseline + each visible state change.
- Required for any PR that ships UI changes.

**Layer 3 — Tauri E2E (`bun --cwd packages/app run test:e2e`)**

- Playwright via `@srsholmes/tauri-playwright`.
- Three modes: browser (fast), tauri (real webview), cdp (Windows-only).
- CI runs browser mode on every push, tauri mode on release-tagged
  builds.
- Required for any PR that changes Tauri IPC, multi-window, or CSP.

**Regression rule**: every bug fix MUST include a regression test
in the appropriate layer. The PR description must explicitly say
"this regression would have been caught by Layer N."
```
