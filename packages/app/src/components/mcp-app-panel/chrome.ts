// Pure predicates for the McpAppPanel inner header (app name + status dot +
// Overlay/Exit/Disconnect actions). Extracted so the visibility rules are
// unit-testable without rendering the (sandboxed-iframe-hosting) component.

/**
 * Whether to render the FULL inner chrome — the app-name title, the running
 * dot, and the Disconnect button.
 *
 * Suppressed only in the dock while inline: there the DockPane's PaneHeader
 * already shows the title + a status dot, and Disconnect now lives in the ⋮
 * kebab menu, so a second title bar is pure redundancy. Detached/standalone
 * windows (`embedded` false) and fullscreen/overlay modes
 * (`displayMode !== "inline"`, which escape the dock and need the Exit button)
 * keep the full chrome.
 */
export function showFullInnerChrome(embedded: boolean | undefined, displayMode: string): boolean {
  return !embedded || displayMode !== "inline"
}

/**
 * Whether to render the inner header bar at all. Full-chrome contexts always
 * show it. In the dock-inline case it's hidden EXCEPT for overlay-capable apps,
 * whose ⤢ Overlay promotion button lives in this header — so for those we keep
 * an action-only bar (no title) rather than dropping the promotion entirely.
 */
export function shouldShowInnerHeader(opts: {
  embedded?: boolean
  displayMode: string
  overlayCapable: boolean
  hasDoc: boolean
}): boolean {
  if (!opts.hasDoc) return false
  return showFullInnerChrome(opts.embedded, opts.displayMode) || opts.overlayCapable
}
