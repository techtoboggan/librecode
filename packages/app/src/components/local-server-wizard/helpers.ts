/**
 * Pure helpers for the local-server-wizard component.
 *
 * Lives in its own file (not the .tsx) so unit tests can import without
 * dragging in @librecode/ui → @kobalte/core, which calls a client-only
 * API at module-init time and crashes bun test even with happydom
 * preloaded. Same pattern as mcp-app-panel/handlers.ts.
 */

export interface DiscoveredModel {
  id: string
  name: string
  selected: boolean
  /**
   * `existing` — already present in the user's config for this provider before
   * this rescan. Pre-checked and labelled "already added" so it's clear what
   * action a check/uncheck represents. v0.9.78.
   */
  existing: boolean
}

export function makeProviderID(url: string): string {
  return `local-${url
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .toLowerCase()}`
}

/**
 * v0.9.78 — pure helper that produces the model-picker entries for a given
 * server's live `models` list combined with the user's `existing` configured
 * model IDs (from `provider[providerID].models`). Pulled out so test/component
 * coverage can pin the merge semantics:
 *
 *   - every server-side model becomes an entry, pre-checked, marked `existing`
 *     iff it was already configured;
 *   - configured models that are NOT in the live server list are appended
 *     (so the user can see they're orphaned), pre-checked + marked `existing`.
 *
 * Order: server-side first, then orphaned-existing — keeps newly-added live
 * models at the top.
 */
export function buildModelPickerEntries(
  serverModels: ReadonlyArray<{ id: string; name: string }>,
  existingModelIDs: ReadonlySet<string>,
): DiscoveredModel[] {
  const onServer = new Set(serverModels.map((m) => m.id))
  const entries: DiscoveredModel[] = serverModels.map((m) => ({
    id: m.id,
    name: m.name,
    selected: true,
    existing: existingModelIDs.has(m.id),
  }))
  for (const id of existingModelIDs) {
    if (onServer.has(id)) continue
    entries.push({ id, name: id, selected: true, existing: true })
  }
  return entries
}
