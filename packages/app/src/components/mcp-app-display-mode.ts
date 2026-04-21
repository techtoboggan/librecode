/**
 * Pure helpers for the v0.9.45 `ui/request-display-mode` AppBridge
 * handler. Lives in its own file so the test suite can import them
 * without dragging in the Solid + Kobalte + router stack from
 * mcp-app-panel.tsx.
 */

/** Display modes the host supports. `pip` deferred per ADR-005 §5. */
export const HOST_AVAILABLE_DISPLAY_MODES = ["inline", "fullscreen"] as const
export type HostDisplayMode = (typeof HOST_AVAILABLE_DISPLAY_MODES)[number]

/**
 * Pure: decide which display mode to honor for a `ui/request-display-mode`.
 * If the requested mode is in the host's allowlist, it wins. Otherwise we
 * keep the current mode — per the MCP spec, an unsupported request must
 * report back what's actually in effect, not error out.
 */
export function resolveDisplayModeRequest(requested: string, current: HostDisplayMode): HostDisplayMode {
  return (HOST_AVAILABLE_DISPLAY_MODES as readonly string[]).includes(requested)
    ? (requested as HostDisplayMode)
    : current
}
