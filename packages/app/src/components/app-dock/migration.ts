import type { McpAppResource } from "@/components/mcp-app-panel/types"
import type { DockEntry, DockState } from "./types"

/**
 * Decide whether to migrate legacy pinned-apps into the dock for the
 * current workspace, and if so, return the new state.
 *
 * Returns `null` when no migration should happen (the migration flag
 * is already set, or there are no legacy apps to migrate). Callers
 * use the null vs non-null distinction to decide whether to surface
 * a toast.
 *
 * Idempotent: callers that see `null` should still call `markMigrated`
 * on the dock state so subsequent passes don't keep checking.
 *
 * Phase 44 — invoked once per workspace on AppDockProvider mount.
 */
export function planLegacyMigration(
  current: DockState,
  legacyApps: ReadonlyArray<McpAppResource>,
  now: number = Date.now(),
): DockState | null {
  // Already migrated — never run again, even if legacy apps changed.
  if (typeof current.migratedFromPinnedAt === "number") return null
  // Nothing to migrate.
  if (legacyApps.length === 0) return null
  // User already added apps to the dock manually — preserve their
  // intent. Mark migrated to short-circuit future runs, but don't
  // duplicate. Caller passes the "no toast" path here.
  if (current.entries.length > 0) {
    return { ...current, migratedFromPinnedAt: now }
  }

  // Seed the dock with the legacy pins in pin order. Use `now` for the
  // entries' addedAt so they sort correctly relative to subsequent
  // adds; preserves pin order via the array order.
  const entries: DockEntry[] = legacyApps.map((app) => ({
    uri: app.uri,
    app: { server: app.server, name: app.name, uri: app.uri, description: app.description },
    addedAt: now,
  }))
  return {
    ...current,
    entries,
    visibility: "visible", // Surface the dock so the user notices.
    migratedFromPinnedAt: now,
  }
}

/**
 * Mark the dock as migrated without seeding anything — used when the
 * user had no legacy pins, or had already manually populated the dock.
 * Avoids the planLegacyMigration check on every reload.
 */
export function markMigrated(current: DockState, now: number = Date.now()): DockState {
  if (typeof current.migratedFromPinnedAt === "number") return current
  return { ...current, migratedFromPinnedAt: now }
}

/**
 * Pure: how many entries WOULD be migrated. Used by the toast copy.
 * Returns 0 when no migration would happen.
 */
export function migrationCount(current: DockState, legacyApps: ReadonlyArray<McpAppResource>): number {
  if (typeof current.migratedFromPinnedAt === "number") return 0
  if (current.entries.length > 0) return 0
  return legacyApps.length
}
