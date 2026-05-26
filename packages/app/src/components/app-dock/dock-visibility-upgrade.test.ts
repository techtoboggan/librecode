/**
 * Phase 52 Sub-A — regression guard for the v0.9.91→.94 dock-visibility
 * upgrade bug.
 *
 * Root cause: v0.9.88 (Phase 48) shipped the app dock with
 * `visibility: "hidden"` as the default. v0.9.91 corrected that default
 * to `"visible"`, but `migrateDockState` honored the persisted
 * `"hidden"` for users who had already loaded the dock — so upgraders
 * kept getting an invisible dock.
 *
 * Fix landed in v0.9.94: `migrateDockState` now auto-upgrades once
 * (stamps `visibilityUpgradedTo: "v0.9.94"`) for non-empty docks that
 * are carrying a stale `hidden`. The sentinel prevents the upgrade from
 * firing again if the user subsequently hides the dock deliberately.
 *
 * Which layer would have caught this: Layer 1 (unit test) — if this
 * file had existed before the v0.9.91 release.
 */

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
