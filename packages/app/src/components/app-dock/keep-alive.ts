import type { DockEntry } from "./types"

/**
 * Phase 50b — decision helper for whether a pane's iframe should
 * stay mounted when collapsed.
 *
 * Three signals trigger "keep alive":
 *
 *   1. **Built-in apps** (`server === "__builtin__"`): always alive.
 *      Built-ins ship inside the LibreCode bundle and are known to
 *      either implement state-relay (Stats, Activity Graph) or have
 *      cheap re-mount paths.
 *   2. **Observed state-relay traffic**: tracked per-session. If
 *      the iframe has ever sent `mcp-app-state:save`, we know it
 *      survives unmount/remount cycles cleanly. Persisted in
 *      transient in-memory map; resets on reload (re-detected).
 *   3. **User opt-in**: per-app config flag
 *      `mcp_apps[uri].alwaysLoaded === true`.
 *
 * Returns `true` if ANY signal is set. Otherwise the iframe is
 * subject to lazy mount (unmount on collapse).
 */
export function shouldKeepIframeAlive(
  entry: Pick<DockEntry, "uri" | "app">,
  observedRelay: ReadonlySet<string>,
  config: { alwaysLoadedByUri?: ReadonlyMap<string, boolean> },
): boolean {
  if (entry.app.server === "__builtin__") return true
  if (observedRelay.has(entry.uri)) return true
  if (config.alwaysLoadedByUri?.get(entry.uri) === true) return true
  return false
}

/**
 * Helper: read the per-app `alwaysLoaded` flag from the config
 * tree. Returns `undefined` if not set (caller treats as `false`).
 *
 * Config shape (added in Phase 50b):
 *   mcp_apps: {
 *     [uri: string]: { alwaysLoaded?: boolean }
 *   }
 */
export function readAlwaysLoaded(
  configMcpApps: Record<string, { alwaysLoaded?: boolean }> | undefined,
  uri: string,
): boolean | undefined {
  return configMcpApps?.[uri]?.alwaysLoaded
}

/**
 * Helper: build the alwaysLoadedByUri map from config for efficient
 * per-URI lookup in shouldKeepIframeAlive.
 */
export function buildAlwaysLoadedMap(
  configMcpApps: Record<string, { alwaysLoaded?: boolean }> | undefined,
): ReadonlyMap<string, boolean> {
  if (!configMcpApps) return new Map()
  const m = new Map<string, boolean>()
  for (const [uri, val] of Object.entries(configMcpApps)) {
    if (typeof val.alwaysLoaded === "boolean") {
      m.set(uri, val.alwaysLoaded)
    }
  }
  return m
}
