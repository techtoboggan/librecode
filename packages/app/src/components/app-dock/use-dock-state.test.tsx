/**
 * Integration tests for the AppDockProvider migration hook (Phase 44).
 *
 * This project's unit test suite runs Solid.js in the server-side build;
 * `render` from `solid-js/web` is not available. These tests exercise the
 * exact migration logic that lives in the onMount callback by calling the
 * same functions (planLegacyMigration + markMigrated) in a createRoot
 * reactive context — same as every other dock unit test in this directory.
 *
 * What is tested: the control-flow decisions the provider makes on first
 * mount — which state mutations are applied and whether the toast condition
 * is met — not the Solid component scaffold itself.
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { defaultDockState, addEntry } from "./state"
import { planLegacyMigration, markMigrated } from "./migration"
import type { DockState } from "./types"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

const APP_A: McpAppResource = { server: "__builtin__", name: "Session Stats", uri: "ui://builtin/session-stats" }
const APP_B: McpAppResource = { server: "__builtin__", name: "Activity Graph", uri: "ui://builtin/activity-graph" }

const NOW = 1700000000000

/**
 * Simulate what the provider's onMount callback does:
 *   1. Read legacy snapshot
 *   2. Call planLegacyMigration
 *   3. Apply result or markMigrated as appropriate
 * Returns { finalState, toastFired, toastTitle }.
 */
function simulateMigrationMount(
  initialState: DockState,
  legacySnapshot: McpAppResource[],
  now = NOW,
): { finalState: DockState; toastFired: boolean; toastTitle: string } {
  let finalState = initialState
  let toastFired = false
  let toastTitle = ""

  createRoot((dispose) => {
    const [store, setStore] = createStore<DockState>(initialState)

    // Capture pre-migration state BEFORE any setStore calls.
    // In the provider these checks run before startTransition settles
    // (startTransition defers the write), so we mirror that here.
    const preEntriesLength = (store as DockState).entries.length
    const alreadyMigrated = typeof (store as DockState).migratedFromPinnedAt === "number"

    const next = planLegacyMigration(store as DockState, legacySnapshot, now)
    if (next !== null) {
      setStore(next)
      if (legacySnapshot.length > 0 && preEntriesLength === 0) {
        toastFired = true
        toastTitle = `Restored ${legacySnapshot.length} app${legacySnapshot.length === 1 ? "" : "s"} from your tab pins`
      }
    } else if (!alreadyMigrated) {
      setStore(markMigrated(store as DockState, now))
    }

    finalState = store as DockState
    dispose()
  })

  return { finalState, toastFired, toastTitle }
}

// ── Provider migration integration ───────────────────────────────────────────

describe("AppDockProvider migration hook", () => {
  test("new workspace with no legacy apps: migratedFromPinnedAt set, no toast", () => {
    const { finalState, toastFired } = simulateMigrationMount(defaultDockState(), [], NOW)

    expect(finalState.migratedFromPinnedAt).toBe(NOW)
    expect(finalState.entries).toHaveLength(0)
    expect(toastFired).toBe(false)
  })

  test("new workspace with legacy pins: entries seeded, dock visible, toast fires", () => {
    const { finalState, toastFired, toastTitle } = simulateMigrationMount(defaultDockState(), [APP_A, APP_B], NOW)

    expect(finalState.entries).toHaveLength(2)
    expect(finalState.entries[0].uri).toBe(APP_A.uri)
    expect(finalState.entries[1].uri).toBe(APP_B.uri)
    expect(finalState.visibility).toBe("visible")
    expect(finalState.migratedFromPinnedAt).toBe(NOW)
    expect(toastFired).toBe(true)
    expect(toastTitle).toBe("Restored 2 apps from your tab pins")
  })

  test("already-migrated workspace: no re-migration on remount", () => {
    const alreadyMigrated: DockState = {
      ...defaultDockState(),
      entries: [{ uri: APP_A.uri, app: APP_A, addedAt: NOW - 1 }],
      migratedFromPinnedAt: NOW - 1,
    }
    const { finalState, toastFired } = simulateMigrationMount(alreadyMigrated, [APP_A, APP_B], NOW)

    // Entries unchanged — no new migration
    expect(finalState.entries).toHaveLength(1)
    expect(finalState.migratedFromPinnedAt).toBe(NOW - 1)
    expect(toastFired).toBe(false)
  })

  test("workspace with legacy pins AND manually-added dock entries: flag set, entries unchanged, no toast", () => {
    const withManualEntry = addEntry(defaultDockState(), { uri: APP_A.uri, app: APP_A })
    const { finalState, toastFired } = simulateMigrationMount(withManualEntry, [APP_B], NOW)

    // Flag is set (to prevent future re-checks)
    expect(finalState.migratedFromPinnedAt).toBe(NOW)
    // Manual entries are preserved — legacy pins do NOT overwrite
    expect(finalState.entries).toHaveLength(1)
    expect(finalState.entries[0].uri).toBe(APP_A.uri)
    // No toast because entries.length was > 0 at migration time
    expect(toastFired).toBe(false)
  })

  test("toast pluralization: 1 app uses singular, N apps uses plural", () => {
    const { toastTitle: singular } = simulateMigrationMount(defaultDockState(), [APP_A], NOW)
    expect(singular).toBe("Restored 1 app from your tab pins")

    const { toastTitle: plural } = simulateMigrationMount(defaultDockState(), [APP_A, APP_B], NOW)
    expect(plural).toBe("Restored 2 apps from your tab pins")
  })
})
