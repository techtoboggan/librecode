import { describe, expect, test } from "bun:test"
import { planLegacyMigration, markMigrated, migrationCount } from "./migration"
import { defaultDockState, addEntry } from "./state"
import type { DockState } from "./types"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

const APP_A: McpAppResource = { server: "__builtin__", name: "Session Stats", uri: "ui://builtin/session-stats" }
const APP_B: McpAppResource = { server: "__builtin__", name: "Activity Graph", uri: "ui://builtin/activity-graph" }
const APP_C: McpAppResource = {
  server: "multica",
  name: "Multica",
  uri: "ui://multica/main",
  description: "Multi-context chat",
}

const NOW = 1700000000000

// ── planLegacyMigration ───────────────────────────────────────────────────────

describe("planLegacyMigration", () => {
  test("empty legacy + empty dock → null (nothing to migrate)", () => {
    const result = planLegacyMigration(defaultDockState(), [], NOW)
    expect(result).toBeNull()
  })

  test("already-migrated flag → null regardless of legacy apps", () => {
    const migrated: DockState = { ...defaultDockState(), migratedFromPinnedAt: NOW - 1 }
    const result = planLegacyMigration(migrated, [APP_A, APP_B], NOW)
    expect(result).toBeNull()
  })

  test("already-migrated flag → null even with empty legacy", () => {
    const migrated: DockState = { ...defaultDockState(), migratedFromPinnedAt: NOW - 1 }
    expect(planLegacyMigration(migrated, [], NOW)).toBeNull()
  })

  test("legacy apps + empty dock + no flag → returns new state with N entries", () => {
    const result = planLegacyMigration(defaultDockState(), [APP_A, APP_B], NOW)
    expect(result).not.toBeNull()
    expect(result!.entries).toHaveLength(2)
  })

  test("seeded entries use the legacy app URIs", () => {
    const result = planLegacyMigration(defaultDockState(), [APP_A, APP_B], NOW)
    expect(result!.entries[0].uri).toBe(APP_A.uri)
    expect(result!.entries[1].uri).toBe(APP_B.uri)
  })

  test("visibility is set to 'visible' when entries are seeded", () => {
    const result = planLegacyMigration(defaultDockState(), [APP_A], NOW)
    expect(result!.visibility).toBe("visible")
  })

  test("migratedFromPinnedAt is set to `now`", () => {
    const result = planLegacyMigration(defaultDockState(), [APP_A], NOW)
    expect(result!.migratedFromPinnedAt).toBe(NOW)
  })

  test("pin order is preserved: first legacy app is first dock entry", () => {
    const result = planLegacyMigration(defaultDockState(), [APP_B, APP_A, APP_C], NOW)
    const uris = result!.entries.map((e) => e.uri)
    expect(uris).toEqual([APP_B.uri, APP_A.uri, APP_C.uri])
  })

  test("addedAt is set to `now` for all migrated entries", () => {
    const result = planLegacyMigration(defaultDockState(), [APP_A, APP_B], NOW)
    expect(result!.entries[0].addedAt).toBe(NOW)
    expect(result!.entries[1].addedAt).toBe(NOW)
  })

  test("entries mapping preserves server, name, uri, description fields", () => {
    const result = planLegacyMigration(defaultDockState(), [APP_C], NOW)
    const entry = result!.entries[0]
    expect(entry.app.server).toBe("multica")
    expect(entry.app.name).toBe("Multica")
    expect(entry.app.uri).toBe("ui://multica/main")
    expect(entry.app.description).toBe("Multi-context chat")
  })

  test("description undefined in source → undefined in result (not empty string)", () => {
    const appNoDesc: McpAppResource = { server: "s", name: "NoDesc", uri: "ui://nodesc" }
    const result = planLegacyMigration(defaultDockState(), [appNoDesc], NOW)
    expect(result!.entries[0].app.description).toBeUndefined()
  })

  test("legacy apps + EXISTING dock entries + no flag → flag set, entries unchanged", () => {
    const withEntry = addEntry(defaultDockState(), { uri: APP_A.uri, app: APP_A })
    const result = planLegacyMigration(withEntry, [APP_B], NOW)
    expect(result).not.toBeNull()
    // Flag is set
    expect(result!.migratedFromPinnedAt).toBe(NOW)
    // Existing entries are NOT replaced (manual setup wins)
    expect(result!.entries).toHaveLength(1)
    expect(result!.entries[0].uri).toBe(APP_A.uri)
  })

  test("does not mutate the input DockState", () => {
    const original = defaultDockState()
    const originalString = JSON.stringify(original)
    planLegacyMigration(original, [APP_A], NOW)
    expect(JSON.stringify(original)).toBe(originalString)
  })

  test("does not mutate the input legacyApps array", () => {
    const apps = [APP_A, APP_B]
    const original = JSON.stringify(apps)
    planLegacyMigration(defaultDockState(), apps, NOW)
    expect(JSON.stringify(apps)).toBe(original)
  })

  test("preserves width and visibility fields not relevant to migration when no migration happens", () => {
    const state: DockState = { visibility: "visible", width: 400, entries: [], migratedFromPinnedAt: NOW - 1 }
    // Already migrated → null (no change). Fields are preserved if there were a result.
    expect(planLegacyMigration(state, [APP_A], NOW)).toBeNull()
  })

  test("preserves width when seeding entries", () => {
    const state: DockState = { visibility: "hidden", width: 450, entries: [] }
    const result = planLegacyMigration(state, [APP_A], NOW)
    expect(result!.width).toBe(450)
  })
})

// ── markMigrated ──────────────────────────────────────────────────────────────

describe("markMigrated", () => {
  test("sets migratedFromPinnedAt on un-migrated state", () => {
    const result = markMigrated(defaultDockState(), NOW)
    expect(result.migratedFromPinnedAt).toBe(NOW)
  })

  test("on already-migrated state returns the same object reference (no churn)", () => {
    const already: DockState = { ...defaultDockState(), migratedFromPinnedAt: NOW - 1 }
    const result = markMigrated(already, NOW)
    expect(result).toBe(already)
  })

  test("does not alter entries or visibility when marking", () => {
    const withEntry = addEntry(defaultDockState(), { uri: APP_A.uri, app: APP_A })
    const result = markMigrated(withEntry, NOW)
    expect(result.entries).toHaveLength(1)
    // v0.9.91: defaultDockState() now starts visible, so visibility must be preserved as such.
    expect(result.visibility).toBe("visible")
  })
})

// ── migrationCount ────────────────────────────────────────────────────────────

describe("migrationCount", () => {
  test("returns 0 when already migrated", () => {
    const state: DockState = { ...defaultDockState(), migratedFromPinnedAt: NOW }
    expect(migrationCount(state, [APP_A, APP_B])).toBe(0)
  })

  test("returns 0 when dock already has entries (manual setup)", () => {
    const withEntry = addEntry(defaultDockState(), { uri: APP_A.uri, app: APP_A })
    expect(migrationCount(withEntry, [APP_B])).toBe(0)
  })

  test("returns N when migration would happen", () => {
    expect(migrationCount(defaultDockState(), [APP_A, APP_B, APP_C])).toBe(3)
  })

  test("returns 0 when no legacy apps", () => {
    expect(migrationCount(defaultDockState(), [])).toBe(0)
  })
})
